// End-to-end test against `wrangler dev`. Usage: node test/e2e.mjs [baseUrl] [adminToken]
const BASE = process.argv[2] || "http://127.0.0.1:8787";
const ADMIN = process.argv[3] || "dev-admin-token-0123456789";

let passed = 0, failed = 0;
function check(name, cond, info) {
  if (cond) { passed++; console.log("  ok  ", name); }
  else { failed++; console.log("  FAIL", name, info !== undefined ? JSON.stringify(info) : ""); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const iso = (ms) => new Date(Date.now() + ms).toISOString();

async function req(method, path, { body, token, headers = {} } = {}) {
  const r = await fetch(BASE + path, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: "Bearer " + token } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await r.json(); } catch {}
  return { status: r.status, data, headers: r.headers };
}

class Guest {
  constructor(url, ip = "203.0.113.10") { this.path = new URL(url).pathname; this.cookie = ""; this.ip = ip; }
  async call(method, sub, body) {
    const r = await req(method, `${this.path}/api/${sub}`, {
      body,
      headers: { cookie: this.cookie, "x-requested-with": "access", "cf-connecting-ip": this.ip },
    });
    const sc = r.headers.get("set-cookie");
    if (sc) this.cookie = sc.split(";")[0];
    return r;
  }
}

function openHa(instanceId, key, after = 0) {
  return new Promise((resolve, reject) => {
    const wsUrl = BASE.replace(/^http/, "ws") + `/api/v1/instances/${instanceId}/ws?after=${after}`;
    // Node's WebSocket client cannot send headers, so this test passes the key via a subprotocol-free trick:
    // we use the `undici` WebSocket with headers option (Node 22 supports it via the `headers` init field).
    const ws = new WebSocket(wsUrl, { headers: { authorization: "Bearer " + key } });
    const msgs = [];
    const waiters = [];
    ws.addEventListener("message", (e) => {
      const m = JSON.parse(e.data);
      msgs.push(m);
      for (const w of [...waiters]) if (w.pred(m)) { waiters.splice(waiters.indexOf(w), 1); w.res(m); }
    });
    ws.addEventListener("open", () => resolve({
      ws, msgs,
      next: (pred, timeout = 5000) => new Promise((res, rej) => {
        const found = msgs.find(pred);
        if (found) { msgs.splice(msgs.indexOf(found), 1); return res(found); }
        const w = { pred, res: (m) => { clearTimeout(t); msgs.splice(msgs.indexOf(m), 1); res(m); } };
        const t = setTimeout(() => { waiters.splice(waiters.indexOf(w), 1); rej(new Error("timeout waiting for message")); }, timeout);
        waiters.push(w);
      }),
      send: (o) => ws.send(JSON.stringify(o)),
      closed: new Promise((r) => ws.addEventListener("close", (e) => r(e.code))),
    }));
    ws.addEventListener("error", (e) => reject(e));
  });
}

async function waitStatus(g, seq, want, ms = 5000) {
  const end = Date.now() + ms;
  let last;
  while (Date.now() < end) {
    last = await g.call("GET", `status/${seq}`);
    if (last.data?.status === want) return last.data;
    await sleep(200);
  }
  return last?.data;
}

console.log("Rejestracja instancji");
check("invite bez tokenu admina = 401", (await req("POST", "/api/v1/admin/invites", { token: "zly" })).status === 401);
const inv = await req("POST", "/api/v1/admin/invites", { token: ADMIN, body: { ttl_days: 7 } });
check("admin tworzy kod zaproszenia", inv.status === 201 && inv.data.invite_code.startsWith("INV-"), inv.data);
check("rejestracja złym kodem = 403", (await req("POST", "/api/v1/instances", { body: { invite_code: "INV-nope" } })).status === 403);
const reg = await req("POST", "/api/v1/instances", { body: { invite_code: inv.data.invite_code, name: "Mój dom" } });
check("rejestracja kodem", reg.status === 201 && reg.data.api_key.startsWith("ak_"), reg.data);
check("kod jest jednorazowy", (await req("POST", "/api/v1/instances", { body: { invite_code: inv.data.invite_code } })).status === 403);
const { instance_id: IID, api_key: KEY } = reg.data;

console.log("Tworzenie panelu");
check("bez klucza = 401", (await req("POST", "/api/v1/panels", { body: {} })).status === 401);
const badPin = await req("POST", "/api/v1/panels", { token: KEY, body: { pin: "12a4", title: "x", valid_until: iso(3600e3), controls: [{ id: "a", name: "A", type: "switch" }] } });
check("walidacja PIN-u", badPin.status === 400, badPin.data);
const badCtl = await req("POST", "/api/v1/panels", { token: KEY, body: { pin: "1234", title: "x", valid_until: iso(3600e3), controls: [{ id: "a", name: "A", type: "lamp" }] } });
check("walidacja typu kontrolki", badCtl.status === 400, badCtl.data);
const panel = await req("POST", "/api/v1/panels", {
  token: KEY,
  body: {
    pin: "4821", title: "Dostęp dla Marka", language: "pl", valid_until: iso(24 * 3600e3),
    controls: [
      { id: "ctrl_1", name: "Światło garaż", type: "switch" },
      { id: "ctrl_2", name: "Brama wjazdowa", type: "button", max_uses: 2 },
    ],
  },
});
check("panel utworzony", panel.status === 201 && panel.data.panel_url.includes("/p/"), panel.data);
const PID = panel.data.panel_id;

console.log("Strona gościa");
const page = await fetch(panel.data.panel_url);
const html = await page.text();
check("strona HTML się ładuje", page.status === 200 && html.includes("<main>"));
check("nagłówek CSP jest ustawiony", (page.headers.get("content-security-policy") || "").includes("default-src 'none'"));
const g = new Guest(panel.data.panel_url);
let st = await g.call("GET", "state");
check("bez PIN-u: brak kontrolek", st.status === 200 && st.data.authenticated === false && !st.data.controls && st.data.pin_length === 4, st.data);
check("naciśnięcie bez PIN-u = 401", (await g.call("POST", "press", { control_id: "ctrl_1", action: "on" })).status === 401);
const noHdr = await req("POST", `${g.path}/api/unlock`, { body: { pin: "4821" } });
check("POST bez nagłówka x-requested-with = 403 (CSRF)", noHdr.status === 403);
const wrong = await g.call("POST", "unlock", { pin: "0000" });
check("zły PIN = 401, zostały 4 próby", wrong.status === 401 && wrong.data.attempts_left === 4, wrong.data);
const good = await g.call("POST", "unlock", { pin: "4821" });
check("dobry PIN = sesja", good.status === 200 && g.cookie.startsWith("ha_s="), good.data);
st = await g.call("GET", "state");
check("po PIN-ie widać kontrolki, HA offline", st.data.authenticated && st.data.controls.length === 2 && st.data.online === false, st.data);
check("naciśnięcie przy HA offline = 503", (await g.call("POST", "press", { control_id: "ctrl_1", action: "on" })).status === 503);

console.log("Połączenie HA przez WebSocket");
const other = await req("POST", "/api/v1/admin/invites", { token: ADMIN });
const reg2 = await req("POST", "/api/v1/instances", { body: { invite_code: other.data.invite_code, name: "Dom znajomego" } });
const KEY2 = reg2.data.api_key;
let wsDenied = false;
try { const x = await openHa(IID, KEY2); x.ws.close(); } catch { wsDenied = true; }
check("cudzy klucz nie otworzy WebSocketu instancji", wsDenied);
check("cudzy klucz nie widzi panelu = 404", (await req("GET", `/api/v1/panels/${PID}`, { token: KEY2 })).status === 404);

let ha = await openHa(IID, KEY);
const hello = await ha.next((m) => m.type === "hello");
check("HA dostaje powitanie", hello.command_ttl_ms === 30000, hello);
ha.send({ type: "ping" });
check("ping → pong", (await ha.next((m) => m.type === "pong")).type === "pong");
st = await g.call("GET", "state");
check("gość widzi dom online", st.data.online === true, st.data);

let pr = await g.call("POST", "press", { control_id: "ctrl_1", action: "on" });
check("naciśnięcie przyjęte", pr.status === 200 && pr.data.seq > 0, pr.data);
let cmd = await ha.next((m) => m.type === "command");
check("HA dostaje polecenie od razu", cmd.control_id === "ctrl_1" && cmd.action === "on" && cmd.panel_id === PID, cmd);
ha.send({ type: "ack", seq: cmd.seq, result: "ok" });
check("status = wykonano", (await waitStatus(g, pr.data.seq, "done"))?.status === "done");

check("zła akcja dla przełącznika = 400", (await g.call("POST", "press", { control_id: "ctrl_1", action: "press" })).status === 400);
check("nieznana kontrolka = 404", (await g.call("POST", "press", { control_id: "ctrl_9", action: "on" })).status === 404);

pr = await g.call("POST", "press", { control_id: "ctrl_1", action: "off" });
cmd = await ha.next((m) => m.type === "command");
ha.send({ type: "ack", seq: cmd.seq, result: "rejected", reason: "outside_schedule" });
const rej = await waitStatus(g, pr.data.seq, "rejected");
check("HA odrzuca → gość widzi powód", rej?.status === "rejected" && rej.reason === "outside_schedule", rej);

console.log("Limit użyć");
for (let i = 1; i <= 2; i++) {
  pr = await g.call("POST", "press", { control_id: "ctrl_2", action: "press" });
  cmd = await ha.next((m) => m.type === "command");
  ha.send({ type: "ack", seq: cmd.seq, result: "ok" });
  await waitStatus(g, pr.data.seq, "done");
}
st = await g.call("GET", "state");
check("po 2 użyciach zostało 0", st.data.controls.find((c) => c.id === "ctrl_2").uses_left === 0, st.data.controls);
check("trzecie użycie = 409 limit_reached", (await g.call("POST", "press", { control_id: "ctrl_2", action: "press" })).data?.error === "limit_reached");

console.log("Ponowne połączenie i zaległe polecenia");
pr = await g.call("POST", "press", { control_id: "ctrl_1", action: "on" });
cmd = await ha.next((m) => m.type === "command");
const lastSeq = cmd.seq - 1;
const ha2 = await openHa(IID, KEY, lastSeq);
check("stare połączenie zamknięte przy nowym (4001)", (await ha.closed) === 4001);
const replay = await ha2.next((m) => m.type === "command");
check("zaległe polecenie dosłane po ponownym połączeniu", replay.seq === cmd.seq, replay);
ha2.send({ type: "ack", seq: replay.seq, result: "ok" });
await waitStatus(g, pr.data.seq, "done");
ha2.send({ type: "ack", seq: replay.seq, result: "ok" });
check("podwójne potwierdzenie ignorowane", (await ha2.next((m) => m.type === "ack_ignored")).seq === replay.seq);
ha = ha2;

console.log("Blokady PIN-u");
const attacker = new Guest(panel.data.panel_url, "198.51.100.7");
let last;
for (let i = 0; i < 5; i++) last = await attacker.call("POST", "unlock", { pin: "1111" });
check("5 błędów z jednego IP = blokada 429", last.status === 429 && last.data.retry_at, last.data);
check("dobry PIN w czasie blokady też odrzucony", (await attacker.call("POST", "unlock", { pin: "4821" })).status === 429);
const otherIp = new Guest(panel.data.panel_url, "198.51.100.8");
check("inne IP nadal może się zalogować", (await otherIp.call("POST", "unlock", { pin: "4821" })).status === 200);

console.log("Harmonogram i data startu");
const now = new Date();
const wd = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"][new Date(now.toLocaleString("en-US", { timeZone: "Europe/Warsaw" })).getDay()];
const notToday = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].filter((d) => d !== wd);
const sched = await req("POST", "/api/v1/panels", { token: KEY, body: { pin: "1234", title: "Weekend", valid_until: iso(3600e3), schedule: { days: notToday }, controls: [{ id: "a", name: "A", type: "switch" }] } });
const gs = new Guest(sched.data.panel_url);
await gs.call("POST", "unlock", { pin: "1234" });
st = await gs.call("GET", "state");
check("poza harmonogramem: status outside_schedule", st.data.status === "outside_schedule", st.data);
check("poza harmonogramem: naciśnięcie = 409", (await gs.call("POST", "press", { control_id: "a", action: "on" })).status === 409);
const future = await req("POST", "/api/v1/panels", { token: KEY, body: { pin: "1234", title: "Jutro", valid_from: iso(3600e3), valid_until: iso(7200e3), controls: [{ id: "a", name: "A", type: "switch" }] } });
st = await new Guest(future.data.panel_url).call("GET", "state");
check("przed startem: status not_started", st.data.status === "not_started", st.data);

