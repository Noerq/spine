import "./style.css";
import * as db from "./db.js";
import { toIsbn13, format as formatIsbn } from "./isbn.js";
import { lookupIsbn, findCover, findSimilarCover } from "./lookup.js";
import { exportLibrary, importLibrary } from "./backup.js";

const $ = (sel) => document.querySelector(sel);
const STATUS = { unread: "Ungelesen", reading: "Lese gerade", read: "Gelesen" };

const state = { books: [], filter: "all", query: "", sort: "added" };

// ---------- helpers ----------

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const fold = (s) => String(s ?? "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

const initials = (title) => esc((title || "?").trim().charAt(0).toUpperCase());

function coverHtml(book, big = false) {
  const cls = `cover${big ? " big" : ""}`;
  return book.coverUrl
    ? `<img class="${cls}" src="${esc(book.coverUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer" data-initial="${initials(book.title)}">`
    : `<div class="${cls}" aria-hidden="true">${initials(book.title)}</div>`;
}

// Broken cover image -> placeholder with initial
document.addEventListener("error", (e) => {
  const img = e.target;
  if (img instanceof HTMLImageElement && img.classList.contains("cover")) {
    const div = document.createElement("div");
    div.className = img.className;
    div.textContent = img.dataset.initial || "?";
    img.replaceWith(div);
  }
}, true);

let toastTimer;
function toast(msg) {
  const el = $("#toast");
  // Keep the toast above open modal dialogs (top layer)
  const openDlg = document.querySelector("dialog[open]");
  (openDlg || document.body).appendChild(el);
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2600);
}

const isIos = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isStandalone = () => navigator.standalone === true || matchMedia("(display-mode: standalone)").matches;

function lsGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } }

// ---------- list ----------

async function reload() {
  state.books = await db.getAll();
  render();
  updateBanner();
}

function render() {
  const q = fold(state.query.trim());
  const qDigits = state.query.replace(/[^0-9X]/gi, "");
  let items = state.books.filter((b) => state.filter === "all" || b.status === state.filter);
  if (q) {
    items = items.filter((b) => {
      const hay = fold([b.title, b.subtitle, b.authors?.join(" "), b.publisher, b.series].join(" "));
      return q.split(/\s+/).every((w) => hay.includes(w)) || (qDigits.length >= 4 && b.isbn.includes(qDigits));
    });
  }
  const byAuthor = (b) => fold(b.authors?.[0]?.split(" ").pop() || "~");
  const cmp = {
    added: (a, b) => (b.addedAt || "").localeCompare(a.addedAt || ""),
    title: (a, b) => a.title.localeCompare(b.title, "de", { sensitivity: "base" }),
    author: (a, b) => byAuthor(a).localeCompare(byAuthor(b), "de") || a.title.localeCompare(b.title, "de"),
  }[state.sort];
  items.sort(cmp);

  const total = state.books.length;
  $("#count").textContent = total ? `${total} ${total === 1 ? "Buch" : "Bücher"}` : "";

  $("#list").innerHTML = items
    .map(
      (b) => `<li><button class="book" data-isbn="${esc(b.isbn)}">
        ${coverHtml(b)}
        <span class="book-text">
          <span class="book-title">${esc(b.title)}</span>
          <span class="book-author">${esc(b.authors?.join(", ") || "")}</span>
          <span class="pill ${esc(b.status)}">${STATUS[b.status] || ""}</span>
        </span>
      </button></li>`,
    )
    .join("");

  const empty = $("#empty");
  empty.hidden = items.length > 0;
  empty.innerHTML = total
    ? `<p>Keine Bücher gefunden.</p>`
    : `<h2>Noch keine Bücher</h2><p>Tipp unten auf <b>Buch scannen</b> und halte die Kamera auf den Barcode auf der Rückseite.</p>`;
}

$("#list").addEventListener("click", (e) => {
  const btn = e.target.closest(".book");
  if (!btn) return;
  const book = state.books.find((b) => b.isbn === btn.dataset.isbn);
  if (book) showBook({ book, isNew: false });
});

let searchTimer;
$("#search").addEventListener("input", (e) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { state.query = e.target.value; render(); }, 120);
});

document.querySelector(".filters").addEventListener("click", (e) => {
  const chip = e.target.closest(".chip");
  if (!chip) return;
  document.querySelectorAll(".chip").forEach((c) => c.classList.toggle("active", c === chip));
  state.filter = chip.dataset.filter;
  render();
});

$("#sort").addEventListener("change", (e) => {
  state.sort = e.target.value;
  lsSet("spine.sort", state.sort);
  render();
});

// ---------- banner (install hint / backup reminder) ----------

