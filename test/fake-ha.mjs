// Fake Home Assistant for manual testing: registers, creates a panel, stays connected and confirms commands.
// Usage: node test/fake-ha.mjs [baseUrl] [adminToken]
const BASE = process.argv[2] || "http://127.0.0.1:8787";
const ADMIN = process.argv[3] || "dev-admin-token";
const post = async (path, body, token) => (await fetch(BASE + path, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: "Bearer " + token } : {}) }, body: JSON.stringify(body) })).json();
const inv = await post("/api/v1/admin/invites", {}, ADMIN);
const reg = await post("/api/v1/instances", { invite_code: inv.invite_code, name: "Fake HA" });
const panel = await post("/api/v1/panels", {
  pin: "4821", title: "Dostęp dla Marka", valid_until: new Date(Date.now() + 29 * 3600e3).toISOString(),
  controls: [{ id: "ctrl_1", name: "Światło garaż", type: "switch" }, { id: "ctrl_2", name: "Brama wjazdowa", type: "button", max_uses: 3 }],
}, reg.api_key);
console.log("PANEL_URL " + panel.panel_url);
const ws = new WebSocket(BASE.replace(/^http/, "ws") + `/api/v1/instances/${reg.instance_id}/ws`, { headers: { authorization: "Bearer " + reg.api_key } });
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  console.log("<-", e.data);
  if (m.type === "command") setTimeout(() => ws.send(JSON.stringify({ type: "ack", seq: m.seq, result: "ok" })), 300);
});
setInterval(() => ws.readyState === 1 && ws.send('{"type":"ping"}'), 30000);
