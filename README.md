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

1. Eksporter Google Sheets som CSV
2. Kjør konverteringsskriptet:

```bash
node scripts/csv-to-json.mjs <sti-til-csv>
```

3. Bygg på nytt:

```bash
npm run build
```

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
