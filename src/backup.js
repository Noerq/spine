// Export/import of the whole library as a JSON file.

import * as db from "./db.js";

const FORMAT = "spine-backup";

export async function exportLibrary() {
  const books = await db.getAllRaw();
  const payload = { format: FORMAT, version: 1, exportedAt: new Date().toISOString(), books };
  const date = new Date().toISOString().slice(0, 10);
  const file = new File([JSON.stringify(payload, null, 1)], `spine-${date}.json`, { type: "application/json" });

  // iPhone/iPad: share sheet offers "In Dateien sichern" -> iCloud Drive.
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
    } catch (e) {
      if (e.name === "AbortError") return false;
      throw e;
    }
  } else {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(file);
    a.download = file.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  }
  await db.setMeta("lastExport", payload.exportedAt);
  return true;
}

export async function importLibrary(file) {
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch {
    throw new Error("Die Datei ist keine gültige Spine-Sicherung.");
  }
  if (data?.format !== FORMAT || !Array.isArray(data.books)) {
    throw new Error("Die Datei ist keine gültige Spine-Sicherung.");
  }
  const books = data.books.filter(
    (b) => b && typeof b.isbn === "string" && typeof b.updatedAt === "string" && (b.deleted || typeof b.title === "string"),
  );
  return db.merge(books);
}
