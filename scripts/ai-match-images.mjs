#!/usr/bin/env node
/**
 * AI-basert matching av bilder til drakter ved hjelp av Claude Vision.
 * 
 * Bruk: node scripts/ai-match-images.mjs [--dry-run] [--batch-size=10]
 * 
 * Krever ANTHROPIC_API_KEY i miljøet.
 */
import { readFileSync, readdirSync, copyFileSync, existsSync, writeFileSync } from 'fs';
import { resolve, basename, extname, join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');
const draktData = JSON.parse(readFileSync(resolve(projectRoot, 'src/data/drakter.json'), 'utf-8'));
const imageSourceDir = resolve(process.env.HOME, 'Documents/Bilder/Fotballdrakter');
const imageDestDir = resolve(projectRoot, 'public/images/drakter');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const batchArg = args.find(a => a.startsWith('--batch-size='));
const batchSize = batchArg ? parseInt(batchArg.split('=')[1]) : 10;

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error('Feil: GEMINI_API_KEY mangler i miljøet');
  console.error('Kjør: export GEMINI_API_KEY="din-nøkkel"');
  console.error('Hent nøkkel fra: https://aistudio.google.com/app/apikey');
  process.exit(1);
}

// Filtrer ut resized-varianter
function getOriginalImages() {
  const files = readdirSync(imageSourceDir);
  return files.filter(f => {
    const ext = extname(f).toLowerCase();
    if (!['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) return false;
    if (f.match(/-\d+x\d+\./)) return false;
    if (f.includes('-scaled') && files.includes(f.replace('-scaled', ''))) return false;
    return true;
  });
}

// Lag kandidatliste (drakter uten bilde)
function getCandidates() {
  const existingImages = existsSync(imageDestDir) ? readdirSync(imageDestDir) : [];
  const draktIdsWithImage = new Set(existingImages.map(f => basename(f, extname(f))));
  
  return draktData
    .filter(d => !draktIdsWithImage.has(d.id))
    .map(d => ({ id: d.id, navn: d.navn, land: d.land || '', farge: d.farge, aar: d.aar || '' }));
}

// Send bilde til Gemini for identifikasjon
async function identifyImage(imagePath, candidates) {
  const imageData = readFileSync(imagePath);
  const base64 = imageData.toString('base64');
  const ext = extname(imagePath).toLowerCase();
  const mimeType = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';

  // Lag en kompakt kandidatliste
  const candidateList = candidates
    .map(c => `${c.id} | ${c.navn} | ${c.land} | ${c.farge} | ${c.aar}`)
    .join('\n');

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [
          {
            inlineData: { mimeType, data: base64 },
          },
          {
            text: `This is a photo of a football/soccer kit (jersey/shirt). Identify the team based on the logo, colors, sponsor, design, and any visible text. Then find the BEST match from this list.

Reply with ONLY the ID (first column) of the best match, or "NONE" if this is not a football kit or no good match exists.

ID | Team | Country | Colors | Year
${candidateList}`,
          },
        ],
      }],
      generationConfig: { maxOutputTokens: 100 },
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`API error ${response.status}: ${err.slice(0, 200)}`);
  }

  const data = await response.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || 'NONE';
}

