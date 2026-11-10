import { addLog, ensureSchema, panelStatus, type ControlRow, type Env, type PanelRow } from "./db";
import { adminPage } from "./admin";
import { guestPage } from "./page";
import {
  bearer, clientIp, fail, getCookie, hmac, json, randomToken, readJson, safeEqual, sha256, validateSchedule,
} from "./util";

export { InstanceHub } from "./hub";

const PIN_FAILS_PER_IP = 5;
const PIN_LOCK_MS = 15 * 60_000;
const PIN_FAILS_TOTAL = 20;
const SESSION_MS = 12 * 3600_000;
const RETENTION_MS = 7 * 24 * 3600_000;
const MAX_VALIDITY_MS = 366 * 24 * 3600_000;
const COOKIE = "ha_s";
const ADMIN_COOKIE = "ha_admin";
const ADMIN_SESSION_MS = 12 * 3600_000;
const ADMIN_FAILS = 10;
const ADMIN_LOCK_MS = 15 * 60_000;

const PAGE_HEADERS = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "no-store",
  "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
};

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    const p = url.pathname.split("/").filter(Boolean);
    const m = req.method;
    if (!env.PIN_PEPPER || env.PIN_PEPPER.length < 16) {
      return fail(503, "not_configured", { message: "Set the PIN_PEPPER secret (at least 16 characters) in the Worker settings." });
    }
    try {
      await ensureSchema(env.DB);
      if (p[0] === "api" && p[1] === "v1") return await api(req, env, url, p.slice(2), m);
      if (p[0] === "p" && p[1]) {
        if (p.length === 2 && m === "GET") return new Response(guestPage(), { headers: PAGE_HEADERS });
        if (p[2] === "api") return await guest(req, env, p[1], p.slice(3), m);
      }
      if (p[0] === "admin" && p.length === 1 && m === "GET") {
        return new Response(adminPage(), { headers: { ...PAGE_HEADERS, "x-robots-tag": "noindex" } });
      }
      if (url.pathname === "/" && m === "GET") {
        return new Response("Home Assistant temporary access portal.", { headers: { "content-type": "text/plain; charset=utf-8" } });
      }
      return fail(404, "not_found");
    } catch (e) {
      console.error(e);
      return fail(500, "internal_error");
    }
  },

  async scheduled(_ev: ScheduledController, env: Env): Promise<void> {
    await ensureSchema(env.DB);
    const cutoff = Date.now() - RETENTION_MS;
    const old = "SELECT id FROM panels WHERE valid_until < ?1 OR (revoked_at IS NOT NULL AND revoked_at < ?1)";
    await env.DB.batch([
      env.DB.prepare(`DELETE FROM controls WHERE panel_id IN (${old})`).bind(cutoff),
      env.DB.prepare(`DELETE FROM log WHERE panel_id IN (${old})`).bind(cutoff),
      env.DB.prepare(`DELETE FROM sessions WHERE panel_id IN (${old}) OR expires_at < ?2`).bind(cutoff, Date.now()),
      env.DB.prepare(`DELETE FROM pin_attempts WHERE panel_id IN (${old}) OR updated_at < ?1`).bind(cutoff),
      env.DB.prepare(`DELETE FROM panels WHERE id IN (${old})`).bind(cutoff),
      env.DB.prepare("DELETE FROM invites WHERE used_at IS NULL AND expires_at < ?").bind(Date.now()),
    ]);
  },
} satisfies ExportedHandler<Env>;

// ===================== API for Home Assistant and the administrator =====================