console.log("Lista, dziennik, unieważnienie");
const list = await req("GET", "/api/v1/panels", { token: KEY });
check("HA widzi listę swoich paneli", list.status === 200 && list.data.panels.length === 3, list.data);
const log = await req("GET", `/api/v1/panels/${PID}/log`, { token: KEY });
const events = log.data.entries.map((e) => e.event);
check("dziennik zawiera zdarzenia", ["created", "pin_failed", "unlocked", "pressed", "executed", "rejected", "ip_locked"].every((e) => events.includes(e)), events);
check("dziennik zapisuje IP", log.data.entries.some((e) => e.ip === "198.51.100.7"));
const rev = await req("DELETE", `/api/v1/panels/${PID}`, { token: KEY });
check("unieważnienie", rev.status === 200 && rev.data.status === "revoked");
st = await g.call("GET", "state");
check("po unieważnieniu gość widzi revoked bez kontrolek", st.data.status === "revoked" && !st.data.controls, st.data);
check("po unieważnieniu naciśnięcie odrzucone", (await g.call("POST", "press", { control_id: "ctrl_1", action: "on" })).status === 401);

console.log("Blokowanie instancji przez admina");
const blk = await req("POST", `/api/v1/admin/instances/${IID}/block`, { token: ADMIN, body: { blocked: true } });
check("admin blokuje instancję", blk.status === 200 && blk.data.blocked === true);
check("WebSocket zablokowanej instancji zamknięty (4003)", (await ha.closed) === 4003);
check("API zablokowanej instancji = 403", (await req("GET", "/api/v1/panels", { token: KEY })).status === 403);
const insts = await req("GET", "/api/v1/admin/instances", { token: ADMIN });
check("admin widzi listę instancji", insts.data.instances.length >= 2);

