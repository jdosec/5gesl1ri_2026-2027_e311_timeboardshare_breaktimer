// ---------- utilitaires ----------
function pad(n) { return String(n).padStart(2, "0"); }

// convertit "HH:MM" en objet Date (aujourd'hui)
function parseTime(str) {
  if (!str) return null;
  const m = str.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m || +m[1] > 23 || +m[2] > 59) return null;
  const d = new Date();
  d.setHours(+m[1], +m[2], 0, 0);
  return d;
}

function fmtHM(d) {
  return d ? pad(d.getHours()) + ":" + pad(d.getMinutes()) : "—";
}

function fmtDuration(ms) {
  if (ms < 0) ms = 0;
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

function ssGet(k) {
  try { return sessionStorage.getItem(k); } catch (e) { return null; }
}
function ssSet(k, v) {
  try {
    if (v === null || v === undefined) sessionStorage.removeItem(k);
    else sessionStorage.setItem(k, v);
  } catch (e) {}
}

// ---------- mini moteur Markdown ----------
function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;")
          .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function mdInline(text) {
  let s = escapeHtml(text || "");
  s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  s = s.replace(/~~([^~]+)~~/g, "<del>$1</del>");
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
                '<a href="$2" target="_blank" rel="noopener">$1</a>');
  return s;
}