async function api(req: Request, env: Env, url: URL, p: string[], m: string): Promise<Response> {
  // --- administrator ---
  if (p[0] === "admin") {
    if (!env.ADMIN_TOKEN || env.ADMIN_TOKEN.length < 16) return fail(503, "not_configured", { message: "Set the ADMIN_TOKEN secret (at least 16 characters)." });

    // --- login / logout for the admin page ---
    if (p[1] === "session" && m === "POST") {
      if (req.headers.get("x-requested-with") !== "access") return fail(403, "forbidden");
      const ip = clientIp(req);
      const now = Date.now();
      const att = await env.DB.prepare("SELECT failures, locked_until FROM pin_attempts WHERE panel_id = '__admin__' AND ip = ?").bind(ip)
        .first<{ failures: number; locked_until: number | null }>();
      if (att?.locked_until && att.locked_until > now) return fail(429, "too_many_attempts", { retry_at: new Date(att.locked_until).toISOString() });
      const body = await readJson<{ token?: string }>(req);
      if (!body?.token || !safeEqual(String(body.token), env.ADMIN_TOKEN)) {
        const failures = (att && (!att.locked_until || att.locked_until <= now) ? att.failures : 0) + 1;
        const lock = failures >= ADMIN_FAILS;
        await env.DB.prepare(
          `INSERT INTO pin_attempts (panel_id, ip, failures, locked_until, updated_at) VALUES ('__admin__', ?1, ?2, ?3, ?4)
           ON CONFLICT (panel_id, ip) DO UPDATE SET failures = ?2, locked_until = ?3, updated_at = ?4`,
        ).bind(ip, lock ? 0 : failures, lock ? now + ADMIN_LOCK_MS : null, now).run();
        if (lock) return fail(429, "too_many_attempts", { retry_at: new Date(now + ADMIN_LOCK_MS).toISOString() });
        return fail(401, "wrong_token");
      }
      const token = randomToken(32);
      await env.DB.batch([
        env.DB.prepare("DELETE FROM pin_attempts WHERE panel_id = '__admin__' AND ip = ?").bind(ip),
        env.DB.prepare("DELETE FROM admin_sessions WHERE expires_at < ?").bind(now),
        env.DB.prepare("INSERT INTO admin_sessions (token_hash, expires_at) VALUES (?, ?)").bind(await sha256(token), now + ADMIN_SESSION_MS),
      ]);
      return json({ ok: true }, 200, {
        "set-cookie": `${ADMIN_COOKIE}=${token}; Path=/; Max-Age=${ADMIN_SESSION_MS / 1000}; HttpOnly; Secure; SameSite=Strict`,
      });
    }
    if (p[1] === "session" && m === "DELETE") {
      const c = getCookie(req, ADMIN_COOKIE);
      if (c) await env.DB.prepare("DELETE FROM admin_sessions WHERE token_hash = ?").bind(await sha256(c)).run();
      return json({ ok: true }, 200, { "set-cookie": `${ADMIN_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict` });
    }

    // --- everything else: admin token (scripts) or admin page session (cookie) ---
    const t = bearer(req);
    let ok = !!t && safeEqual(t, env.ADMIN_TOKEN);
    if (!ok) {
      const c = getCookie(req, ADMIN_COOKIE);
      if (c) {
        const s = await env.DB.prepare("SELECT expires_at FROM admin_sessions WHERE token_hash = ?").bind(await sha256(c)).first<{ expires_at: number }>();
        ok = !!s && s.expires_at > Date.now();
        // Cookie-authenticated writes must come from our own page.
        if (ok && m !== "GET" && req.headers.get("x-requested-with") !== "access") return fail(403, "forbidden");
      }
    }
    if (!ok) return fail(401, "unauthorized");

    if (p[1] === "invites" && !p[2] && m === "GET") {
      const r = await env.DB.prepare("SELECT substr(code_hash, 1, 12) AS id, created_at, expires_at FROM invites WHERE used_at IS NULL AND expires_at > ? ORDER BY created_at DESC")
        .bind(Date.now()).all();
      return json({ invites: r.results });
    }
    if (p[1] === "invites" && p[2] && m === "DELETE") {
      if (!/^[A-Za-z0-9_-]{12}$/.test(p[2])) return fail(400, "bad_id");
      const r = await env.DB.prepare("DELETE FROM invites WHERE substr(code_hash, 1, 12) = ? AND used_at IS NULL").bind(p[2]).run();
      if (!r.meta.changes) return fail(404, "not_found");
      return json({ id: p[2], deleted: true });
    }
    if (p[1] === "invites" && !p[2] && m === "POST") {
      const body = (await readJson<{ ttl_days?: number }>(req)) || {};
      const days = Math.min(Math.max(Number(body.ttl_days) || 7, 1), 730);
      const code = "INV-" + randomToken(9);
      const expires = Date.now() + days * 24 * 3600_000;
      await env.DB.prepare("INSERT INTO invites (code_hash, created_at, expires_at) VALUES (?, ?, ?)")
        .bind(await sha256(code), Date.now(), expires).run();
      return json({ invite_code: code, expires_at: new Date(expires).toISOString(), portal_url: url.origin, integration_url: env.INTEGRATION_URL || null }, 201);
    }
    if (p[1] === "instances" && !p[2] && m === "GET") {
      const r = await env.DB.prepare(
        `SELECT i.id, i.name, i.created_at, i.blocked,
                (SELECT COUNT(*) FROM panels WHERE instance_id = i.id) AS panels,
                (SELECT COUNT(*) FROM panels WHERE instance_id = i.id AND revoked_at IS NULL AND valid_until > ?1) AS active_panels
         FROM instances i ORDER BY i.created_at`).bind(Date.now()).all<{ id: string; blocked: number }>();
      const instances = await Promise.all(
        r.results.map(async (i) => ({ ...i, online: i.blocked ? false : await env.HUB.get(env.HUB.idFromName(i.id)).online() })),
      );
      return json({ instances });
    }
    if (p[1] === "instances" && p[2] && p[3] === "block" && m === "POST") {
      const body = (await readJson<{ blocked?: boolean }>(req)) || {};
      const blocked = body.blocked === false ? 0 : 1;
      const r = await env.DB.prepare("UPDATE instances SET blocked = ? WHERE id = ?").bind(blocked, p[2]).run();
      if (!r.meta.changes) return fail(404, "not_found");
      if (blocked) await env.HUB.get(env.HUB.idFromName(p[2])).disconnect();
      return json({ id: p[2], blocked: !!blocked });
    }
    return fail(404, "not_found");
  }

  // --- registration with an invite code ---
  if (p[0] === "instances" && !p[1] && m === "POST") {
    const body = await readJson<{ invite_code?: string; name?: string }>(req);
    const code = body?.invite_code?.trim();
    if (!code) return fail(400, "invite_code_required");
    const h = await sha256(code);
    const inv = await env.DB.prepare("SELECT * FROM invites WHERE code_hash = ?").bind(h).first<{ used_at: number | null; expires_at: number }>();
    if (!inv || inv.used_at || inv.expires_at < Date.now()) return fail(403, "invalid_invite");
    const id = randomToken(9);
    const key = "ak_" + randomToken(32);
    const name = String(body?.name || "Home Assistant").slice(0, 60);
    const r = await env.DB.batch([
      env.DB.prepare("UPDATE invites SET used_at = ?, instance_id = ? WHERE code_hash = ? AND used_at IS NULL").bind(Date.now(), id, h),
      env.DB.prepare("INSERT INTO instances (id, key_hash, name, created_at) VALUES (?, ?, ?, ?)").bind(id, await sha256(key), name, Date.now()),
    ]);
    if (!r[0].meta.changes) return fail(403, "invalid_invite");
    return json({ instance_id: id, api_key: key }, 201);
  }

  // --- everything below needs an instance key ---
  const key = bearer(req);
  if (!key) return fail(401, "unauthorized");
  const inst = await env.DB.prepare("SELECT id, blocked FROM instances WHERE key_hash = ?").bind(await sha256(key)).first<{ id: string; blocked: number }>();
  if (!inst) return fail(401, "unauthorized");
  if (inst.blocked) return fail(403, "instance_blocked");

  if (p[0] === "instances" && p[1] && p[2] === "ws" && m === "GET") {
    if (p[1] !== inst.id) return fail(403, "forbidden");
    if (req.headers.get("upgrade")?.toLowerCase() !== "websocket") return fail(426, "websocket_required");
    const headers = new Headers(req.headers);
    headers.set("x-instance-id", inst.id);
    return env.HUB.get(env.HUB.idFromName(inst.id)).fetch(new Request(`https://hub/ws${url.search}`, { headers }));
  }

  if (p[0] === "panels" && !p[1] && m === "POST") return createPanel(req, env, url, inst.id);

  if (p[0] === "panels" && !p[1] && m === "GET") {
    const r = await env.DB.prepare("SELECT * FROM panels WHERE instance_id = ? ORDER BY created_at DESC").bind(inst.id).all<PanelRow>();
    return json({ panels: r.results.map((x) => panelInfo(x, url)) });
  }

  if (p[0] === "panels" && p[1]) {
    const panel = await env.DB.prepare("SELECT * FROM panels WHERE id = ? AND instance_id = ?").bind(p[1], inst.id).first<PanelRow>();
    if (!panel) return fail(404, "not_found");
    if (!p[2] && m === "GET") {
      const c = await env.DB.prepare("SELECT control_id, name, type, max_uses, uses FROM controls WHERE panel_id = ? ORDER BY position").bind(panel.id).all();
      return json({ ...panelInfo(panel, url), controls: c.results });
    }
    if (!p[2] && m === "DELETE") {
      if (!panel.revoked_at) {
        await env.DB.batch([
          env.DB.prepare("UPDATE panels SET revoked_at = ? WHERE id = ?").bind(Date.now(), panel.id),
          env.DB.prepare("DELETE FROM sessions WHERE panel_id = ?").bind(panel.id),
        ]);
        await addLog(env, panel.id, "revoked");
      }
      return json({ panel_id: panel.id, status: "revoked" });
    }
    if (p[2] === "unlock" && m === "POST") {
      await env.DB.batch([
        env.DB.prepare("UPDATE panels SET locked = 0, failed_total = 0 WHERE id = ?").bind(panel.id),
        env.DB.prepare("DELETE FROM pin_attempts WHERE panel_id = ?").bind(panel.id),
      ]);
      await addLog(env, panel.id, "unlocked_by_owner");
      return json({ panel_id: panel.id, status: panelStatus({ ...panel, locked: 0 }) });
    }
    if (p[2] === "log" && m === "GET") {
      const since = Number(url.searchParams.get("since") || 0) || 0;
      const r = await env.DB.prepare("SELECT id, ts, event, control_id, detail, ip, ua FROM log WHERE panel_id = ? AND id > ? ORDER BY id LIMIT 500")
        .bind(panel.id, since).all();
      return json({ entries: r.results });
    }
  }
  return fail(404, "not_found");
}

