import type { InstanceHub } from "./hub";
import { scheduleAllows, type Schedule } from "./util";

export interface Env {
  DB: D1Database;
  HUB: DurableObjectNamespace<InstanceHub>;
  ADMIN_TOKEN: string;
  PIN_PEPPER: string;
  MAX_ACTIVE_PANELS: string;
  MAX_CONTROLS: string;
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS invites (
     code_hash TEXT PRIMARY KEY, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
     used_at INTEGER, instance_id TEXT)`,
  `CREATE TABLE IF NOT EXISTS instances (
     id TEXT PRIMARY KEY, key_hash TEXT NOT NULL UNIQUE, name TEXT,
     created_at INTEGER NOT NULL, blocked INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS panels (
     id TEXT PRIMARY KEY, instance_id TEXT NOT NULL, public_id TEXT NOT NULL UNIQUE,
     pin_hmac TEXT NOT NULL, pin_length INTEGER NOT NULL, title TEXT NOT NULL, language TEXT NOT NULL,
     valid_from INTEGER NOT NULL, valid_until INTEGER NOT NULL, schedule TEXT,
     revoked_at INTEGER, locked INTEGER NOT NULL DEFAULT 0, failed_total INTEGER NOT NULL DEFAULT 0,
     created_at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS panels_instance ON panels(instance_id)`,
  `CREATE TABLE IF NOT EXISTS controls (
     panel_id TEXT NOT NULL, control_id TEXT NOT NULL, name TEXT NOT NULL, type TEXT NOT NULL,
     max_uses INTEGER, uses INTEGER NOT NULL DEFAULT 0, position INTEGER NOT NULL,
     PRIMARY KEY (panel_id, control_id))`,
  `CREATE TABLE IF NOT EXISTS sessions (
     token_hash TEXT PRIMARY KEY, panel_id TEXT NOT NULL, expires_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS pin_attempts (
     panel_id TEXT NOT NULL, ip TEXT NOT NULL, failures INTEGER NOT NULL, locked_until INTEGER,
     updated_at INTEGER NOT NULL, PRIMARY KEY (panel_id, ip))`,
  `CREATE TABLE IF NOT EXISTS log (
     id INTEGER PRIMARY KEY AUTOINCREMENT, panel_id TEXT NOT NULL, ts INTEGER NOT NULL,
     event TEXT NOT NULL, control_id TEXT, detail TEXT, ip TEXT, ua TEXT)`,
  `CREATE INDEX IF NOT EXISTS log_panel ON log(panel_id, ts)`,
];

let schemaReady: Promise<unknown> | null = null;

/** Creates tables on first use, so no separate migration step is needed when deploying. */
export function ensureSchema(db: D1Database): Promise<unknown> {
  if (!schemaReady) {
    schemaReady = db.batch(SCHEMA.map((s) => db.prepare(s))).catch((e) => {
      schemaReady = null;
      throw e;
    });
  }
  return schemaReady;
}

export interface PanelRow {
  id: string;
  instance_id: string;
  public_id: string;
  pin_hmac: string;
  pin_length: number;
  title: string;
  language: string;
  valid_from: number;
  valid_until: number;
  schedule: string | null;
  revoked_at: number | null;
  locked: number;
  failed_total: number;
  created_at: number;
}

export interface ControlRow {
  panel_id: string;
  control_id: string;
  name: string;
  type: "switch" | "button";
  max_uses: number | null;
  uses: number;
  position: number;
}

export type PanelStatus = "active" | "not_started" | "outside_schedule" | "expired" | "revoked" | "locked";

export function panelStatus(p: PanelRow, now = Date.now()): PanelStatus {
  if (p.revoked_at) return "revoked";
  if (p.locked) return "locked";
  if (now >= p.valid_until) return "expired";
  if (now < p.valid_from) return "not_started";
  const s = p.schedule ? (JSON.parse(p.schedule) as Schedule) : null;
  if (!scheduleAllows(s, now)) return "outside_schedule";
  return "active";
}

export async function addLog(
  env: Env,
  panelId: string,
  event: string,
  opts: { control_id?: string | null; detail?: string | null; ip?: string | null; ua?: string | null } = {},
): Promise<void> {
  await env.DB.prepare("INSERT INTO log (panel_id, ts, event, control_id, detail, ip, ua) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(panelId, Date.now(), event, opts.control_id ?? null, opts.detail ?? null, opts.ip ?? null, (opts.ua ?? "").slice(0, 200) || null)
    .run();
}
