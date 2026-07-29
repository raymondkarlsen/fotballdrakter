/**
 * Konverterer CSV-eksporten fra Google Sheets (fanen `drakter_v2`) til JSON.
 * Kjør: node scripts/csv-to-json.mjs <sti-til-csv>
 *
 * Ny kolonnestruktur (leses på header-navn, ikke posisjon):
 *   id, klubb, type, land, landskode, sesong_start, sesong_slutt,
 *   drakttype, farger, produsent, spiller, notat, kitarchive_url, bilde
 */
import { readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const csvPath = process.argv[2];
if (!csvPath) {
  console.error("Bruk: node scripts/csv-to-json.mjs <sti-til-csv>");
  process.exit(1);
}

const raw = readFileSync(resolve(csvPath), "utf-8");

/** Parser hele CSV-en (håndterer siterte felt og linjeskift inni felt). */
function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (ch === "\r") {
      // ignorer – håndteres av \n
    } else {
      field += ch;
    }
  }
  // siste felt/rad
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** Bygger en lesbar sesong-streng fra start/slutt-årstall. */
function formatSesong(start, slutt) {
  if (!start) return "";
  if (!slutt || slutt === start) return start;
  return `${start}–${slutt}`;
}

const rows = parseCSV(raw).filter((r) => r.some((c) => c.trim() !== ""));
if (rows.length === 0) {
  console.error("Fant ingen rader i CSV-en.");
  process.exit(1);
}

const headers = rows[0].map((h) => h.trim());
const col = (name) => headers.indexOf(name);

const required = ["id", "klubb", "type", "land", "landskode"];
const missing = required.filter((c) => col(c) === -1);
if (missing.length > 0) {
  console.error(`Mangler forventede kolonner: ${missing.join(", ")}`);
  process.exit(1);
}

const idx = {
  id: col("id"),
  klubb: col("klubb"),
  type: col("type"),
  land: col("land"),
  landskode: col("landskode"),
  sesongStart: col("sesong_start"),
  sesongSlutt: col("sesong_slutt"),
  drakttype: col("drakttype"),
  farger: col("farger"),
  produsent: col("produsent"),
  spiller: col("spiller"),
  notat: col("notat"),
  kitArchiveUrl: col("kitarchive_url"),
  bilde: col("bilde"),
};

const get = (row, key) => (idx[key] >= 0 ? (row[idx[key]] ?? "").trim() : "");

const drakter = [];
const seenIds = new Set();
const landTilKoder = new Map(); // land -> Set(landskode)
const kodeTilLand = new Map(); // landskode -> Set(land)

for (let i = 1; i < rows.length; i++) {
  const row = rows[i];
  const id = get(row, "id");
  if (!id) {
    console.warn(`⚠ Rad ${i + 1}: mangler id – hoppes over.`);
    continue;
  }
  if (seenIds.has(id)) {
    console.warn(`⚠ Rad ${i + 1}: duplikat id "${id}" – hoppes over.`);
    continue;
  }
  seenIds.add(id);

  const start = get(row, "sesongStart");
  const slutt = get(row, "sesongSlutt");
  const land = get(row, "land");
  const landskode = get(row, "landskode");

  // Samle for konsistenssjekk
  if (land && landskode) {
    if (!landTilKoder.has(land)) landTilKoder.set(land, new Set());
    landTilKoder.get(land).add(landskode);
    if (!kodeTilLand.has(landskode)) kodeTilLand.set(landskode, new Set());
    kodeTilLand.get(landskode).add(land);
  }

  drakter.push({
    id,
    navn: get(row, "klubb"),
    type: get(row, "type").toLowerCase(),
    land,
    landskode,
    sesongStart: start,
    sesongSlutt: slutt,
    sesong: formatSesong(start, slutt),
    drakttype: get(row, "drakttype").toLowerCase(),
    farger: get(row, "farger")
      .split(";")
      .map((f) => f.trim())
      .filter(Boolean),
    produsent: get(row, "produsent"),
    spiller: get(row, "spiller"),
    notat: get(row, "notat"),
    kitArchiveUrl: (() => {
      const v = get(row, "kitArchiveUrl");
      return v && v !== "-" ? v : "";
    })(),
    bilde: get(row, "bilde"),
  });
}

// --- Konsistenssjekk: land ↔ landskode ---
let advarsler = 0;
for (const [land, koder] of landTilKoder) {
  if (koder.size > 1) {
    advarsler++;
    console.warn(
      `⚠ Konsistens: land "${land}" er koblet til flere landskoder: ${[...koder]
        .map((k) => `"${k}"`)
        .join(", ")}`
    );
  }
}
for (const [kode, land] of kodeTilLand) {
  if (land.size > 1) {
    advarsler++;
    console.warn(
      `⚠ Konsistens: landskode "${kode}" er koblet til flere land: ${[...land]
        .map((l) => `"${l}"`)
        .join(", ")}`
    );
  }
}

const outputPath = resolve(__dirname, "../src/data/drakter.json");
writeFileSync(outputPath, JSON.stringify(drakter, null, 2), "utf-8");
console.log(`✓ ${drakter.length} drakter skrevet til ${outputPath}`);
if (advarsler > 0) {
  console.warn(
    `⚠ ${advarsler} konsistensadvarsel(er) i land/landskode – sjekk arket.`
  );
}