function panelInfo(x: PanelRow, url: URL) {
  return {
    panel_id: x.id,
    title: x.title,
    panel_url: `${url.origin}/p/${x.public_id}`,
    status: panelStatus(x),
    valid_from: new Date(x.valid_from).toISOString(),
    valid_until: new Date(x.valid_until).toISOString(),
    schedule: x.schedule ? JSON.parse(x.schedule) : null,
    failed_pin_attempts: x.failed_total,
  };
}

interface CreatePanelBody {
  pin?: string;
  title?: string;
  language?: string;
  valid_from?: string;
  valid_until?: string;
  schedule?: unknown;
  controls?: { id?: string; name?: string; type?: string; max_uses?: number }[];
}

async function createPanel(req: Request, env: Env, url: URL, instanceId: string): Promise<Response> {
  const b = await readJson<CreatePanelBody>(req);
  if (!b) return fail(400, "invalid_json");
  const bad = (msg: string) => fail(400, "validation_error", { message: msg });

  if (typeof b.pin !== "string" || !/^\d{4,8}$/.test(b.pin)) return bad("pin must be 4 to 8 digits");
  const title = typeof b.title === "string" ? b.title.trim() : "";
  if (!title || title.length > 80) return bad("title must be 1 to 80 characters");
  const language = b.language === "en" ? "en" : "pl";

  const now = Date.now();
  const from = b.valid_from ? Date.parse(b.valid_from) : now;
  const until = b.valid_until ? Date.parse(b.valid_until) : NaN;
  if (Number.isNaN(from)) return bad("valid_from must be an ISO date");
  if (Number.isNaN(until) || until <= Math.max(from, now)) return bad("valid_until must be an ISO date in the future, after valid_from");
  if (until - now > MAX_VALIDITY_MS) return bad("valid_until can be at most 366 days ahead");

  const schedule = validateSchedule(b.schedule);
  if (typeof schedule === "string") return bad(schedule);

  const maxControls = Number(env.MAX_CONTROLS) || 20;
  if (!Array.isArray(b.controls) || b.controls.length === 0 || b.controls.length > maxControls)
    return bad(`controls must have 1 to ${maxControls} items`);
  const seen = new Set<string>();
  const controls: Omit<ControlRow, "panel_id" | "uses">[] = [];
  for (const [i, c] of b.controls.entries()) {
    if (typeof c?.id !== "string" || !/^[a-z0-9_]{1,32}$/.test(c.id) || seen.has(c.id)) return bad(`controls[${i}].id must be unique, a-z 0-9 _`);
    seen.add(c.id);
    const name = typeof c.name === "string" ? c.name.trim() : "";
    if (!name || name.length > 40) return bad(`controls[${i}].name must be 1 to 40 characters`);
    if (c.type !== "switch" && c.type !== "button") return bad(`controls[${i}].type must be switch or button`);
    let maxUses: number | null = null;
    if (c.max_uses !== undefined && c.max_uses !== null) {
      if (!Number.isInteger(c.max_uses) || c.max_uses < 1 || c.max_uses > 1000) return bad(`controls[${i}].max_uses must be 1 to 1000`);
      maxUses = c.max_uses;
    }
    controls.push({ control_id: c.id, name, type: c.type, max_uses: maxUses, position: i });
  }

  const maxPanels = Number(env.MAX_ACTIVE_PANELS) || 10;
  const active = await env.DB.prepare("SELECT COUNT(*) AS n FROM panels WHERE instance_id = ? AND revoked_at IS NULL AND valid_until > ?")
    .bind(instanceId, now).first<{ n: number }>();
  if ((active?.n ?? 0) >= maxPanels) return fail(409, "too_many_panels", { message: `at most ${maxPanels} active panels` });

  const id = randomToken(9);
  const publicId = randomToken(16);
  const pinHmac = await hmac(env.PIN_PEPPER, `${id}:${b.pin}`);
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO panels (id, instance_id, public_id, pin_hmac, pin_length, title, language, valid_from, valid_until, schedule, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(id, instanceId, publicId, pinHmac, b.pin.length, title, language, from, until, schedule ? JSON.stringify(schedule) : null, now),
    ...controls.map((c) =>
      env.DB.prepare("INSERT INTO controls (panel_id, control_id, name, type, max_uses, position) VALUES (?, ?, ?, ?, ?, ?)")
        .bind(id, c.control_id, c.name, c.type, c.max_uses, c.position),
    ),
  ]);
  await addLog(env, id, "created");
  return json({ panel_id: id, panel_url: `${url.origin}/p/${publicId}`, valid_from: new Date(from).toISOString(), valid_until: new Date(until).toISOString() }, 201);
}

