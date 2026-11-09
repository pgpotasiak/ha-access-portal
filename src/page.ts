/**
 * Guest page. One self-contained HTML document; everything is loaded from /p/<id>/api/*.
 * System fonts only: no third-party requests, so guests' IP addresses are not sent anywhere else.
 */
export function guestPage(): string {
  return `<!doctype html>
<html lang="pl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<meta name="color-scheme" content="light dark">
<title>Dostęp</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect x='3' y='3' width='26' height='26' rx='7' fill='%239A6B22'/%3E%3Ccircle cx='16' cy='13' r='4' fill='none' stroke='white' stroke-width='2.5'/%3E%3Cpath d='M16 17v7' stroke='white' stroke-width='2.5' stroke-linecap='round'/%3E%3C/svg%3E">
<style>
:root{
  --bg:#E9EDE8; --surface:#F7F8F5; --ink:#1C2E30; --muted:#566664; --line:#C9D2CB;
  --brass:#8F6420; --brass-soft:#E7D7B8; --ok:#2E6B45; --bad:#A33A2A; --focus:#1C5D73;
  color-scheme:light;
}
@media (prefers-color-scheme:dark){
  :root{
    --bg:#101718; --surface:#182223; --ink:#E4EAE6; --muted:#9AA8A5; --line:#2E3C3D;
    --brass:#D6A75A; --brass-soft:#3A3122; --ok:#74C493; --bad:#EE8B78; --focus:#8CC9DC;
    color-scheme:dark;
  }
}
*{box-sizing:border-box}
html,body{margin:0;height:100%}
body{
  background:var(--bg); color:var(--ink);
  font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
  padding:env(safe-area-inset-top,0) 0 env(safe-area-inset-bottom,0);
  -webkit-text-size-adjust:100%;
}
main{max-width:26rem;margin:0 auto;padding:2.25rem 1.25rem 2rem;min-height:100%;display:flex;flex-direction:column}
h1{font-size:1.625rem;line-height:1.2;font-weight:680;letter-spacing:-.01em;margin:0 0 .5rem}
p{margin:0}
.meta{color:var(--muted);font-size:.9375rem}
.meta strong{color:var(--ink);font-weight:600;font-variant-numeric:tabular-nums}
.tag{
  display:block;width:2.5rem;height:2.5rem;border-radius:.75rem;background:var(--brass);margin-bottom:1.5rem;position:relative
}
.tag::after{content:"";position:absolute;left:50%;top:.55rem;width:.6rem;height:.6rem;margin-left:-.42rem;border:.22rem solid var(--surface);border-radius:50%}
.panel{margin-top:1.75rem;display:flex;flex-direction:column;gap:.75rem}
.row{background:var(--surface);border:1px solid var(--line);border-radius:1rem;padding:1rem 1rem 1.125rem}
.row h2{font-size:1.0625rem;font-weight:620;margin:0 0 .75rem}
.row .uses{float:right;font-size:.8125rem;color:var(--muted);font-weight:400;margin-top:.15rem}
.pair{display:grid;grid-template-columns:1fr 1fr;gap:.5rem}
button{
  font:inherit;font-weight:600;color:var(--ink);background:transparent;border:1.5px solid var(--line);
  border-radius:.75rem;min-height:3.25rem;padding:.5rem 1rem;cursor:pointer;touch-action:manipulation;
  -webkit-tap-highlight-color:transparent;
}
button:active{background:var(--brass-soft)}
button:focus-visible,input:focus-visible{outline:3px solid var(--focus);outline-offset:2px}
button:disabled{opacity:.45;cursor:not-allowed}
.hold{
  position:relative;overflow:hidden;width:100%;min-height:4rem;border:2px solid var(--brass);
  color:var(--ink);font-size:1.0625rem;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none
}
.hold .fill{position:absolute;inset:0;background:var(--brass-soft);border-right:3px solid var(--brass);transform:scaleX(0);transform-origin:left;pointer-events:none}
.hold .lbl{position:relative}
.hold.holding .fill{transform:scaleX(1);transition:transform 1s linear}
.hold:active{background:transparent}
.result{min-height:1.4rem;margin-top:.6rem;font-size:.9375rem;color:var(--muted)}
.result.ok{color:var(--ok)} .result.bad{color:var(--bad)}
.notice{border-left:4px solid var(--bad);background:var(--surface);padding:.875rem 1rem;border-radius:.25rem .75rem .75rem .25rem;margin-top:1.5rem}
.notice.info{border-color:var(--brass)}
form{margin-top:1.75rem}
label{display:block;font-weight:600;margin-bottom:.5rem}
.pin{
  width:100%;font:inherit;font-size:2rem;letter-spacing:.6em;text-align:center;padding:.6rem 0 .6rem .6em;
  font-variant-numeric:tabular-nums;color:var(--ink);background:var(--surface);border:1.5px solid var(--line);border-radius:.875rem
}
.err{color:var(--bad);margin-top:.6rem;min-height:1.5rem}
.submit{width:100%;margin-top:.75rem;background:var(--brass);border-color:var(--brass);color:var(--surface)}
footer{margin-top:auto;padding-top:2.5rem;display:flex;justify-content:flex-end}
.lang{min-height:2.5rem;border:0;color:var(--muted);font-weight:500;padding:.25rem .5rem}
.hidden{display:none}
@media (prefers-reduced-motion:reduce){.hold.holding .fill{transition:none}}
</style>
</head>
<body>
<main>
  <span class="tag" aria-hidden="true"></span>
  <h1 id="title">…</h1>
  <p class="meta" id="meta"></p>
  <div id="view" aria-live="polite"></div>
  <footer><button class="lang" id="lang" type="button"></button></footer>
</main>
<script>
(() => {
  const T = {
    pl: {
      loading: "Wczytywanie…",
      pinLabel: "Wpisz PIN",
      pinHint: "PIN dostałeś osobno od tego linku.",
      unlock: "Otwórz panel",
      wrongPin: n => "Nieprawidłowy PIN. Pozostałe próby: " + n + ".",
      tooMany: t => "Zbyt wiele prób. Spróbuj ponownie o " + t + ".",
      validUntil: "Dostęp ważny do ",
      left: "Zostało: ",
      notStarted: d => "Dostęp będzie aktywny od " + d + ".",
      expired: "Ten link nie jest już aktywny.",
      revoked: "Ten link nie jest już aktywny.",
      locked: "Panel jest zablokowany po wielu błędnych próbach PIN-u. Skontaktuj się z osobą, która wysłała link.",
      notFound: "Ten link nie istnieje lub wygasł.",
      outside: "Poza godzinami dostępu. ",
      scheduleIs: "Dostęp działa: ",
      offline: "Dom jest chwilowo niedostępny. Spróbuj ponownie za kilka minut.",
      on: "Włącz", off: "Wyłącz",
      hold: "Przytrzymaj, aby uruchomić",
      holding: "Trzymaj…",
      sending: "Wysyłanie…",
      done: "Wykonano",
      failed: r => "Nie wykonano" + (r ? " (" + r + ")" : ""),
      noReply: "Dom nie odpowiedział. Spróbuj ponownie.",
      usesLeft: n => "Pozostało użyć: " + n,
      limit: "Limit użyć wyczerpany",
      error: "Coś poszło nie tak. Odśwież stronę.",
      reasons: { timeout: "brak odpowiedzi", outside_schedule: "poza godzinami", expired: "dostęp wygasł", limit_reached: "limit użyć", not_allowed: "niedozwolone", error: "błąd urządzenia" },
      d: "d", h: "h", min: "min",
      other: "English"
    },
    en: {
      loading: "Loading…",
      pinLabel: "Enter PIN",
      pinHint: "You received the PIN separately from this link.",
      unlock: "Open panel",
      wrongPin: n => "Wrong PIN. Attempts left: " + n + ".",
      tooMany: t => "Too many attempts. Try again at " + t + ".",
      validUntil: "Access valid until ",
      left: "Time left: ",
      notStarted: d => "Access starts on " + d + ".",
      expired: "This link is no longer active.",
      revoked: "This link is no longer active.",
      locked: "This panel is locked after too many wrong PINs. Contact the person who sent you the link.",
      notFound: "This link does not exist or has expired.",
      outside: "Outside access hours. ",
      scheduleIs: "Access works: ",
      offline: "The house is offline right now. Try again in a few minutes.",
      on: "Turn on", off: "Turn off",
      hold: "Hold to activate",
      holding: "Keep holding…",
      sending: "Sending…",
      done: "Done",
      failed: r => "Not done" + (r ? " (" + r + ")" : ""),
      noReply: "The house did not respond. Try again.",
      usesLeft: n => "Uses left: " + n,
      limit: "No uses left",
      error: "Something went wrong. Reload the page.",
      reasons: { timeout: "no response", outside_schedule: "outside hours", expired: "access expired", limit_reached: "use limit", not_allowed: "not allowed", error: "device error" },
      d: "d", h: "h", min: "min",
      other: "Polski"
    }
  };
  const base = location.pathname.replace(/\\/+$/, "") + "/api/";
  const $ = id => document.getElementById(id);
  let lang = null, state = null, timer = null;
  const results = {};
  const showResult = (id, _res, cls, text, ttl = 15000) => {
    results[id] = { cls, text, until: Date.now() + ttl };
    for (const r of document.querySelectorAll(".result")) if (r.dataset.id === id) { r.className = "result" + (cls ? " " + cls : ""); r.textContent = text; }
  };

  const t = () => T[lang];
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const fmtDate = iso => new Intl.DateTimeFormat(lang === "pl" ? "pl-PL" : "en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
  const fmtTime = iso => new Intl.DateTimeFormat(lang === "pl" ? "pl-PL" : "en-GB", { hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
  const fmtLeft = ms => {
    const m = Math.max(0, Math.floor(ms / 60000)), d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60;
    if (d) return d + " " + t().d + " " + h + " " + t().h;
    if (h) return h + " " + t().h + " " + mm + " " + t().min;
    return mm + " " + t().min;
  };
  const fmtSchedule = s => {
    if (!s) return "";
    const order = ["mon","tue","wed","thu","fri","sat","sun"];
    const names = order.map((_, i) => new Intl.DateTimeFormat(lang === "pl" ? "pl-PL" : "en-GB", { weekday: "short" }).format(new Date(Date.UTC(2024, 0, 1 + i))));
    const days = s.days ? s.days.slice().sort((a, b) => order.indexOf(a) - order.indexOf(b)).map(d => names[order.indexOf(d)]).join(", ") : "";
    const hours = s.from ? s.from + "–" + s.to : "";
    return [days, hours].filter(Boolean).join(", ");
  };

  async function call(path, opts = {}) {
    const r = await fetch(base + path, { credentials: "same-origin", ...opts, headers: { "content-type": "application/json", "x-requested-with": "access", ...(opts.headers || {}) } });
    let body = {};
    try { body = await r.json(); } catch {}
    return { status: r.status, body };
  }

  function header() {
    document.documentElement.lang = lang;
    $("lang").textContent = t().other;
    $("title").textContent = state ? state.title : "";
    document.title = state ? state.title : "Access";
    const meta = $("meta");
    meta.textContent = "";
    if (state && state.authenticated && (state.status === "active" || state.status === "outside_schedule")) {
      meta.append(t().validUntil, el("strong", null, fmtDate(state.valid_until)));
      meta.append(el("br"), t().left, el("strong", null, fmtLeft(Date.parse(state.valid_until) - Date.now())));
    }
  }

  function notice(text, info) { const n = el("p", "notice" + (info ? " info" : ""), text); return n; }

  function render() {
    const v = $("view");
    v.textContent = "";
    header();
    if (!state) { v.append(notice(t().notFound)); return; }
    const s = state.status;
    if (s === "expired" || s === "revoked") { v.append(notice(t()[s])); return; }
    if (s === "locked") { v.append(notice(t().locked)); return; }
    if (s === "not_started") { v.append(notice(t().notStarted(fmtDate(state.valid_from)), true)); return; }
    if (!state.authenticated) { v.append(pinForm()); return; }
    if (s === "outside_schedule") v.append(notice(t().outside + t().scheduleIs + fmtSchedule(state.schedule) + ".", true));
    else if (!state.online) v.append(notice(t().offline));
    const panel = el("div", "panel");
    for (const c of state.controls || []) panel.append(control(c, s === "active" && state.online));
    v.append(panel);
  }

  function pinForm() {
    const f = el("form");
    f.noValidate = true;
    const lab = el("label", null, t().pinLabel); lab.htmlFor = "pin";
    const inp = el("input", "pin");
    Object.assign(inp, { id: "pin", type: "password", inputMode: "numeric", autocomplete: "one-time-code", maxLength: state.pin_length, pattern: "[0-9]*" });
    inp.setAttribute("aria-describedby", "pinhint pinerr");
    const hint = el("p", "meta", t().pinHint); hint.id = "pinhint"; hint.style.marginTop = ".5rem";
    const err = el("p", "err"); err.id = "pinerr";
    const btn = el("button", "submit", t().unlock); btn.type = "submit";
    f.append(lab, inp, hint, err, btn);
    const submit = async () => {
      if (inp.value.length !== state.pin_length) return;
      btn.disabled = true; inp.disabled = true; err.textContent = "";
      const r = await call("unlock", { method: "POST", body: JSON.stringify({ pin: inp.value }) });
      btn.disabled = false; inp.disabled = false;
      if (r.status === 200) { await load(); return; }
      inp.value = ""; inp.focus();
      if (r.status === 401) err.textContent = t().wrongPin(r.body.attempts_left);
      else if (r.status === 429) err.textContent = t().tooMany(fmtTime(r.body.retry_at));
      else await load();
    };
    f.addEventListener("submit", e => { e.preventDefault(); submit(); });
    inp.addEventListener("input", () => { inp.value = inp.value.replace(/\\D/g, ""); if (inp.value.length === state.pin_length) submit(); });
    setTimeout(() => inp.focus(), 50);
    return f;
  }

  function control(c, enabled) {
    const row = el("section", "row");
    const h = el("h2", null, c.name);
    if (c.uses_left !== null) h.append(el("span", "uses", c.uses_left > 0 ? t().usesLeft(c.uses_left) : t().limit));
    row.append(h);
    const res = el("p", "result");
    res.dataset.id = c.id;
    const canUse = enabled && (c.uses_left === null || c.uses_left > 0);
    if (c.type === "switch") {
      const pair = el("div", "pair");
      for (const a of ["on", "off"]) {
        const b = el("button", null, t()[a]); b.type = "button"; b.disabled = !canUse;
        b.addEventListener("click", () => press(c, a, res, pair));
        pair.append(b);
      }
      row.append(pair);
    } else {
      const b = el("button", "hold"); b.type = "button"; b.disabled = !canUse;
      const fill = el("span", "fill"), lbl = el("span", "lbl", t().hold);
      b.append(fill, lbl);
      let hold = null;
      const start = e => {
        if (b.disabled || hold) return;
        if (e.type === "keydown" && e.key !== "Enter" && e.key !== " ") return;
        if (e.type === "keydown" && e.repeat) return;
        e.preventDefault();
        b.classList.add("holding"); lbl.textContent = t().holding;
        hold = setTimeout(() => { hold = null; stop(); press(c, "press", res, b); }, 1000);
      };
      const stop = () => {
        if (hold) { clearTimeout(hold); hold = null; }
        b.classList.remove("holding"); lbl.textContent = t().hold;
      };
      b.addEventListener("pointerdown", start);
      b.addEventListener("keydown", start);
      for (const ev of ["pointerup", "pointerleave", "pointercancel", "keyup", "blur"]) b.addEventListener(ev, stop);
      b.addEventListener("contextmenu", e => e.preventDefault());
      row.append(b);
    }
    const prev = results[c.id];
    if (prev && prev.until > Date.now()) { res.className = "result" + (prev.cls ? " " + prev.cls : ""); res.textContent = prev.text; }
    row.append(res);
    return row;
  }

  async function press(c, action, res, wrap) {
    const buttons = wrap.tagName === "BUTTON" ? [wrap] : [...wrap.querySelectorAll("button")];
    buttons.forEach(b => b.disabled = true);
    showResult(c.id, res, "", t().sending);
    const r = await call("press", { method: "POST", body: JSON.stringify({ control_id: c.id, action }) });
    if (r.status !== 200) {
      showResult(c.id, res, "bad", r.status === 503 ? t().offline : t().failed(t().reasons[r.body.error] || ""));
      setTimeout(load, 2500);
      return;
    }
    const seq = r.body.seq, until = Date.now() + 12000;
    while (Date.now() < until) {
      await new Promise(z => setTimeout(z, 600));
      const s = await call("status/" + seq);
      if (s.status !== 200) break;
      if (s.body.status === "done") { showResult(c.id, res, "ok", t().done); break; }
      if (s.body.status === "rejected" || s.body.status === "expired") {
        showResult(c.id, res, "bad", s.body.reason === "timeout" ? t().noReply : t().failed(t().reasons[s.body.reason] || s.body.reason));
        break;
      }
    }
    if (results[c.id].text === t().sending) showResult(c.id, res, "bad", t().noReply);
    setTimeout(load, 1500);
  }

  async function load() {
    if (document.querySelector(".holding")) { setTimeout(load, 1200); return; }
    const r = await call("state");
    if (r.status === 404) state = null;
    else if (r.status === 200) state = r.body;
    if (!lang) {
      const pref = (navigator.language || "").toLowerCase().startsWith("pl") ? "pl" : (navigator.language || "").toLowerCase().startsWith("en") ? "en" : null;
      lang = pref || (state && state.language) || "pl";
    }
    render();
  }

  $("lang").addEventListener("click", () => { lang = lang === "pl" ? "en" : "pl"; render(); });
  clearInterval(timer);
  timer = setInterval(() => { if (state && state.authenticated && !document.querySelector(".holding")) header(); }, 30000);
  setInterval(() => { if (state && state.authenticated && !document.querySelector(".holding") && !document.activeElement?.closest?.(".row")) load(); }, 60000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) load(); });
  lang = null;
  $("view").textContent = T.pl.loading;
  load();
})();
</script>
</body>
</html>`;
}
