/**
 * Administrator page: invite codes and connected homes. Polish only (used by the portal owner).
 * Talks to /api/v1/admin/* with an HttpOnly session cookie obtained by entering ADMIN_TOKEN.
 */
export function adminPage(): string {
  return `<!doctype html>
<html lang="pl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<meta name="color-scheme" content="light dark">
<title>Administracja portalu</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect x='3' y='3' width='26' height='26' rx='7' fill='%231C2E30'/%3E%3Ccircle cx='16' cy='13' r='4' fill='none' stroke='%23D6A75A' stroke-width='2.5'/%3E%3Cpath d='M16 17v7' stroke='%23D6A75A' stroke-width='2.5' stroke-linecap='round'/%3E%3C/svg%3E">
<style>
:root{
  --bg:#E9EDE8; --surface:#F7F8F5; --ink:#1C2E30; --muted:#566664; --line:#C9D2CB;
  --brass:#8F6420; --brass-soft:#E7D7B8; --ok:#2E6B45; --ok-soft:#D6E8DC; --bad:#A33A2A; --bad-soft:#F2DAD4; --focus:#1C5D73;
  color-scheme:light;
}
@media (prefers-color-scheme:dark){
  :root{
    --bg:#101718; --surface:#182223; --ink:#E4EAE6; --muted:#9AA8A5; --line:#2E3C3D;
    --brass:#D6A75A; --brass-soft:#3A3122; --ok:#74C493; --ok-soft:#1E3427; --bad:#EE8B78; --bad-soft:#3B2420; --focus:#8CC9DC;
    color-scheme:dark;
  }
}
*{box-sizing:border-box}
html,body{margin:0;min-height:100%}
body{background:var(--bg);color:var(--ink);font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
  padding:env(safe-area-inset-top,0) 0 env(safe-area-inset-bottom,0)}
main{max-width:44rem;margin:0 auto;padding:2.25rem 1.25rem 3rem}
header{display:flex;align-items:center;gap:.875rem;margin-bottom:1.75rem}
.tag{flex:none;width:2.5rem;height:2.5rem;border-radius:.75rem;background:var(--ink);position:relative}
.tag::after{content:"";position:absolute;left:50%;top:.55rem;width:.6rem;height:.6rem;margin-left:-.42rem;border:.22rem solid var(--brass);border-radius:50%}
h1{font-size:1.5rem;line-height:1.2;font-weight:680;margin:0}
.sub{color:var(--muted);font-size:.875rem;margin:0}
h2{font-size:1.125rem;font-weight:640;margin:0 0 .25rem}
p{margin:0}
.card{background:var(--surface);border:1px solid var(--line);border-radius:1rem;padding:1.25rem;margin-bottom:1rem}
.hint{color:var(--muted);font-size:.9375rem;margin-bottom:1rem}
.row{display:flex;gap:.5rem;flex-wrap:wrap;align-items:center}
button,select,input{font:inherit}
button{font-weight:600;color:var(--ink);background:transparent;border:1.5px solid var(--line);border-radius:.75rem;min-height:2.75rem;padding:.4rem 1rem;cursor:pointer}
button.primary{background:var(--brass);border-color:var(--brass);color:var(--surface)}
button.small{min-height:2.25rem;padding:.25rem .75rem;font-size:.875rem}
button.danger{color:var(--bad)}
button:disabled{opacity:.5;cursor:not-allowed}
button:focus-visible,select:focus-visible,input:focus-visible,textarea:focus-visible{outline:3px solid var(--focus);outline-offset:2px}
select,input[type=password]{color:var(--ink);background:var(--bg);border:1.5px solid var(--line);border-radius:.75rem;min-height:2.75rem;padding:.4rem .75rem}
input[type=password]{width:100%}
label{display:block;font-weight:600;margin-bottom:.4rem}
.code{font:600 1.5rem/1.2 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;letter-spacing:.02em;word-break:break-all;margin:.25rem 0 .75rem}
.result{border-top:1px solid var(--line);margin-top:1.25rem;padding-top:1.25rem}
textarea{width:100%;min-height:15rem;resize:vertical;color:var(--ink);background:var(--bg);border:1.5px solid var(--line);border-radius:.75rem;padding:.6rem .75rem;font:inherit;font-size:.9375rem;margin:.4rem 0 .6rem}
.list{list-style:none;margin:0;padding:0}
.list li{display:flex;justify-content:space-between;align-items:center;gap:.75rem;padding:.75rem 0;border-top:1px solid var(--line)}
.list li:first-child{border-top:0;padding-top:.25rem}
.name{font-weight:600}
.meta{color:var(--muted);font-size:.875rem}
.pill{display:inline-block;font-size:.75rem;font-weight:600;border-radius:999px;padding:.1rem .55rem;margin-left:.4rem;vertical-align:.1em}
.pill.on{background:var(--ok-soft);color:var(--ok)} .pill.off{background:var(--bg);color:var(--muted)} .pill.blocked{background:var(--bad-soft);color:var(--bad)}
.empty{color:var(--muted);font-size:.9375rem}
.err{color:var(--bad);min-height:1.5rem;margin-top:.5rem}
.toast{color:var(--ok);font-size:.875rem;min-height:1.25rem}
footer{display:flex;justify-content:space-between;align-items:center;margin-top:1.5rem}
.hidden{display:none}
</style>
</head>
<body>
<main>
  <header>
    <span class="tag" aria-hidden="true"></span>
    <div><h1>Administracja portalu</h1><p class="sub" id="origin"></p></div>
  </header>

  <section id="login" class="card hidden">
    <h2>Logowanie</h2>
    <p class="hint">Wpisz token administratora, czyli wartość sekretu ADMIN_TOKEN z ustawień Workera w Cloudflare.</p>
    <form id="loginForm">
      <label for="token">Token administratora</label>
      <input id="token" type="password" autocomplete="current-password" required>
      <p class="err" id="loginErr" role="alert"></p>
      <button class="primary" type="submit">Zaloguj</button>
    </form>
  </section>

  <div id="app" class="hidden">
    <section class="card">
      <h2>Zaproś dom</h2>
      <p class="hint">Kod jest jednorazowy. Znajomy wpisuje go przy dodawaniu integracji Temporary Access w swoim Home Assistancie.</p>
      <div class="row">
        <label for="ttl" class="sr" style="margin:0;font-weight:500">Ważny przez</label>
        <select id="ttl"><option value="1">1 dzień</option><option value="7" selected>7 dni</option><option value="30">30 dni</option><option value="90">90 dni</option><option value="180">180 dni</option><option value="365">1 rok</option><option value="730">2 lata</option></select>
        <button class="primary" id="newInvite" type="button">Wygeneruj kod</button>
      </div>
      <div id="inviteResult" class="result hidden" aria-live="polite">
        <p class="meta" id="inviteUntil"></p>
        <p class="code" id="inviteCode"></p>
        <div class="row"><button type="button" id="copyCode">Kopiuj kod</button><span class="toast" id="copyCodeOk"></span></div>
        <label for="message" style="margin-top:1.25rem">Wiadomość dla znajomego</label>
        <textarea id="message" readonly></textarea>
        <div class="row"><button type="button" id="copyMsg">Kopiuj wiadomość</button><span class="toast" id="copyMsgOk"></span></div>
      </div>
    </section>

    <section class="card">
      <h2>Niewykorzystane kody</h2>
      <p class="hint">Kody, których nikt jeszcze nie użył. Samego kodu nie da się tu podejrzeć, bo portal przechowuje tylko jego skrót.</p>
      <ul class="list" id="invites"></ul>
    </section>

    <section class="card">
      <h2>Podłączone domy</h2>
      <p class="hint">Zablokowany dom traci połączenie z portalem, a jego goście nie mogą niczym sterować. Nazwy kontrolek i dzienniki domów nie są tu widoczne.</p>
      <ul class="list" id="instances"></ul>
    </section>

    <footer>
      <button type="button" id="refresh" class="small">Odśwież</button>
      <button type="button" id="logout" class="small">Wyloguj</button>
    </footer>
  </div>
</main>
<script>
(() => {
  const $ = id => document.getElementById(id);
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const fmt = ms => new Intl.DateTimeFormat("pl-PL", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(ms));
  const fmtDay = ms => new Intl.DateTimeFormat("pl-PL", { day: "numeric", month: "long" }).format(new Date(ms));
  $("origin").textContent = location.host;

  async function call(method, path, body) {
    const r = await fetch("/api/v1/admin/" + path, {
      method, credentials: "same-origin",
      headers: { "content-type": "application/json", "x-requested-with": "access" },
      body: body ? JSON.stringify(body) : undefined
    });
    let data = {};
    try { data = await r.json(); } catch {}
    if (r.status === 401 && path !== "session") { show(false); }
    return { status: r.status, data };
  }

  function show(loggedIn) {
    $("login").classList.toggle("hidden", loggedIn);
    $("app").classList.toggle("hidden", !loggedIn);
    if (!loggedIn) setTimeout(() => $("token").focus(), 50);
  }

  async function copy(text, okId) {
    try { await navigator.clipboard.writeText(text); $(okId).textContent = "Skopiowano"; }
    catch { $(okId).textContent = "Zaznacz i skopiuj ręcznie"; }
    setTimeout(() => { $(okId).textContent = ""; }, 2500);
  }

  async function loadInvites() {
    const r = await call("GET", "invites");
    if (r.status !== 200) return;
    const ul = $("invites"); ul.textContent = "";
    if (!r.data.invites.length) { ul.append(el("li", "empty", "Brak niewykorzystanych kodów.")); return; }
    for (const i of r.data.invites) {
      const li = el("li");
      const info = el("div");
      info.append(el("div", "name", "Kod z " + fmt(i.created_at)), el("div", "meta", "Ważny do " + fmt(i.expires_at)));
      const b = el("button", "small danger", "Anuluj"); b.type = "button";
      b.addEventListener("click", async () => {
        if (!confirm("Anulować ten kod? Nie będzie można go już użyć.")) return;
        b.disabled = true;
        await call("DELETE", "invites/" + i.id);
        loadInvites();
      });
      li.append(info, b); ul.append(li);
    }
  }

  async function loadInstances() {
    const r = await call("GET", "instances");
    if (r.status !== 200) return;
    const ul = $("instances"); ul.textContent = "";
    if (!r.data.instances.length) { ul.append(el("li", "empty", "Żaden dom nie jest jeszcze podłączony.")); return; }
    for (const i of r.data.instances) {
      const li = el("li");
      const info = el("div");
      const name = el("div", "name", i.name || "Home Assistant");
      name.append(i.blocked ? el("span", "pill blocked", "zablokowany") : i.online ? el("span", "pill on", "online") : el("span", "pill off", "offline"));
      info.append(name, el("div", "meta", "Dołączył " + fmt(i.created_at) + " · aktywne panele: " + i.active_panels + " (wszystkich: " + i.panels + ")"));
      const b = el("button", "small" + (i.blocked ? "" : " danger"), i.blocked ? "Odblokuj" : "Zablokuj"); b.type = "button";
      b.addEventListener("click", async () => {
        const q = i.blocked ? "Odblokować dom „" + (i.name || "") + "”?" : "Zablokować dom „" + (i.name || "") + "”? Jego goście stracą dostęp, dopóki go nie odblokujesz.";
        if (!confirm(q)) return;
        b.disabled = true;
        await call("POST", "instances/" + encodeURIComponent(i.id) + "/block", { blocked: !i.blocked });
        loadInstances();
      });
      li.append(info, b); ul.append(li);
    }
  }

  async function loadAll() { await Promise.all([loadInvites(), loadInstances()]); }

  $("loginForm").addEventListener("submit", async e => {
    e.preventDefault();
    $("loginErr").textContent = "";
    const r = await call("POST", "session", { token: $("token").value.trim() });
    if (r.status === 200) { $("token").value = ""; show(true); loadAll(); return; }
    $("loginErr").textContent = r.status === 429
      ? "Zbyt wiele prób. Spróbuj ponownie o " + new Intl.DateTimeFormat("pl-PL", { hour: "2-digit", minute: "2-digit" }).format(new Date(r.data.retry_at)) + "."
      : r.status === 503 ? "Portal nie ma ustawionego sekretu ADMIN_TOKEN." : "Nieprawidłowy token.";
  });

  $("newInvite").addEventListener("click", async () => {
    const b = $("newInvite"); b.disabled = true;
    const r = await call("POST", "invites", { ttl_days: Number($("ttl").value) });
    b.disabled = false;
    if (r.status !== 201) return;
    const d = r.data, until = Date.parse(d.expires_at);
    $("inviteCode").textContent = d.invite_code;
    $("inviteUntil").textContent = "Nowy kod, ważny do " + fmt(until);
    const lines = [
      "Cześć! Zapraszam Cię do portalu dostępu dla gości do Home Assistanta.",
      "",
      "1. Zainstaluj integrację Temporary Access" + (d.integration_url ? ": " + d.integration_url : "."),
      "2. W Home Assistancie: Ustawienia → Urządzenia i usługi → Dodaj integrację → Temporary Access.",
      "3. Adres portalu: " + d.portal_url,
      "4. Kod zaproszenia: " + d.invite_code,
      "",
      "Kod jest jednorazowy i ważny do " + fmtDay(until) + "."
    ];
    $("message").value = lines.join("\\n");
    $("inviteResult").classList.remove("hidden");
    loadInvites();
  });
  $("copyCode").addEventListener("click", () => copy($("inviteCode").textContent, "copyCodeOk"));
  $("copyMsg").addEventListener("click", () => copy($("message").value, "copyMsgOk"));
  $("refresh").addEventListener("click", loadAll);
  $("logout").addEventListener("click", async () => { await call("DELETE", "session"); $("inviteResult").classList.add("hidden"); show(false); });

  (async () => {
    const r = await call("GET", "invites");
    if (r.status === 200) { show(true); loadAll(); } else show(false);
  })();
})();
</script>
</body>
</html>`;
}
