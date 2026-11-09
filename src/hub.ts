import { DurableObject } from "cloudflare:workers";
import { addLog, type Env } from "./db";

/** Commands older than this are never delivered or executed. Home Assistant enforces the same limit. */
export const COMMAND_TTL_MS = 30_000;

export type CommandStatus = "pending" | "done" | "rejected" | "expired";

interface Attachment {
  instance_id: string;
}

/**
 * One object per Home Assistant instance. It holds the WebSocket that Home Assistant opens
 * (hibernation API, so an idle connection costs no duration) and the queue of guest commands.
 */
export class InstanceHub extends DurableObject<Env> {
  private sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS commands (
      seq INTEGER PRIMARY KEY AUTOINCREMENT, panel_id TEXT NOT NULL, control_id TEXT NOT NULL,
      action TEXT NOT NULL, ts INTEGER NOT NULL, status TEXT NOT NULL, reason TEXT, done_at INTEGER)`);
    // Answered by the runtime without waking the object.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('{"type":"ping"}', '{"type":"pong"}'));
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname !== "/ws" || req.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      return new Response("not found", { status: 404 });
    }
    const instanceId = req.headers.get("x-instance-id") || "";
    const after = Math.max(0, Number(url.searchParams.get("after") || 0) || 0);

    // Only one live connection per instance: a reconnect replaces the old socket.
    for (const old of this.ctx.getWebSockets()) {
      try {
        old.close(4001, "replaced");
      } catch {}
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ instance_id: instanceId } satisfies Attachment);

    this.expireOld();
    server.send(JSON.stringify({ type: "hello", server_time: Date.now(), command_ttl_ms: COMMAND_TTL_MS }));
    const pending = this.sql
      .exec("SELECT seq, panel_id, control_id, action, ts FROM commands WHERE status = 'pending' AND seq > ? ORDER BY seq", after)
      .toArray();
    for (const c of pending) server.send(JSON.stringify({ type: "command", ...c }));

    return new Response(null, { status: 101, webSocket: client });
  }

  /** Called by the Worker when a guest presses a control. */
  async enqueue(panelId: string, controlId: string, action: string): Promise<{ online: boolean; seq?: number }> {
    const sockets = this.ctx.getWebSockets();
    if (sockets.length === 0) return { online: false };
    const now = Date.now();
    this.sql.exec("DELETE FROM commands WHERE ts < ?", now - 7 * 24 * 3600_000);
    const row = this.sql
      .exec(
        "INSERT INTO commands (panel_id, control_id, action, ts, status) VALUES (?, ?, ?, ?, 'pending') RETURNING seq",
        panelId,
        controlId,
        action,
        now,
      )
      .one();
    const seq = row.seq as number;
    const msg = JSON.stringify({ type: "command", seq, panel_id: panelId, control_id: controlId, action, ts: now });
    for (const ws of sockets) {
      try {
        ws.send(msg);
      } catch {}
    }
    return { online: true, seq };
  }

  async status(panelId: string, seq: number): Promise<{ status: CommandStatus; reason: string | null } | null> {
    this.expireOld();
    const rows = this.sql.exec("SELECT status, reason FROM commands WHERE seq = ? AND panel_id = ?", seq, panelId).toArray();
    if (!rows.length) return null;
    return { status: rows[0].status as CommandStatus, reason: (rows[0].reason as string) ?? null };
  }

  async online(): Promise<boolean> {
    return this.ctx.getWebSockets().length > 0;
  }

  async disconnect(): Promise<void> {
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.close(4003, "instance blocked");
      } catch {}
    }
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== "string") return;
    let msg: { type?: string; seq?: number; result?: string; reason?: string };
    try {
      msg = JSON.parse(message);
    } catch {
      return;
    }
    if (msg.type === "ping") {
      ws.send('{"type":"pong"}');
      return;
    }
    if (msg.type !== "ack" || typeof msg.seq !== "number") return;

    this.expireOld();
    const rows = this.sql.exec("SELECT panel_id, control_id, status FROM commands WHERE seq = ?", msg.seq).toArray();
    if (!rows.length || rows[0].status !== "pending") {
      ws.send(JSON.stringify({ type: "ack_ignored", seq: msg.seq }));
      return;
    }
    const ok = msg.result === "ok";
    const reason = ok ? null : String(msg.reason || "error").slice(0, 64);
    this.sql.exec("UPDATE commands SET status = ?, reason = ?, done_at = ? WHERE seq = ?", ok ? "done" : "rejected", reason, Date.now(), msg.seq);

    const panelId = rows[0].panel_id as string;
    const controlId = rows[0].control_id as string;
    if (ok) {
      await this.env.DB.prepare("UPDATE controls SET uses = uses + 1 WHERE panel_id = ? AND control_id = ?").bind(panelId, controlId).run();
    }
    await addLog(this.env, panelId, ok ? "executed" : "rejected", { control_id: controlId, detail: reason });
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    try {
      ws.close(code === 1005 ? 1000 : code, reason);
    } catch {}
  }

  private expireOld(): void {
    this.sql.exec(
      "UPDATE commands SET status = 'expired', reason = 'timeout', done_at = ? WHERE status = 'pending' AND ts < ?",
      Date.now(),
      Date.now() - COMMAND_TTL_MS,
    );
  }
}
