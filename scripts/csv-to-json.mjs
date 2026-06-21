/**
 * Konverterer CSV-eksporten fra Google Sheets til JSON.
 * Kjør: node scripts/csv-to-json.mjs <sti-til-csv>
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

function parseCSVLine(line) {
  const fields = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      fields.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current.trim());
  return fields;
}

function parseLand(raw) {
  if (!raw) return { landskode: "", land: "" };
  const match = raw.match(/^:([a-z-]+):\s*(.+)$/);
  if (match) {
    return { landskode: match[1], land: match[2] };
  }
  return { landskode: "", land: raw };
}

function parseBildeUrl(raw) {
  if (!raw) return "";
  const match = raw.match(/\!\[.*?\]\((.*?)\)/);
  return match ? match[1] : "";
}

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[æå]/g, "a")
    .replace(/ø/g, "o")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

// Korte klubbkoder for ID-generering
const manualCodes = {
  'Algeciras': 'alc', 'Algerie': 'alg',
  'Athletico Madrid': 'atm', 'Atletico Madrid': 'atm',
  'Barcelona': 'bcn', 'Barnsley': 'brn',
  'Birmingham City': 'bir', 'Biratnagar City': 'bnc',
  'Blackburn': 'bla', 'Blackpool': 'blp',
  'Bristol City': 'brc',
  'Burford': 'bfd', 'Burnley': 'bur',
  'Cardiff': 'cdf', 'Carlisle': 'car',
  'Chelsea': 'che', 'Chesterfield': 'chf', 'Chennaiyin FC': 'chn',
  'Claydon': 'cly', 'Club America': 'cam',
  'Colchester': 'col', 'Colombia': 'cmb',
  'Hajduk Split': 'haj', 'Hamitkoy SHSK': 'ham',
  'Huddersfield': 'hud', 'Huddersfield Town': 'hud',
  'Hucknall Town': 'huc',
  'Lincoln': 'lnc', 'Linfield': 'lin',
  'Liverpool': 'liv', 'LIverpool': 'liv',
  'Livingston': 'lvs', 'Livorno': 'lvo',
  'Manchester United': 'mun', 'Mauritius': 'mau',
  'Nordsjælland': 'nds', 'Norge': 'nor', 'Norwich': 'nrw',
  'Pachuca': 'pac', 'Park Celtic': 'pkc',
  'Portsmouth': 'por', 'Portugal': 'prt',
  'Schonnebeck': 'sch', 'Schreinerei': 'scr',
  'Stoke': 'sto', 'Stotzheim': 'stz',
  'Valencia': 'val', 'Valetta': 'vlt',
  'Mali': 'mal', 'Mallorca': 'mlc',
  'Al-Ittihad': 'ait', 'Alianza': 'alz',
  'Richmond AFC': 'ric',
};

function clubCode(name) {
  if (manualCodes[name]) return manualCodes[name];
  const n = name.toLowerCase()
    .replace(/[æå]/g, 'a').replace(/ø/g, 'o')
    .replace(/^(fc|fk|if|bk|sk|ik) /, '').replace(/ (fc|fk|if|bk|sk|ik)$/, '')
    .trim();
  const words = n.split(/[\s-]+/).filter(w => w.length > 0);
  if (words.length >= 3) return words.slice(0, 3).map(w => w[0]).join('');
  if (words.length === 2) return (words[0].slice(0, 2) + words[1].slice(0, 1));
  return n.slice(0, 3);
}

const lines = raw.split("\n").filter((l) => l.trim());
const headers = parseCSVLine(lines[0]);

const drakter = [];
const slugCount = {};
const idCount = {};

for (let i = 1; i < lines.length; i++) {
  const fields = parseCSVLine(lines[i]);
  const navn = fields[0] || "";
  const aar = fields[1] || "";
  const landRaw = fields[2] || "";
  const typeLag = fields[3] || "";
  const farge = fields[4] || "";
  const informasjon = fields[5] || "";
  const kitArchiveUrl = fields[6] || "";
  const bildeRaw = fields[7] || "";
  const kommentar = fields[10] || "";

  // Kort ID (f.eks. liv-01, ars-02)
  const code = clubCode(navn);
  idCount[code] = (idCount[code] || 0) + 1;
  const id = code + "-" + String(idCount[code]).padStart(2, "0");

  // Lang slug beholdes for bakoverkompatibilitet med eksisterende bilder
  let baseSlug = slugify(navn);
  if (aar) baseSlug += "-" + slugify(aar);
  if (farge) baseSlug += "-" + slugify(farge);
  slugCount[baseSlug] = (slugCount[baseSlug] || 0) + 1;
  const slug =
    slugCount[baseSlug] > 1
      ? `${baseSlug}-${slugCount[baseSlug]}`
      : baseSlug;

  const { landskode, land } = parseLand(landRaw);

  drakter.push({
    id,
    slug,
    navn,
    aar,
    landskode,
    land,
    typeLag,
    farge,
    informasjon,
    kitArchiveUrl: kitArchiveUrl && kitArchiveUrl !== "-" ? kitArchiveUrl : "",
    bildeUrl: parseBildeUrl(bildeRaw),
  });
}

const outputPath = resolve(__dirname, "../src/data/drakter.json");
writeFileSync(outputPath, JSON.stringify(drakter, null, 2), "utf-8");
console.log(`✓ ${drakter.length} drakter skrevet til ${outputPath}`);