console.log("Wygasanie niepotwierdzonych poleceń (czekam 31 s)");
const inv3 = await req("POST", "/api/v1/admin/invites", { token: ADMIN });
const reg3 = await req("POST", "/api/v1/instances", { body: { invite_code: inv3.data.invite_code } });
const p3 = await req("POST", "/api/v1/panels", { token: reg3.data.api_key, body: { pin: "5555", title: "T", valid_until: iso(3600e3), controls: [{ id: "a", name: "A", type: "switch" }] } });
const ha3 = await openHa(reg3.data.instance_id, reg3.data.api_key);
const g3 = new Guest(p3.data.panel_url);
await g3.call("POST", "unlock", { pin: "5555" });
pr = await g3.call("POST", "press", { control_id: "a", action: "on" });
await ha3.next((m) => m.type === "command");
await sleep(31000);
const exp = await g3.call("GET", `status/${pr.data.seq}`);
check("polecenie bez potwierdzenia wygasa po 30 s", exp.data.status === "expired" && exp.data.reason === "timeout", exp.data);
const ha3b = await openHa(reg3.data.instance_id, reg3.data.api_key, 0);
await ha3b.next((m) => m.type === "hello");
await sleep(500);
check("wygasłe polecenie nie jest dosyłane po ponownym połączeniu", !ha3b.msgs.some((m) => m.type === "command"), ha3b.msgs);
ha3b.ws.close();