async function main() {
  const images = getOriginalImages();
  const candidates = getCandidates();
  
  // Filtrer bilder som allerede er matchet
  const existingImages = existsSync(imageDestDir) ? readdirSync(imageDestDir) : [];
  const draktIdsWithImage = new Set(existingImages.map(f => basename(f, extname(f))));
  
  // Filtrer ut generelle bilder som ikke er fotballdrakter
  const skipPatterns = ['fotballdrakt', 'drakter', 'front', 'topp'];
  const imagesToProcess = images.filter(img => {
    const name = basename(img, extname(img)).toLowerCase();
    return !skipPatterns.some(p => name.includes(p) && !name.includes('-'));
  });

  console.log(`\n🤖 AI-matching av fotballdraktbilder`);
  console.log(`   Bilder å prosessere: ${imagesToProcess.length}`);
  console.log(`   Drakter uten bilde: ${candidates.length}`);
  console.log(`   Modell: gemini-2.0-flash (gratis)`);
  console.log(`   Modus: ${dryRun ? 'DRY RUN' : 'LIVE (kopierer filer)'}`);
  console.log(`   Batch-størrelse: ${batchSize}`);
  console.log('');

  const results = [];
  let matched = 0;
  let noMatch = 0;
  let errors = 0;
  const usedIds = new Set();

  for (let i = 0; i < imagesToProcess.length; i++) {
    const img = imagesToProcess[i];
    const imagePath = join(imageSourceDir, img);
    
    // Oppdater kandidatliste (fjern allerede brukte)
    const availableCandidates = candidates.filter(c => !usedIds.has(c.id) && !draktIdsWithImage.has(c.id));

    process.stdout.write(`  [${i + 1}/${imagesToProcess.length}] ${img} ... `);

    try {
      let answer;
      let retries = 3;
      while (retries > 0) {
        try {
          answer = await identifyImage(imagePath, availableCandidates);
          break;
        } catch (err) {
          if (err.message.includes('429') && retries > 1) {
            retries--;
            process.stdout.write('⏳ ');
            await new Promise(r => setTimeout(r, 15000)); // Vent 15s ved rate limit
          } else {
            throw err;
          }
        }
      }
      
      if (answer === 'NONE' || !answer) {
        console.log('❌ Ingen match');
        noMatch++;
        results.push({ image: img, result: 'NONE' });
      } else {
        const matchedDrakt = draktData.find(d => d.id === answer);
        if (matchedDrakt && !usedIds.has(answer) && !draktIdsWithImage.has(answer)) {
          const ext = extname(img).toLowerCase();
          const destName = `${matchedDrakt.id}${ext}`;
          console.log(`✅ → ${destName} ("${matchedDrakt.navn}")`);
          
          if (!dryRun) {
            copyFileSync(imagePath, join(imageDestDir, destName));
          }
          matched++;
          usedIds.add(answer);
          results.push({ image: img, result: answer, navn: matchedDrakt.navn });
        } else {
          console.log(`⚠️  Svar "${answer}" (ikke funnet eller allerede brukt)`);
          noMatch++;
          results.push({ image: img, result: answer, issue: 'not_found_or_used' });
        }
      }
    } catch (err) {
      console.log(`💥 Feil: ${err.message.slice(0, 80)}`);
      errors++;
      results.push({ image: img, result: 'ERROR', error: err.message });
    }

    // Rate limiting: 5 sekunder mellom requests (Gemini free = 15/min)
    if (i < imagesToProcess.length - 1) {
      await new Promise(r => setTimeout(r, 5000));
    }

    // Mellomrapport per batch
    if ((i + 1) % batchSize === 0) {
      console.log(`\n  --- Batch ${Math.floor((i + 1) / batchSize)}: ${matched} matchet, ${noMatch} ingen match, ${errors} feil ---\n`);
    }
  }

  // Sluttrapport
  console.log('\n' + '='.repeat(50));
  console.log(`✅ Matchet: ${matched}`);
  console.log(`❌ Ingen match: ${noMatch}`);
  console.log(`💥 Feil: ${errors}`);
  console.log('='.repeat(50));

  // Lagre resultater til fil
  const reportPath = resolve(projectRoot, 'scripts/match-results.json');
  writeFileSync(reportPath, JSON.stringify(results, null, 2));
  console.log(`\nResultater lagret til: ${reportPath}`);
  
  if (dryRun) {
    console.log('\n(--dry-run: ingen filer ble kopiert)');
  }
}

main().catch(err => {
  console.error('Fatal feil:', err);
  process.exit(1);
});
