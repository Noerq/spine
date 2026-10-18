// Book lookup by ISBN: Deutsche Nationalbibliothek first, Open Library as fallback.

const TIMEOUT_MS = 8000;

async function fetchWithTimeout(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal, referrerPolicy: "no-referrer" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res;
  } finally {
    clearTimeout(timer);
  }
}

// DNB marks non-sorting articles with control chars (\u0098 … \u009c) or "¬".
function tidy(s) {
  return (s || "")
    .replace(/[\u0098\u009c¬]/g, "")
    .replace(/\s*[/:;=]\s*$/, "")
    .replace(/,\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

// "Tolkien, J. R. R." -> "J. R. R. Tolkien"
function uninvert(name) {
  const n = tidy(name);
  const m = n.match(/^([^,]+),\s*(.+)$/);
  return m ? `${m[2]} ${m[1]}` : n;
}

// --- Deutsche Nationalbibliothek (SRU, MARC21-xml) ---

async function fromDnb(isbn) {
  const url = `https://services.dnb.de/sru/dnb?version=1.1&operation=searchRetrieve&query=num%3D${isbn}&recordSchema=MARC21-xml&maximumRecords=5`;
  const xml = await (await fetchWithTimeout(url)).text();
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const records = [...doc.getElementsByTagNameNS("*", "record")].filter(
    (r) => r.getAttribute("type") === "Bibliographic",
  );

  for (const rec of records) {
    const fields = [...rec.getElementsByTagNameNS("*", "datafield")];
    const field = (tag) => fields.filter((f) => f.getAttribute("tag") === tag);
    const sub = (f, code) =>
      [...(f?.getElementsByTagNameNS("*", "subfield") || [])]
        .filter((s) => s.getAttribute("code") === code)
        .map((s) => s.textContent);

    // 245: $a title, $b subtitle, $n/$p volume number/title. Cut off " / statement of responsibility".
    const f245 = field("245")[0];
    const part = (code) => tidy((sub(f245, code)[0] || "").split(" / ")[0]);
    const mainTitle = part("a");
    if (!mainTitle) continue;
    const volTitle = part("p");
    const series = part("n") || volTitle ? [mainTitle, part("n")].filter(Boolean).join(" ") : "";
    const title = volTitle || mainTitle;

    const authors = [
      ...field("100").map((f) => sub(f, "a")[0]),
      ...field("700").filter((f) => sub(f, "4").includes("aut")).map((f) => sub(f, "a")[0]),
    ].filter(Boolean).map(uninvert);

    const pub = field("264").find((f) => f.getAttribute("ind2") === "1") || field("260")[0];

    return {
      title,
      subtitle: part("b"),
      authors: [...new Set(authors)],
      publisher: tidy(sub(pub, "b")[0]),
      year: (sub(pub, "c")[0] || "").match(/\d{4}/)?.[0] || "",
      pages: (sub(field("300")[0], "a")[0] || "").match(/\d+/)?.[0] || "",
      language: sub(field("041")[0], "a")[0] || "",
      series,
      source: "DNB",
    };
  }
  return null;
}

// --- Open Library ---

async function fromOpenLibrary(isbn) {
  const url = `https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`;
  const data = (await (await fetchWithTimeout(url)).json())[`ISBN:${isbn}`];
  if (!data?.title) return null;
  return {
    title: data.title,
    subtitle: data.subtitle || "",
    authors: (data.authors || []).map((a) => a.name),
    publisher: data.publishers?.[0]?.name || "",
    year: (data.publish_date || "").match(/\d{4}/)?.[0] || "",
    pages: data.number_of_pages ? String(data.number_of_pages) : "",
    language: "",
    series: "",
    source: "Open Library",
  };
}

// --- Covers ---
// DNB/MVB covers sit behind a bot challenge (Anubis) for browsers, so we use
// Google Books' image endpoint (no API key, no quota) and Open Library.

// Real Google covers are scaled up by fife=w400 (>= 300px wide). Its placeholders
// ("image not available", generic grey book) stay at 128px.
const isGooglePlaceholder = (img) => img.naturalWidth <= 128;

function imageLoads(url, rejectIf = () => false) {
  return new Promise((resolve) => {
    const img = new Image();
    img.referrerPolicy = "no-referrer";
    const timer = setTimeout(() => resolve(false), TIMEOUT_MS);
    img.onload = () => { clearTimeout(timer); resolve(img.naturalWidth > 1 && !rejectIf(img)); };
    img.onerror = () => { clearTimeout(timer); resolve(false); };
    img.src = url;
  });
}

export async function findCover(isbn) {
  const google = `https://books.google.com/books/content?vid=ISBN:${isbn}&printsec=frontcover&img=1&zoom=1&fife=w400-h600`;
  if (await imageLoads(google, isGooglePlaceholder)) return google;
  const ol = `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg?default=false`;
  if (await imageLoads(ol)) return ol;
  return "";
}

/**
 * Cover of another German edition of the same book: ask the DNB for editions with
 * the same title and author, then try their ISBNs (newest first). Returns "" if none.
 */
export async function findSimilarCover({ isbn, title, authors }) {
  const cql = (s) => s.replace(/["?*!<>=\/()]/g, " ").replace(/\s+/g, " ").trim();
  const t = cql(title || "");
  if (!t) return "";
  const lastName = cql((authors?.[0] || "").split(" ").pop() || "");
  const query = `tit="${t}"` + (lastName ? ` and per=${lastName}` : "");
  const url = `https://services.dnb.de/sru/dnb?version=1.1&operation=searchRetrieve&query=${encodeURIComponent(query)}&recordSchema=MARC21-xml&maximumRecords=25`;
  try {
    const xml = await (await fetchWithTimeout(url)).text();
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    const isbns = [];
    for (const f of doc.getElementsByTagNameNS("*", "datafield")) {
      if (f.getAttribute("tag") !== "020") continue;
      for (const sf of f.getElementsByTagNameNS("*", "subfield")) {
        const m = sf.textContent.replace(/-/g, "").match(/97[89]\d{10}/);
        if (m && m[0] !== isbn && !isbns.includes(m[0])) isbns.push(m[0]);
      }
    }
    for (const other of isbns.slice(0, 10)) {
      const cover = await findCover(other);
      if (cover) return cover;
    }
  } catch (e) {
    console.warn("similar cover", e);
  }
  return "";
}

/**
 * Look up a book. Returns metadata (or null if not found anywhere).
 * Throws only if every source failed due to network errors.
 */
export async function lookupIsbn(isbn) {
  const coverPromise = findCover(isbn);
  let networkErrors = 0;
  let meta = null;
  for (const source of [fromDnb, fromOpenLibrary]) {
    try {
      meta = await source(isbn);
      if (meta) break;
    } catch (e) {
      console.warn(source.name, e);
      networkErrors++;
    }
  }
  if (!meta && networkErrors === 2) throw new Error("offline");
  const coverUrl = await coverPromise;
  return meta ? { ...meta, coverUrl } : null;
}