console.log("Strona administratora");
const adminPage = await fetch(BASE + "/admin");
check("strona /admin się ładuje", adminPage.status === 200 && (await adminPage.text()).includes("Administracja portalu"));
const A = { "x-requested-with": "access", "cf-connecting-ip": "192.0.2.50" };
check("logowanie bez nagłówka = 403", (await req("POST", "/api/v1/admin/session", { body: { token: ADMIN } })).status === 403);
check("zły token = 401", (await req("POST", "/api/v1/admin/session", { body: { token: "zly" }, headers: A })).status === 401);
const login = await req("POST", "/api/v1/admin/session", { body: { token: ADMIN }, headers: A });
const adminCookie = (login.headers.get("set-cookie") || "").split(";")[0];
check("logowanie tokenem daje ciasteczko sesji", login.status === 200 && adminCookie.startsWith("ha_admin="));
const AC = { ...A, cookie: adminCookie };
const lst = await req("GET", "/api/v1/admin/instances", { headers: { cookie: adminCookie } });
check("sesja: lista domów ze stanem online", lst.status === 200 && lst.data.instances.every((i) => typeof i.online === "boolean" && "active_panels" in i), lst.data);
check("sesja: zapis bez nagłówka = 403 (CSRF)", (await req("POST", "/api/v1/admin/invites", { headers: { cookie: adminCookie } })).status === 403);
const inv4 = await req("POST", "/api/v1/admin/invites", { headers: AC, body: { ttl_days: 1 } });
const year = await req("POST", "/api/v1/admin/invites", { token: ADMIN, body: { ttl_days: 365 } });
const days = (Date.parse(year.data.expires_at) - Date.now()) / 86400e3;
check("kod ważny rok", year.status === 201 && days > 364.9 && days < 365.1, year.data);
const tooLong = await req("POST", "/api/v1/admin/invites", { token: ADMIN, body: { ttl_days: 5000 } });
check("ważność ograniczona do 2 lat", (Date.parse(tooLong.data.expires_at) - Date.now()) / 86400e3 < 730.1, tooLong.data);
check("sesja: nowy kod z adresem portalu", inv4.status === 201 && inv4.data.portal_url === BASE && inv4.data.integration_url, inv4.data);
const pending = await req("GET", "/api/v1/admin/invites", { headers: { cookie: adminCookie } });
check("lista niewykorzystanych kodów", pending.status === 200 && pending.data.invites.length >= 3 && pending.data.invites[0].id.length === 12, pending.data);
const { createHash } = await import("node:crypto");
const inv4Id = createHash("sha256").update(inv4.data.invite_code).digest("base64url").slice(0, 12);
check("kod widoczny na liście", pending.data.invites.some((i) => i.id === inv4Id));
const del = await req("DELETE", `/api/v1/admin/invites/${inv4Id}`, { headers: AC });
check("anulowanie kodu", del.status === 200);
check("anulowany kod nie działa", (await req("POST", "/api/v1/instances", { body: { invite_code: inv4.data.invite_code } })).status === 403);
const out = await req("DELETE", "/api/v1/admin/session", { headers: AC });
check("wylogowanie", out.status === 200);
check("po wylogowaniu sesja nie działa", (await req("GET", "/api/v1/admin/instances", { headers: { cookie: adminCookie } })).status === 401);
const B = { "x-requested-with": "access", "cf-connecting-ip": "192.0.2.99" };
let lastA;
for (let i = 0; i < 10; i++) lastA = await req("POST", "/api/v1/admin/session", { body: { token: "zly" + i }, headers: B });
check("10 złych tokenów = blokada 429", lastA.status === 429, lastA.data);
check("dobry token w czasie blokady też odrzucony", (await req("POST", "/api/v1/admin/session", { body: { token: ADMIN }, headers: B })).status === 429);
check("token w nagłówku (skrypty) nadal działa", (await req("GET", "/api/v1/admin/invites", { token: ADMIN })).status === 200);

console.log(`\nWynik: ${passed} ok, ${failed} błędów`);
process.exit(failed ? 1 : 0);