async function updateBanner() {
  const banner = $("#banner");
  let html = "";
  let action = null;

  if (isIos() && !isStandalone() && !lsGet("spine.installHintDismissed")) {
    html = `<p><b>Tipp:</b> Tipp auf „Teilen“ → „Zum Home-Bildschirm“. Nur so bleiben deine Bücher sicher gespeichert. Erfass sie dann in der installierten App, denn die hat ihren eigenen Speicher.</p><button data-act="dismiss">OK</button>`;
    action = () => lsSet("spine.installHintDismissed", "1");
  } else if (state.books.length) {
    const last = await db.getMeta("lastExport");
    const newest = (await db.getAllRaw()).reduce((m, b) => (b.updatedAt > m ? b.updatedAt : m), "");
    const days = last ? (Date.now() - Date.parse(last)) / 864e5 : Infinity;
    if (newest > (last || "") && days > 7) {
      html = `<p>${last ? `Letzte Sicherung vor ${Math.floor(days)} Tagen.` : "Du hast noch keine Sicherung."} Sicher deine Bücher in iCloud Drive.</p><button data-act="backup">Jetzt sichern</button>`;
      action = () => openMenu();
    }
  }

  banner.hidden = !html;
  banner.innerHTML = html;
  banner.onclick = (e) => {
    if (!e.target.closest("button")) return;
    action?.();
    banner.hidden = true;
  };
}

// ---------- scanner ----------

let stopScan = null;
let scannerModule = null;

async function openScanner() {
  const dlg = $("#scanDlg");
  const hint = $("#scanHint");
  hint.textContent = "Halte den Barcode auf der Rückseite in den Rahmen";
  $("#manualIsbn").value = "";
  dlg.showModal();

  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    hint.textContent = "Kamera nicht verfügbar. Tipp die ISBN unten ein.";
    return;
  }
  try {
    scannerModule ??= await import("./scanner.js");
    stopScan = await scannerModule.startScanner($("#video"), (isbn) => {
      closeScanner();
      handleIsbn(isbn);
    });
  } catch (e) {
    console.warn(e);
    hint.textContent =
      e.name === "NotAllowedError"
        ? "Kein Kamerazugriff. Erlaube die Kamera in den Einstellungen oder tipp die ISBN unten ein."
        : "Kamera konnte nicht gestartet werden. Tipp die ISBN unten ein.";
  }
}

function closeScanner() {
  stopScan?.();
  stopScan = null;
  $("#scanDlg").close();
}

$("#addBtn").addEventListener("click", openScanner);
$("#scanClose").addEventListener("click", closeScanner);
$("#scanDlg").addEventListener("cancel", () => { stopScan?.(); stopScan = null; });

$("#manualForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const isbn = toIsbn13($("#manualIsbn").value);
  if (!isbn) {
    $("#scanHint").textContent = "Das ist keine gültige ISBN. Bitte prüf die Ziffern.";
    return;
  }
  closeScanner();
  handleIsbn(isbn);
});

// ---------- book sheet ----------

const bookDlg = $("#bookDlg");
const bookBody = $("#bookBody");

async function handleIsbn(isbn) {
  const existing = await db.get(isbn);
  if (existing) {
    showBook({ book: existing, isNew: false, notice: "Dieses Buch ist schon in deinem Bestand." });
    return;
  }
  bookBody.innerHTML = `<div class="spinner"></div><p class="muted" style="text-align:center">Suche ISBN ${esc(formatIsbn(isbn))} …</p>`;
  if (!bookDlg.open) bookDlg.showModal();

  const draft = { isbn, status: "unread", title: "", subtitle: "", authors: [], coverUrl: "" };
  try {
    const meta = await lookupIsbn(isbn);
    if (meta) showBook({ book: { ...draft, ...meta }, isNew: true });
    else showBook({ book: draft, isNew: true, editing: true, notice: "Zu dieser ISBN haben wir nichts gefunden. Trag Titel und Autor einfach selbst ein." });
  } catch {
    showBook({ book: draft, isNew: true, editing: true, retry: true, notice: "Keine Internetverbindung. Du kannst das Buch trotzdem von Hand eintragen." });
  }
}

