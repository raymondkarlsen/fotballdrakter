# ⚽ Fotballdrakter

En statisk nettside som viser en personlig samling av 425+ fotballdrakter fra hele verden.

## Teknologi

- [Astro](https://astro.build) – statisk sidegenerator
- Vanilla CSS – minimalistisk, responsivt design
- JSON-datakilde generert fra Google Sheets CSV-eksport

## Kom i gang

```bash
npm install
npm run dev
```

## Oppdater data fra spreadsheet

Dataen ligger i Google Sheets-fanen `drakter_v2`. En planlagt GitHub Action
(`.github/workflows/sync-sheets.yml`) henter fanen automatisk hver dag og
committer oppdatert `src/data/drakter.json`.

For å oppdatere manuelt:

1. Last ned fanen `drakter_v2` som CSV (henter samme data som CI):

```bash
curl -L -o drakter.csv \
  "https://docs.google.com/spreadsheets/d/157myvKxHgMVEwgenxe7zmUv5StiP7p83PXMlBTrV8jg/gviz/tq?tqx=out:csv&sheet=drakter_v2"
```

2. Kjør konverteringsskriptet (advarer ved inkonsistent land/landskode):

```bash
node scripts/csv-to-json.mjs drakter.csv
```

3. Bygg på nytt:

```bash
npm run build
```

### Kolonner i `drakter_v2`

| Kolonne | Beskrivelse |
|---------|-------------|
| `id` | Stabil, unik ID (skrives i arket, endres aldri) |
| `klubb` | Lag-/klubbnavn |
| `type` | `klubb`, `landslag` eller `fiksjon` |
| `land` / `landskode` | Landsnavn + ISO-kode (f.eks. `gb-eng`) |
| `sesong_start` / `sesong_slutt` | Årstall (tall). Tom slutt = engangssesong |
| `drakttype` | `hjemme`, `borte`, `tredje`, `keeper` (valgfri) |
| `farger` | Semikolon-separert liste (`blå;rød`) |
| `produsent` | Draktprodusent (valgfri) |
| `spiller` | Spiller/nummer (valgfri) |
| `notat` | Fritekst |
| `kitarchive_url` | Lenke til Football Kit Archive |
| `bilde` | Filnavn i `public/images/drakter/` (tom = ingen) |

## Struktur

```
src/
├── data/drakter.json    # 425 drakter (generert)
├── components/          # Gjenbrukbare komponenter
├── layouts/             # Base layout
├── pages/
│   ├── index.astro      # Listevisning med søk og filtrering
│   └── drakt/[id].astro # Detaljside per drakt
└── types.ts             # TypeScript-typer
scripts/
└── csv-to-json.mjs      # CSV → JSON-konvertering
```
