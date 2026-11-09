const enc = new TextEncoder();

export function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Random URL-safe token with `bytes` bytes of entropy. */
export function randomToken(bytes = 16): string {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return b64url(a);
}

export async function sha256(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", enc.encode(s));
  return b64url(new Uint8Array(d));
}

export async function hmac(key: string, msg: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const s = await crypto.subtle.sign("HMAC", k, enc.encode(msg));
  return b64url(new Uint8Array(s));
}

export function safeEqual(a: string, b: string): boolean {
  const x = enc.encode(a);
  const y = enc.encode(b);
  if (x.length !== y.length) return false;
  let r = 0;
  for (let i = 0; i < x.length; i++) r |= x[i] ^ y[i];
  return r === 0;
}

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}

export function fail(status: number, error: string, extra: Record<string, unknown> = {}): Response {
  return json({ error, ...extra }, status);
}

export function bearer(req: Request): string | null {
  const h = req.headers.get("authorization") || "";
  return h.startsWith("Bearer ") ? h.slice(7).trim() : null;
}

export function clientIp(req: Request): string {
  return req.headers.get("cf-connecting-ip") || "0.0.0.0";
}

export function getCookie(req: Request, name: string): string | null {
  const c = req.headers.get("cookie") || "";
  for (const part of c.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return null;
}

export async function readJson<T>(req: Request): Promise<T | null> {
  try {
    return (await req.json()) as T;
  } catch {
    return null;
  }
}

// ---------- schedule ----------

export const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type Day = (typeof DAYS)[number];

export interface Schedule {
  days?: Day[];
  from?: string; // "HH:MM"
  to?: string; // "HH:MM", may be earlier than `from` (overnight)
  tz?: string;
}

const HM = /^([01]\d|2[0-3]):[0-5]\d$/;

export function validateSchedule(s: unknown): Schedule | string | null {
  if (s === undefined || s === null) return null;
  if (typeof s !== "object") return "schedule must be an object";
  const o = s as Record<string, unknown>;
  const out: Schedule = {};
  if (o.days !== undefined) {
    if (!Array.isArray(o.days) || o.days.length === 0 || !o.days.every((d) => (DAYS as readonly string[]).includes(d as string)))
      return "schedule.days must be a non-empty list of mon..sun";
    out.days = [...new Set(o.days as Day[])];
  }
  if (o.from !== undefined || o.to !== undefined) {
    if (typeof o.from !== "string" || typeof o.to !== "string" || !HM.test(o.from) || !HM.test(o.to) || o.from === o.to)
      return "schedule.from and schedule.to must be different HH:MM values";
    out.from = o.from;
    out.to = o.to;
  }
  const tz = typeof o.tz === "string" ? o.tz : "Europe/Warsaw";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
  } catch {
    return "schedule.tz is not a valid time zone";
  }
  out.tz = tz;
  return out;
}

export function scheduleAllows(s: Schedule | null, now: number): boolean {
  if (!s) return true;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: s.tz || "Europe/Warsaw",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(now));
  const get = (t: string) => parts.find((p) => p.type === t)?.value || "";
  const wd = get("weekday").toLowerCase().slice(0, 3);
  const hm = `${get("hour")}:${get("minute")}`;
  if (s.days && !s.days.includes(wd as Day)) return false;
  if (s.from && s.to) {
    return s.from < s.to ? hm >= s.from && hm < s.to : hm >= s.from || hm < s.to;
  }
  return true;
}