function showBook({ book, isNew, editing = false, notice = "", retry = false }) {
  const b = { ...book };
  const facts = [b.publisher, b.year, b.pages && `${b.pages} Seiten`].filter(Boolean).join(" · ");

  bookBody.innerHTML = `
    ${notice ? `<p class="notice">${esc(notice)}</p>` : ""}
    <div class="detail-head">
      <div class="cover-col">
        ${coverHtml(b, true)}
        <label class="link photo-btn">
          ${b.coverUrl ? "Foto ändern" : "Cover fotografieren"}
          <input type="file" accept="image/*" capture="environment" hidden data-photo>
        </label>
      </div>
      <div>
        <h2>${esc(b.title || "Unbekannter Titel")}</h2>
        ${b.subtitle ? `<div class="subtitle">${esc(b.subtitle)}</div>` : ""}
        <div class="author">${esc(b.authors?.join(", ") || "")}</div>
        ${b.series ? `<div class="facts">${esc(b.series)}</div>` : ""}
        <div class="facts">${esc(facts)}</div>
        <div class="facts">ISBN ${esc(formatIsbn(b.isbn))}</div>
      </div>
    </div>
    ${!b.coverUrl && b.title && !b.coverDeclined ? `
      <div class="suggest" id="coverSuggest"><p class="muted small">Kein Cover für diese Ausgabe. Ich suche ein ähnliches …</p></div>` : ""}
    ${editing ? `
      <form class="edit" id="editForm">
        <label>Titel <input name="title" value="${esc(b.title)}" required></label>
        <label>Autor*in (mehrere mit Komma trennen) <input name="authors" value="${esc(b.authors?.join(", "))}"></label>
      </form>` : ""}
    <div class="status-group" role="group" aria-label="Lesestatus">
      ${Object.entries(STATUS).map(([k, label]) => `<button type="button" data-status="${k}" aria-pressed="${b.status === k}">${label}</button>`).join("")}
    </div>
    ${isNew ? `
      <div class="row">
        <button class="btn ghost" data-act="save">Speichern</button>
        <button class="btn" data-act="saveNext">Speichern &amp; nächstes</button>
      </div>
      <div class="row">
        ${retry ? `<button class="link" data-act="retry">Nochmal suchen</button>` : ""}
        ${!editing ? `<button class="link" data-act="edit">Angaben korrigieren</button>` : ""}
        <button class="link" data-act="cancel" style="margin-left:auto">Verwerfen</button>
      </div>` : `
      ${editing ? `<button class="btn wide" data-act="saveEdit">Änderungen speichern</button>` : ""}
      <div class="row">
        ${!editing ? `<button class="btn ghost" data-act="edit">Bearbeiten</button>` : ""}
        <button class="btn danger" data-act="delete">Löschen</button>
      </div>
      <button class="btn ghost wide" data-act="close">Fertig</button>`}
  `;
  if (!bookDlg.open) bookDlg.showModal();

  const readForm = () => {
    const form = bookBody.querySelector("#editForm");
    if (!form) return true;
    const title = form.title.value.trim();
    if (!title) { form.title.focus(); return false; }
    b.title = title;
    b.authors = form.authors.value.split(",").map((s) => s.trim()).filter(Boolean);
    return true;
  };

  bookBody.querySelector("[data-photo]").onchange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      readForm();
      b.coverUrl = await photoToDataUrl(file);
      if (!isNew) {
        await db.put(b);
        await reload();
      }
      showBook({ book: b, isNew, editing });
      toast("Cover gespeichert");
    } catch (err) {
      console.error(err);
      toast("Foto konnte nicht verarbeitet werden");
    }
  };

  const suggestBox = bookBody.querySelector("#coverSuggest");
  if (suggestBox) {
    if (!similarCache.has(b.isbn)) similarCache.set(b.isbn, findSimilarCover(b));
    similarCache.get(b.isbn).then((url) => {
      if (!suggestBox.isConnected) return;
      suggestBox.innerHTML = url
        ? `<img class="cover" src="${esc(url)}" alt="" referrerpolicy="no-referrer" data-initial="?">
           <div>
             <p class="small">Kein Cover für genau diese Ausgabe. Passt dieses Cover einer anderen Ausgabe?</p>
             <div class="suggest-actions">
               <button class="btn small-btn" data-act="useSimilar" data-url="${esc(url)}">Verwenden</button>
               <button class="btn ghost small-btn" data-act="photo">Foto machen</button>
             </div>
             <button class="link" data-act="noCover">Ohne Cover lassen</button>
           </div>`
        : `<div>
             <p class="small">Kein Cover gefunden. Du kannst es selbst fotografieren.</p>
             <div class="suggest-actions">
               <button class="btn ghost small-btn" data-act="photo">Foto machen</button>
               <button class="link" data-act="noCover">Ohne Cover lassen</button>
             </div>
           </div>`;
    });
  }

  bookBody.onclick = async (e) => {
    const statusBtn = e.target.closest("[data-status]");
    if (statusBtn) {
      b.status = statusBtn.dataset.status;
      bookBody.querySelectorAll("[data-status]").forEach((x) => x.setAttribute("aria-pressed", x === statusBtn));
      if (!isNew) {
        await db.put(b);
        await reload();
        toast(`Status: ${STATUS[b.status]}`);
      }
      return;
    }
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (!act) return;

    if (act === "photo") {
      bookBody.querySelector("[data-photo]").click();
      return;
    }
    if (act === "useSimilar" || act === "noCover") {
      readForm();
      if (act === "useSimilar") b.coverUrl = e.target.closest("[data-url]").dataset.url;
      else b.coverDeclined = true;
      if (!isNew) {
        await db.put(b);
        await reload();
      }
      showBook({ book: b, isNew, editing });
      return;
    }
    if (act === "save" || act === "saveNext") {
      if (!readForm()) return;
      await db.put(b);
      navigator.storage?.persist?.();
      bookDlg.close();
      await reload();
      toast(`„${b.title}“ gespeichert`);
      if (act === "saveNext") openScanner();
    } else if (act === "saveEdit") {
      if (!readForm()) return;
      await db.put(b);
      await reload();
      showBook({ book: b, isNew: false });
      toast("Gespeichert");
    } else if (act === "edit") {
      readForm();
      showBook({ book: b, isNew, editing: true });
    } else if (act === "retry") {
      handleIsbn(b.isbn);
    } else if (act === "delete") {
      if (!confirm(`„${b.title}“ wirklich löschen?`)) return;
      await db.remove(b.isbn);
      bookDlg.close();
      await reload();
      toast("Gelöscht");
    } else if (act === "cancel" || act === "close") {
      bookDlg.close();
    }
  };
}

