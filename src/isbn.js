// ISBN helpers: normalize, validate, convert ISBN-10 to ISBN-13.

export function clean(raw) {
  return String(raw || "").toUpperCase().replace(/[^0-9X]/g, "");
}

export function isValidIsbn13(s) {
  if (!/^97[89]\d{10}$/.test(s)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(s[i]) * (i % 2 ? 3 : 1);
  return (10 - (sum % 10)) % 10 === Number(s[12]);
}

export function isValidIsbn10(s) {
  if (!/^\d{9}[\dX]$/.test(s)) return false;
  let sum = 0;
  for (let i = 0; i < 10; i++) sum += (s[i] === "X" ? 10 : Number(s[i])) * (10 - i);
  return sum % 11 === 0;
}

function isbn10to13(s) {
  const base = "978" + s.slice(0, 9);
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(base[i]) * (i % 2 ? 3 : 1);
  return base + ((10 - (sum % 10)) % 10);
}

/** Returns a valid ISBN-13 or null. */
export function toIsbn13(raw) {
  const s = clean(raw);
  if (isValidIsbn13(s)) return s;
  if (isValidIsbn10(s)) return isbn10to13(s);
  return null;
}

export function format(isbn) {
  return isbn.length === 13 ? `${isbn.slice(0, 3)}-${isbn.slice(3)}` : isbn;
}