// isNew(ligne) -> true si la ligne vient d'être ajoutée/modifiée (surlignage)
function mdBlock(text, isNew) {
  isNew = isNew || (() => false);
  let html = "";
  let list = null;
  const closeList = () => { if (list) { html += `</${list}>`; list = null; } };
  const openList = type => { if (list !== type) { closeList(); html += `<${type}>`; list = type; } };

  for (const raw of (text || "").split("\n")) {
    const line = raw.trim();
    let m;
    if (!line) { closeList(); continue; }
    const cls = isNew(line) ? ' class="fresh"' : "";

    if (/^(-{3,}|\*{3,})$/.test(line)) {
      closeList(); html += "<hr>";
    } else if ((m = line.match(/^(#{1,3})\s+(.*)$/))) {
      closeList();
      const n = m[1].length + 2;
      html += `<h${n}${cls}>${mdInline(m[2])}</h${n}>`;
    } else if ((m = line.match(/^[-*•]\s+(.*)$/))) {
      openList("ul"); html += `<li${cls}>${mdInline(m[1])}</li>`;
    } else if ((m = line.match(/^\d+[.)]\s+(.*)$/))) {
      openList("ol"); html += `<li${cls}>${mdInline(m[1])}</li>`;
    } else if ((m = line.match(/^>\s?(.*)$/))) {
      closeList(); html += `<blockquote${cls}>${mdInline(m[1])}</blockquote>`;
    } else {
      closeList(); html += `<p${cls}>${mdInline(line)}</p>`;
    }
  }
  closeList();
  return html;
}

function consignesToMd(text) {
  const lines = (text || "").split("\n").filter(l => l.trim());
  const hasMd = lines.some(l => /^\s*([-*•]\s|\d+[.)]\s|#{1,3}\s|>|-{3,}$)/.test(l));
  return hasMd ? text : lines.map(l => "- " + l.trim()).join("\n");
}

// ---------- config par défaut ----------
const defaultConfig = {
  mnemo: "DEMO101",
  title: "Épreuve de démonstration",
  start: "",
  end: "",
  leave: "",
  consignes: "## Démo\n- Ceci est un écran de **démo**\n- Cliquez sur l'icône ⚙ pour le configurer",
  faq: "À qui puis-je poser une question ? = Levez la **main**.\nPuis-je sortir avant l'heure ? = **Non**, sauf urgence."
};

const CONFIG_URL = "config.json";
const CONFIG_REFRESH_MS = 30000;
const OVERRIDE_KEY = "screentimer_overrides";
const SOURCE_KEY = "screentimer_source";
const CONFIG_FIELDS = ["mnemo", "title", "start", "end", "leave", "consignes", "faq"];

let baseConfig = {};      // config.json du dépôt
let externalConfig = {};  // config chargée depuis l'URL (Framapad, Drive, Dropbox)
let remoteConfig = {};    // fusion des deux
let padFaq = "";
let overrides = loadOverrides();

function loadOverrides() {
  try { return JSON.parse(ssGet(OVERRIDE_KEY)) || {}; }
  catch (e) { return {}; }
}
function saveOverrides() {
  ssSet(OVERRIDE_KEY, JSON.stringify(overrides));
}

function urlConfig() {
  const params = new URLSearchParams(location.search);
  const out = {};
  CONFIG_FIELDS.forEach(k => {
    if (!params.has(k)) return;
    const v = params.get(k) || "";
    out[k] = (k === "consignes" || k === "faq") ? v.replace(/\\n/g, "\n") : v;
  });
  return out;
}

function buildConfig() {
  const url = urlConfig();
  const cfg = { ...defaultConfig, ...remoteConfig, ...overrides, ...url };
  if (padFaq && !("faq" in overrides) && !("faq" in url) && !("faq" in externalConfig)) cfg.faq = padFaq;
  return applyLocks(cfg);
}

function refreshConfig() {
  const next = buildConfig();
  if (JSON.stringify(next) === JSON.stringify(config)) return;
  if (detect) markChanges(config, next);
  config = next;
  renderStatic();
  tick();
}

// ---------- chargement de la config depuis une URL ----------
// Priorité : ?config=URL  >  URL saisie dans ⚙  >  "source" dans config.json
function configSource() {
  return new URLSearchParams(location.search).get("config")
      || ssGet(SOURCE_KEY)
      || baseConfig.source
      || "";
}

// Transforme un lien de partage en lien de téléchargement direct
function normalizeSourceUrl(raw) {
  const url = (raw || "").trim();
  if (!/^https?:\/\//i.test(url)) return url;
  const host = new URL(url).hostname;
  let m;

  // Google Drive (fichier .txt / .json)
  if ((m = url.match(/drive\.google\.com\/file\/d\/([\w-]+)/)) ||
      (m = url.match(/drive\.google\.com\/(?:open|uc)\?(?:.*&)?id=([\w-]+)/)))
    return "https://drive.google.com/uc?export=download&id=" + m[1];

  // Google Docs
  if ((m = url.match(/docs\.google\.com\/document\/d\/([\w-]+)/)))
    return "https://docs.google.com/document/d/" + m[1] + "/export?format=txt";

  // Dropbox
  if (/(^|\.)dropbox\.com$/i.test(host)) {
    const u = new URL(url);
    u.hostname = "dl.dropboxusercontent.com";
    u.searchParams.delete("dl");
    u.searchParams.delete("raw");
    return u.toString();
  }

  // Framapad / Etherpad
  if (/pad/i.test(host) && /\/p\/[^/?#]+/.test(url)) {
    const base = url.split(/[?#]/)[0].replace(/\/+$/, "").replace(/\/export\/txt$/, "");
    return base + "/export/txt";
  }

  return url;
}

function withBust(url) {
  const u = new URL(url, location.href);
  u.searchParams.set("_t", Date.now());
  return u.toString();
}

async function fetchText(url) {
  const res = await fetch(withBust(url), { cache: "no-store" });
  if (!res.ok) throw new Error("HTTP " + res.status);
  return res.text();
}

const KEY_ALIASES = {
  mnemo: "mnemo", "mnémonique": "mnemo", mnemonique: "mnemo",
  title: "title", titre: "title",
  start: "start", "début": "start", debut: "start",
  end: "end", fin: "end",
  leave: "leave", sortie: "leave",
  pad: "pad"
};

// Accepte du JSON, ou un texte simple :
//   mnemo: INFOB318
//   debut: 13:00
//   [consignes]
//   - ...
//   [faq]
//   Question = Réponse
function parseConfigText(text) {
  const t = (text || "").replace(/^\uFEFF/, "").trim();
  if (t.startsWith("{")) return JSON.parse(t);
  if (t.startsWith("<")) throw new Error("page web reçue au lieu du fichier, le lien est-il public ?");

  const out = {};
  let section = null;
  let buf = [];
  const flush = () => { if (section) out[section] = buf.join("\n").trim(); buf = []; };

  for (const raw of t.split(/\r?\n/)) {
    const sec = raw.trim().match(/^\[\s*(consignes|faq)\s*\]$/i);
    if (sec) { flush(); section = sec[1].toLowerCase(); continue; }
    if (section) { buf.push(raw); continue; }
    const kv = raw.match(/^\s*([A-Za-zÀ-ÿ]+)\s*[:=]\s*(.*)$/);
    const key = kv && KEY_ALIASES[kv[1].toLowerCase()];
    if (key) out[key] = kv[2].trim();
  }
  flush();
  return out;
}

let sourceStatus = { text: "", ok: true };

function showSourceStatus() {
  const el = document.getElementById("srcMsg");
  el.textContent = sourceStatus.text;
  el.className = "srcMsg " + (sourceStatus.ok ? "ok" : "err");
}

async function fetchRemoteConfig() {
  try {
    baseConfig = parseConfigText(await fetchText(CONFIG_URL));
  } catch (e) {
    console.warn("config.json indisponible :", e.message);
  }

  const src = configSource();
  if (src) {
    try {
      externalConfig = parseConfigText(await fetchText(normalizeSourceUrl(src)));
      sourceStatus = { text: "✔ Config chargée à " + fmtHM(new Date()), ok: true };
    } catch (e) {
      // on garde la dernière version valide
      sourceStatus = { text: "✖ Lecture impossible (" + e.message + "). Vérifie que le lien est public.", ok: false };
    }
  } else {
    externalConfig = {};
    sourceStatus = { text: "", ok: true };
  }

  remoteConfig = { ...baseConfig, ...externalConfig };
  showSourceStatus();
  refreshConfig();
}

// ---------- cadenas (verrouillage des heures) ----------
const LOCK_KEY = "screentimer_locks";
const LOCKABLE = ["start", "end"];

function loadLocks() {
  try {
    const saved = ssGet(LOCK_KEY);
    if (saved !== null) return JSON.parse(saved);
  } catch (e) {}

  const params = new URLSearchParams(location.search);
  const locks = {};
  (params.get("lock") || "").split(",").forEach(k => {
    const v = params.get(k);
    if (LOCKABLE.includes(k) && parseTime(v)) locks[k] = v;
  });
  return locks;
}

function saveLocks() {
  ssSet(LOCK_KEY, JSON.stringify(locks));
}

function applyLocks(cfg) {
  LOCKABLE.forEach(k => { if (locks[k]) cfg[k] = locks[k]; });
  return cfg;
}

let locks = loadLocks();
saveLocks();
let config = buildConfig();

// ---------- détection des nouvelles modifications ----------
const HIGHLIGHT_MS = 5 * 60 * 1000;   // durée du surlignage
const fresh = { lines: new Map(), faq: new Map(), fields: new Map() };
let detect = false;                   // activé après le premier chargement
let faqJumpKey = null;                // nouvelle question : aller à sa page

function consigneLines(text) {
  return consignesToMd(text).split("\n").map(l => l.trim()).filter(Boolean);
}

function markChanges(prev, next) {
  const until = Date.now() + HIGHLIGHT_MS;

  const oldLines = new Set(consigneLines(prev.consignes));
  consigneLines(next.consignes).forEach(l => {
    if (!oldLines.has(l)) fresh.lines.set(l, until);
  });

  const oldFaq = new Set(parseFaq(prev.faq).map(faqKey));
  parseFaq(next.faq).forEach(f => {
    const k = faqKey(f);
    if (!oldFaq.has(k)) {
      fresh.faq.set(k, until);
      if (faqJumpKey === null) faqJumpKey = k;
    }
  });

  ["mnemo", "title", "start", "end", "leave"].forEach(k => {
    if ((prev[k] || "") !== (next[k] || "") && next[k]) fresh.fields.set(k, until);
  });
}

function pruneFresh() {
  const now = Date.now();
  let changed = false;
  [fresh.lines, fresh.faq, fresh.fields].forEach(map => {
    for (const [k, t] of map) if (t <= now) { map.delete(k); changed = true; }
  });
  if (changed) renderStatic();
}

// ---------- FAQ : toutes les questions ensemble, avec pages si ça déborde ----------
const FAQ_PAGE_MS = 15000;   // changement de page automatique
let faqList = [];
let faqPages = [[]];         // chaque page = liste d'indices de questions
let faqPage = 0;
let faqPaused = false;
let faqTimer = null;
function parseFaq(text) {
  return (text || "").split("\n")
    .map(l => l.replace(/^\s*[-*•]\s+/, ""))
    .filter(l => l.includes("="))
    .map(line => {
      const i = line.indexOf("=");
      return { q: line.slice(0, i).trim(), a: line.slice(i + 1).trim() };
    });
}
function faqKey(f) { return f.q + " = " + f.a; }

function showFaq() {
  const box = document.getElementById("faqList");
  const count = document.getElementById("faqCount");
  faqList = parseFaq(config.faq);

  if (!faqList.length) {
    box.innerHTML = '<p class="faqEmpty">Aucune question pour le moment.</p>';
    count.textContent = "";
    faqPages = [[]];
    faqPage = 0;
    document.getElementById("faqCtrl").hidden = true;
    scheduleFaq();
    return;
  }

  box.innerHTML = faqList.map(f => {
    const isNew = fresh.faq.has(faqKey(f));
    return `<div class="faqItem${isNew ? " fresh" : ""}">` +
             `<div class="faqQ">${isNew ? '<span class="badge">Nouveau</span> ' : ""}${mdInline(f.q)}</div>` +
             `<div class="faqA">${mdInline(f.a)}</div>` +
           `</div>`;
  }).join("");
  count.textContent = "(" + faqList.length + ")";
  paginateFaq();
}

// répartit les questions en pages selon la hauteur disponible
function splitFaq(items, avail) {
  if (!avail) return [items.map((_, i) => i)];   // panneau caché : pas de mesure possible
  const pages = [[]];
  let used = 0;
  items.forEach((el, i) => {
    const h = el.offsetHeight;
    if (used > 0 && used + h > avail) { pages.push([]); used = 0; }
    pages[pages.length - 1].push(i);
    used += h;
  });
  return pages;
}

function paginateFaq() {
  const box = document.getElementById("faqList");
  const ctrl = document.getElementById("faqCtrl");
  const items = [...box.querySelectorAll(".faqItem")];
  if (!items.length) return;

  // on mesure avec toutes les questions visibles
  items.forEach(el => { el.hidden = false; el.classList.remove("last"); });
  ctrl.hidden = true;
  let pages = splitFaq(items, box.clientHeight);
  if (pages.length > 1) {
    // les boutons prennent un peu de place : on refait le calcul avec eux
    ctrl.hidden = false;
    pages = splitFaq(items, box.clientHeight);
  }
  faqPages = pages;

  // nouvelle question : on va directement à sa page
  if (faqJumpKey !== null) {
    const idx = faqList.map(faqKey).indexOf(faqJumpKey);
    const p = faqPages.findIndex(pg => pg.includes(idx));
    if (p >= 0) faqPage = p;
    faqJumpKey = null;
  }
  if (faqPage >= faqPages.length) faqPage = 0;

  showFaqPage();
  scheduleFaq();
}

function showFaqPage() {
  const items = document.querySelectorAll("#faqList .faqItem");
  const page = faqPages[faqPage] || [];
  items.forEach((el, i) => { el.hidden = !page.includes(i); el.classList.remove("last"); });
  if (page.length) items[page[page.length - 1]].classList.add("last");

  const multi = faqPages.length > 1;
  document.getElementById("faqCtrl").hidden = !multi;
  document.getElementById("faqPage").textContent =
    multi ? `Page ${faqPage + 1} / ${faqPages.length}` : "";
}

function scheduleFaq() {
  clearTimeout(faqTimer);
  if (faqPaused || faqPages.length < 2) return;
  faqTimer = setTimeout(() => stepFaq(1), FAQ_PAGE_MS);
}

function stepFaq(d) {
  if (faqPages.length < 2) return;
  faqPage = (faqPage + d + faqPages.length) % faqPages.length;
  showFaqPage();
  scheduleFaq();
}

function updatePauseBtn() {
  const btn = document.getElementById("faqPause");
  btn.textContent = faqPaused ? "▶ Reprendre" : "⏸ Pause";
  btn.title = faqPaused ? "Reprendre le changement de page automatique"
                        : "Arrêter le changement de page automatique";
  btn.classList.toggle("paused", faqPaused);
}

document.getElementById("faqPause").addEventListener("click", () => {
  faqPaused = !faqPaused;
  updatePauseBtn();
  scheduleFaq();
});
document.getElementById("faqPrev").addEventListener("click", () => stepFaq(-1));
document.getElementById("faqNext").addEventListener("click", () => stepFaq(1));

// si la taille de l'écran change, on recalcule les pages
let faqResizeTimer = null;
window.addEventListener("resize", () => {
  clearTimeout(faqResizeTimer);
  faqResizeTimer = setTimeout(paginateFaq, 200);
});
if (document.fonts && document.fonts.ready) document.fonts.ready.then(paginateFaq);

// ---------- affichage statique ----------
function renderStatic() {
  const mnemoEl = document.getElementById("mnemo");
  mnemoEl.textContent = config.mnemo || "ScreenTimer";
  mnemoEl.classList.toggle("fresh", fresh.fields.has("mnemo"));

  const titleEl = document.getElementById("title");
  titleEl.innerHTML = mdInline(config.title || "");
  titleEl.classList.toggle("fresh", fresh.fields.has("title"));

  document.getElementById("consignes").innerHTML =
    mdBlock(consignesToMd(config.consignes), l => fresh.lines.has(l));

  showFaq();
}

// ---------- boucle horloge / minuteur ----------
function setBannerTime(key, id, date, locked) {
  const el = document.getElementById(id);
  el.textContent = fmtHM(date) + (locked ? " 🔒" : "");
  el.classList.toggle("locked", !!locked);
  el.parentElement.classList.toggle("fresh", fresh.fields.has(key));
}

function tick() {
  pruneFresh();

  const now = new Date();
  document.getElementById("clockNow").textContent =
    pad(now.getHours()) + ":" + pad(now.getMinutes()) + ":" + pad(now.getSeconds());

  const start = parseTime(config.start);
  const end = parseTime(config.end);
  const leave = parseTime(config.leave);

  setBannerTime("start", "clockStart", start, locks.start);
  setBannerTime("end", "clockEnd", end, locks.end);
  setBannerTime("leave", "clockLeave", leave, false);

  const leaveBox = document.getElementById("boxLeave");
  leaveBox.hidden = !leave;
  leaveBox.classList.toggle("open", !!leave && now >= leave);

  const timerEl = document.getElementById("timer");
  timerEl.className = "timer";

  if (!end) {
    timerEl.textContent = "--:--:--";
    timerEl.classList.add("idle");
    timerEl.title = "Ouvrez ⚙ pour définir une heure de fin.";
    return;
  }

  if (start && now < start) {
    timerEl.textContent = fmtDuration(start - now);
    timerEl.classList.add("wait");
    timerEl.title = "En attente du début (" + fmtHM(start) + ")";
    return;
  }

  if (now >= end) {
    timerEl.textContent = "00:00";
    timerEl.classList.add("alert");
    timerEl.title = "Terminé";
    return;
  }

  const remainMin = (end - now) / 60000;
  let tone = "calm";
  if (remainMin <= 3) tone = "alert";
  else if (remainMin <= 10) tone = "warn";
  if (tone === "calm" && leave && now >= leave) tone = "leave";

  timerEl.textContent = fmtDuration(end - now);
  timerEl.classList.add(tone);
  timerEl.title = "En cours";
}

// ---------- panneau de configuration ----------
const overlay = document.getElementById("overlay");
const lockMsg = document.getElementById("lockMsg");

function updateLockUI() {
  LOCKABLE.forEach(k => {
    const input = document.getElementById("f_" + k);
    const btn = document.querySelector(`.lockBtn[data-field="${k}"]`);
    const isLocked = !!locks[k];
    if (isLocked) input.value = locks[k];
    input.readOnly = isLocked;
    input.classList.toggle("locked", isLocked);
    btn.classList.toggle("locked", isLocked);
    btn.textContent = isLocked ? "🔒" : "🔓";
    btn.title = (isLocked ? "Déverrouiller" : "Verrouiller") +
                (k === "start" ? " l'heure de début" : " l'heure de fin");
  });
}

document.querySelectorAll(".lockBtn").forEach(btn => {
  btn.addEventListener("click", () => {
    const k = btn.dataset.field;
    const input = document.getElementById("f_" + k);
    lockMsg.textContent = "";

    if (locks[k]) {
      const label = k === "start" ? "de début" : "de fin";
      if (!confirm(`Déverrouiller l'heure ${label} (${locks[k]}) ?`)) return;
      delete locks[k];
    } else {
      const value = input.value.trim();
      const t = parseTime(value);
      if (!t) { lockMsg.textContent = "Heure invalide : format HH:MM attendu."; return; }

      const other = k === "start"
        ? parseTime(document.getElementById("f_end").value)
        : parseTime(document.getElementById("f_start").value);
      if (other && ((k === "start" && t >= other) || (k === "end" && t <= other))) {
        lockMsg.textContent = "L'heure de début doit être avant l'heure de fin.";
        return;
      }
      locks[k] = pad(t.getHours()) + ":" + pad(t.getMinutes());
      config[k] = locks[k];
    }
    saveLocks();
    updateLockUI();
    tick();
  });
});

document.getElementById("gearBtn").addEventListener("click", () => {
  document.getElementById("f_source").value = configSource();
  document.getElementById("f_mnemo").value = config.mnemo || "";
  document.getElementById("f_title").value = config.title || "";
  document.getElementById("f_start").value = config.start || "";
  document.getElementById("f_end").value = config.end || "";
  document.getElementById("f_leave").value = config.leave || "";
  document.getElementById("f_consignes").value = config.consignes || "";
  document.getElementById("f_faq").value = config.faq || "";
  document.getElementById("shareOut").style.display = "none";
  lockMsg.textContent = "";
  showSourceStatus();
  updateLockUI();
  overlay.classList.add("open");
});

document.getElementById("closeBtn").addEventListener("click", () => {
  overlay.classList.remove("open");
});

// Fermeture au clic à côté (sur le fond sombre)
overlay.addEventListener("click", (e) => {
  if (e.target === overlay) {
    overlay.classList.remove("open");
  }
});

function readForm() {
  return applyLocks({
    mnemo: document.getElementById("f_mnemo").value.trim(),
    title: document.getElementById("f_title").value.trim(),
    start: document.getElementById("f_start").value.trim(),
    end: document.getElementById("f_end").value.trim(),
    leave: document.getElementById("f_leave").value.trim(),
    consignes: document.getElementById("f_consignes").value,
    faq: document.getElementById("f_faq").value
  });
}

// Contenu de config.json (dépôt) à partir du formulaire
function configForRepo() {
  const form = readForm();
  const out = {};
  CONFIG_FIELDS.forEach(k => { out[k] = form[k]; });
  out.pad = baseConfig.pad || "";
  const src = document.getElementById("f_source").value.trim();
  if (src) out.source = src;
  return out;
}

document.getElementById("applyBtn").addEventListener("click", () => {
  const src = document.getElementById("f_source").value.trim();
  ssSet(SOURCE_KEY, src && src !== (baseConfig.source || "") ? src : null);

  const form = readForm();
  overrides = {};
  CONFIG_FIELDS.forEach(k => {
    const base = k in remoteConfig ? remoteConfig[k] : defaultConfig[k];
    if (form[k] !== base) overrides[k] = form[k];
  });
  saveOverrides();
  refreshConfig();
  fetchRemoteConfig();
  overlay.classList.remove("open");
});

document.getElementById("downloadBtn").addEventListener("click", () => {
  const out = configForRepo();
  const blob = new Blob([JSON.stringify(out, null, 2) + "\n"], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "config.json";
  a.click();
  URL.revokeObjectURL(a.href);
});

document.getElementById("resetBtn").addEventListener("click", () => {
  overrides = {};
  saveOverrides();
  ssSet(SOURCE_KEY, null);
  refreshConfig();
  fetchRemoteConfig();
  overlay.classList.remove("open");
});

document.getElementById("shareBtn").addEventListener("click", () => {
  const cfg = readForm();
  const params = new URLSearchParams();
  const src = document.getElementById("f_source").value.trim();
  if (src) params.set("config", src);
  const padParam = new URLSearchParams(location.search).get("pad");
  if (padParam) params.set("pad", padParam);
  ["mnemo", "title", "start", "end", "leave"].forEach(k => {
    if (cfg[k]) params.set(k, cfg[k]);
  });
  if (cfg.consignes) params.set("consignes", cfg.consignes.replace(/\n/g, "\\n"));
  if (cfg.faq) params.set("faq", cfg.faq.replace(/\n/g, "\\n"));
  const lockedKeys = LOCKABLE.filter(k => locks[k]);
  if (lockedKeys.length) params.set("lock", lockedKeys.join(","));

  const url = location.origin + location.pathname + "?" + params.toString();
  const out = document.getElementById("shareOut");
  out.value = url;
  out.style.display = "block";
  out.select();
});

// ---------- FAQ partagée (Framapad) ----------
const PAD_HOST = "https://annuel.framapad.org";
const PAD_DEFAULT = "https://mensuel.framapad.org/p/testgestionesi-anr1";
const PAD_REFRESH_MS = 60000;

function padUrl() {
  const p = new URLSearchParams(location.search).get("pad") || remoteConfig.pad || PAD_DEFAULT;
  if (/^https?:\/\//.test(p)) return p.split(/[?#]/)[0].replace(/\/+$/, "");
  return PAD_HOST + "/p/" + encodeURIComponent(p);
}

function parsePadFaq(text) {
  return text.split("\n")
    .map(l => l.replace(/^\s*[-*•]\s+/, "").trim())
    .filter(l => l.includes("="))
    .join("\n");
}

async function syncFaqFromPad() {
  try {
    const res = await fetch(padUrl() + "/export/txt", { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const faq = parsePadFaq(await res.text());
    if (faq && faq !== padFaq) {
      padFaq = faq;
      refreshConfig();
    }
  } catch (e) {
    console.warn("FAQ Framapad indisponible :", e.message);
  }
}

function scheduleFaqSync() {
  syncFaqFromPad().finally(() =>
    setTimeout(scheduleFaqSync, PAD_REFRESH_MS + Math.random() * 15000));
}

let firstPadSync = Promise.resolve();
if (padUrl()) {
  const link = document.getElementById("padLink");
  link.href = padUrl();
  link.style.display = "block";
  firstPadSync = new Promise(r => setTimeout(r, Math.random() * 5000))
    .then(syncFaqFromPad)
    .finally(() => setTimeout(scheduleFaqSync, PAD_REFRESH_MS + Math.random() * 15000));
}

// ---------- modes d'affichage (bouton 🔄) ----------
// 0 = côte à côte, 1 = alterné (consignes / FAQ toutes les 30 s), 2 = dashboard (cartes)
const CAROUSEL_MS = 30000;
let currentDisplayMode = 0;
let carouselTimer = null;
let currentCarouselIndex = 0; // 0 = Consignes, 1 = FAQ

const viewToggleBtn = document.getElementById("viewToggleBtn");
const panelsContainer = document.querySelector(".panels");
const panelsList = document.querySelectorAll(".panel");

function updateCarouselView() {
  if (currentDisplayMode !== 1) return;
  panelsList.forEach(p => p.classList.remove("active"));
  panelsList[currentCarouselIndex].classList.add("active");
  paginateFaq();
}

function clearCarouselInterval() {
  if (carouselTimer) {
    clearInterval(carouselTimer);
    carouselTimer = null;
  }
}

function applyDisplayMode(mode) {
  currentDisplayMode = mode;

  clearCarouselInterval();
  panelsContainer.classList.remove("carousel-mode", "card-dashboard-mode");
  document.body.classList.remove("dashboard-mode-active");
  panelsList.forEach(p => p.classList.remove("active"));

  switch (currentDisplayMode) {
    case 0:
      viewToggleBtn.style.background = "#eae2d3";
      viewToggleBtn.title = "Mode actuel : Côte à côte";
      break;

    case 1:
      panelsContainer.classList.add("carousel-mode");
      currentCarouselIndex = 0;
      updateCarouselView();
      carouselTimer = setInterval(() => {
        currentCarouselIndex = (currentCarouselIndex + 1) % panelsList.length;
        updateCarouselView();
      }, CAROUSEL_MS);
      viewToggleBtn.style.background = "#3e7cb1";
      viewToggleBtn.title = "Mode actuel : Alterné 30s";
      break;

    case 2:
      panelsContainer.classList.add("card-dashboard-mode");
      document.body.classList.add("dashboard-mode-active");
      viewToggleBtn.style.background = "#10b981";
      viewToggleBtn.title = "Mode actuel : Dashboard";
      break;
  }
  paginateFaq();   // la place disponible change selon le mode
}

viewToggleBtn.addEventListener("click", () => {
  applyDisplayMode((currentDisplayMode + 1) % 3); // 0 -> 1 -> 2 -> 0
});

// ---------- démarrage ----------
updatePauseBtn();
applyDisplayMode(0);
renderStatic();
tick();
setInterval(tick, 1000);

// La détection des nouveautés démarre après le premier chargement
// (sinon tout serait surligné à l'ouverture de la page)
Promise.allSettled([fetchRemoteConfig(), firstPadSync]).then(() => { detect = true; });
setInterval(fetchRemoteConfig, CONFIG_REFRESH_MS);