const similarCache = new Map();

// Shrink a cover photo to max 400px and store it inline as JPEG (~20-40 KB).
async function photoToDataUrl(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const scale = Math.min(1, 400 / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.8);
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Fill in missing covers for existing books (and replace old DNB cover links,
// which browsers can't load). Runs quietly in the background, at most once a week per book.
async function refreshCovers() {
  if (!navigator.onLine) return;
  const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString();
  const todo = (await db.getAll()).filter(
    (b) => (!b.coverUrl || b.coverUrl.startsWith("https://portal.dnb.de/")) && !(b.coverCheckedAt > weekAgo),
  );
  let changed = false;
  for (const b of todo) {
    const coverUrl = await findCover(b.isbn);
    const current = await db.get(b.isbn);
    if (!current || (current.coverUrl && !current.coverUrl.startsWith("https://portal.dnb.de/"))) continue;
    await db.putQuiet({ ...current, coverUrl, coverCheckedAt: new Date().toISOString() });
    changed ||= !!coverUrl || !!current.coverUrl;
  }
  if (changed) await reload();
}

// ---------- backup menu ----------

const menuDlg = $("#menuDlg");

async function openMenu() {
  const last = await db.getMeta("lastExport");
  $("#backupInfo").textContent = `${state.books.length} Bücher auf diesem Gerät · Letzte Sicherung: ${
    last ? new Date(last).toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" }) : "noch nie"
  }`;
  const persisted = await navigator.storage?.persisted?.();
  $("#storageInfo").textContent = persisted
    ? "Dauerhafter Speicher ist aktiv."
    : isIos() && !isStandalone()
      ? "Hinweis: Im Safari-Tab kann iOS die Daten nach längerer Nichtnutzung löschen. Installier die App auf dem Home-Bildschirm."
      : "";
  menuDlg.showModal();
}

$("#menuBtn").addEventListener("click", openMenu);

$("#exportBtn").addEventListener("click", async () => {
  try {
    if (await exportLibrary()) {
      menuDlg.close();
      toast("Sicherung erstellt");
      updateBanner();
    }
  } catch (e) {
    console.error(e);
    toast("Export fehlgeschlagen");
  }
});

$("#importInput").addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  e.target.value = "";
  if (!file) return;
  try {
    const s = await importLibrary(file);
    menuDlg.close();
    await reload();
    const parts = [s.added && `${s.added} neu`, s.updated && `${s.updated} aktualisiert`, s.removed && `${s.removed} entfernt`].filter(Boolean);
    toast(parts.length ? `Import fertig: ${parts.join(", ")}` : "Import fertig: alles schon aktuell");
  } catch (err) {
    toast(err.message || "Import fehlgeschlagen");
  }
});

// ---------- dialogs: close on backdrop / [data-close] ----------

for (const dlg of document.querySelectorAll("dialog.sheet")) {
  dlg.addEventListener("click", (e) => {
    const r = dlg.getBoundingClientRect();
    const outside = e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
    if ((e.target === dlg && outside) || e.target.closest("[data-close]")) dlg.close();
  });
}

// ---------- start ----------

state.sort = lsGet("spine.sort") || "added";
$("#sort").value = state.sort;
reload().then(refreshCovers);