// ===================== API for the guest page =====================

async function guest(req: Request, env: Env, publicId: string, p: string[], m: string): Promise<Response> {
  const panel = await env.DB.prepare("SELECT * FROM panels WHERE public_id = ?").bind(publicId).first<PanelRow>();
  if (!panel) return fail(404, "not_found");
  const now = Date.now();
  const ip = clientIp(req);
  const ua = req.headers.get("user-agent");
  const hub = () => env.HUB.get(env.HUB.idFromName(panel.instance_id));

  // Writes must come from our own page (custom header forces a CORS preflight for other origins).
  if (m === "POST" && req.headers.get("x-requested-with") !== "access") return fail(403, "forbidden");

  const session = await (async () => {
    const t = getCookie(req, COOKIE);
    if (!t) return false;
    const s = await env.DB.prepare("SELECT expires_at FROM sessions WHERE token_hash = ? AND panel_id = ?").bind(await sha256(t), panel.id).first<{ expires_at: number }>();
    return !!s && s.expires_at > now;
  })();

  const status = panelStatus(panel, now);

  if (p[0] === "state" && m === "GET") {
    const base = {
      title: panel.title,
      language: panel.language,
      status,
      valid_from: new Date(panel.valid_from).toISOString(),
      valid_until: new Date(panel.valid_until).toISOString(),
      schedule: panel.schedule ? JSON.parse(panel.schedule) : null,
      pin_length: panel.pin_length,
      authenticated: session,
    };
    if (!session || status === "revoked" || status === "expired" || status === "locked") return json(base);
    const c = await env.DB.prepare("SELECT control_id, name, type, max_uses, uses FROM controls WHERE panel_id = ? ORDER BY position").bind(panel.id).all<ControlRow>();
    return json({
      ...base,
      online: await hub().online(),
      controls: c.results.map((x) => ({
        id: x.control_id,
        name: x.name,
        type: x.type,
        uses_left: x.max_uses === null ? null : Math.max(0, x.max_uses - x.uses),
      })),
    });
  }

  if (p[0] === "unlock" && m === "POST") {
    if (status === "revoked" || status === "expired") return fail(410, status);
    if (status === "locked") return fail(423, "locked");
    const att = await env.DB.prepare("SELECT failures, locked_until FROM pin_attempts WHERE panel_id = ? AND ip = ?").bind(panel.id, ip)
      .first<{ failures: number; locked_until: number | null }>();
    if (att?.locked_until && att.locked_until > now) return fail(429, "too_many_attempts", { retry_at: new Date(att.locked_until).toISOString() });

    const body = await readJson<{ pin?: string }>(req);
    const pin = String(body?.pin ?? "");
    const ok = /^\d{4,8}$/.test(pin) && safeEqual(await hmac(env.PIN_PEPPER, `${panel.id}:${pin}`), panel.pin_hmac);

    if (!ok) {
      const failures = (att && (!att.locked_until || att.locked_until <= now) ? att.failures : 0) + 1;
      const lock = failures >= PIN_FAILS_PER_IP;
      const total = panel.failed_total + 1;
      await env.DB.batch([
        env.DB.prepare(
          `INSERT INTO pin_attempts (panel_id, ip, failures, locked_until, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)
           ON CONFLICT (panel_id, ip) DO UPDATE SET failures = ?3, locked_until = ?4, updated_at = ?5`,
        ).bind(panel.id, ip, lock ? 0 : failures, lock ? now + PIN_LOCK_MS : null, now),
        env.DB.prepare("UPDATE panels SET failed_total = ?, locked = ? WHERE id = ?").bind(total, total >= PIN_FAILS_TOTAL ? 1 : 0, panel.id),
      ]);
      await addLog(env, panel.id, total >= PIN_FAILS_TOTAL ? "panel_locked" : lock ? "ip_locked" : "pin_failed", { ip, ua });
      if (total >= PIN_FAILS_TOTAL) return fail(423, "locked");
      if (lock) return fail(429, "too_many_attempts", { retry_at: new Date(now + PIN_LOCK_MS).toISOString() });
      return fail(401, "wrong_pin", { attempts_left: PIN_FAILS_PER_IP - failures });
    }

    const token = randomToken(32);
    const expires = Math.min(now + SESSION_MS, panel.valid_until);
    await env.DB.batch([
      env.DB.prepare("DELETE FROM pin_attempts WHERE panel_id = ? AND ip = ?").bind(panel.id, ip),
      env.DB.prepare("INSERT INTO sessions (token_hash, panel_id, expires_at) VALUES (?, ?, ?)").bind(await sha256(token), panel.id, expires),
    ]);
    await addLog(env, panel.id, "unlocked", { ip, ua });
    const maxAge = Math.max(1, Math.floor((expires - now) / 1000));
    return json({ ok: true }, 200, {
      "set-cookie": `${COOKIE}=${token}; Path=/p/${panel.public_id}; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Strict`,
    });
  }

  if (!session) return fail(401, "pin_required");

  if (p[0] === "press" && m === "POST") {
    if (status !== "active") return fail(409, status);
    const body = await readJson<{ control_id?: string; action?: string }>(req);
    const c = await env.DB.prepare("SELECT * FROM controls WHERE panel_id = ? AND control_id = ?").bind(panel.id, String(body?.control_id ?? "")).first<ControlRow>();
    if (!c) return fail(404, "unknown_control");
    const action = String(body?.action ?? "");
    const valid = c.type === "switch" ? action === "on" || action === "off" : action === "press";
    if (!valid) return fail(400, "invalid_action");
    if (c.max_uses !== null && c.uses >= c.max_uses) return fail(409, "limit_reached");

    const r = await hub().enqueue(panel.id, c.control_id, action);
    await addLog(env, panel.id, r.online ? "pressed" : "pressed_offline", { control_id: c.control_id, detail: action, ip, ua });
    if (!r.online) return fail(503, "offline");
    return json({ seq: r.seq });
  }

  if (p[0] === "status" && p[1] && m === "GET") {
    const s = await hub().status(panel.id, Number(p[1]));
    if (!s) return fail(404, "not_found");
    return json(s);
  }

  return fail(404, "not_found");
}
