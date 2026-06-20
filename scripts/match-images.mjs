#!/usr/bin/env node
/**
 * Semi-automatisk matching av bilder til drakter.
 * 
 * Steg 1: Filnavn-matching (fuzzy) mot drakter.json
 * Steg 2: AI Vision-matching for de som ikke matcher
 * 
 * Bruk: 
 *   node scripts/match-images.mjs [--dry-run] [--ai]
 * 
 * Krever ANTHROPIC_API_KEY i miljøet for --ai-modus.
 */
import { readFileSync, readdirSync, copyFileSync, existsSync, mkdirSync } from 'fs';
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
const useAI = args.includes('--ai');

// Filtrer ut resized-varianter (beholder kun originalen)
function getOriginalImages() {
  const files = readdirSync(imageSourceDir);
  return files.filter(f => {
    const ext = extname(f).toLowerCase();
    if (!['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) return false;
    // Filtrer ut thumbnails (150x150, 400x471, etc.)
    if (f.match(/-\d+x\d+\./)) return false;
    // Filtrer ut -scaled varianter hvis original finnes
    if (f.includes('-scaled') && files.includes(f.replace('-scaled', ''))) return false;
    return true;
  });
}

// Normaliser streng for fuzzy matching
function normalize(str) {
  return str
    .toLowerCase()
    .replace(/[-_\s]+/g, ' ')
    .replace(/[^\wæøåü ]/g, '')
    .trim();
}

// Beregn likhet mellom filnavn og drakt-entry
function similarity(filename, draktName) {
  const fnTokens = normalize(filename).split(' ').filter(t => t.length >= 3);
  const draktTokens = normalize(draktName).split(' ').filter(t => t.length >= 3);
  
  if (fnTokens.length === 0 || draktTokens.length === 0) return 0;
  
  let matchCount = 0;
  for (const ft of fnTokens) {
    for (const dt of draktTokens) {
      // Krever eksakt match eller at den ene inneholder den andre med min 4 tegn
      if (ft === dt || (ft.length >= 4 && dt.includes(ft)) || (dt.length >= 4 && ft.includes(dt))) {
        matchCount++;
        break;
      }
    }
  }
  
  // Score basert på hvor mange av filnavnets tokens som matcher
  return matchCount / fnTokens.length;
}

// Finn beste match for et filnavn
function findBestMatch(filename) {
  const name = basename(filename, extname(filename));
  let bestScore = 0;
  let bestMatch = null;

  for (const drakt of draktData) {
    // Match mot navn-feltet
    const score1 = similarity(name, drakt.navn);
    // Match mot ID
    const score2 = similarity(name, drakt.id);
    const score = Math.max(score1, score2);
    
    if (score > bestScore) {
      bestScore = score;
      bestMatch = drakt;
    }
  }

  return { drakt: bestMatch, score: bestScore };
}

// Hoved-logikk
async function main() {
  const images = getOriginalImages();
  console.log(`\nFant ${images.length} unike bilder i ${imageSourceDir}\n`);

  // Sjekk hvilke drakter allerede har lokalt bilde
  const existingImages = existsSync(imageDestDir) ? readdirSync(imageDestDir) : [];
  const draktIdsWithImage = new Set(existingImages.map(f => basename(f, extname(f))));

  const matched = [];
  const unmatched = [];
  const alreadyHasImage = [];
  const usedDraktIds = new Set();

  for (const img of images) {
    const { drakt, score } = findBestMatch(img);
    
    if (!drakt) {
      unmatched.push({ image: img, reason: 'Ingen match funnet' });
      continue;
    }

    if (draktIdsWithImage.has(drakt.id) || usedDraktIds.has(drakt.id)) {
      alreadyHasImage.push({ image: img, drakt, score });
      continue;
    }

    if (score >= 0.5) {
      matched.push({ image: img, drakt, score });
      usedDraktIds.add(drakt.id);
    } else {
      unmatched.push({ image: img, bestGuess: drakt, score, reason: 'For lav score' });
    }
  }

  // Rapport
  console.log(`✓ Matchet: ${matched.length}`);
  console.log(`? Usikre (trenger AI/manuell): ${unmatched.length}`);
  console.log(`⊘ Allerede har bilde: ${alreadyHasImage.length}`);
  console.log('');

  // Vis matchede
  if (matched.length > 0) {
    console.log('--- MATCHER (score ≥ 0.5) ---');
    for (const m of matched.sort((a, b) => b.score - a.score)) {
      const ext = extname(m.image).toLowerCase();
      const destName = `${m.drakt.id}${ext}`;
      console.log(`  ${m.image} → ${destName} (${(m.score * 100).toFixed(0)}% match: "${m.drakt.navn}")`);
      
      if (!dryRun) {
        const src = join(imageSourceDir, m.image);
        const dest = join(imageDestDir, destName);
        copyFileSync(src, dest);
      }
    }
    console.log('');
  }

  // Vis umatchede
  if (unmatched.length > 0) {
    console.log('--- IKKE MATCHET ---');
    for (const u of unmatched.slice(0, 20)) {
      if (u.bestGuess) {
        console.log(`  ${u.image} → Beste gjetning: "${u.bestGuess.navn}" (${(u.score * 100).toFixed(0)}%)`);
      } else {
        console.log(`  ${u.image} → ${u.reason}`);
      }
    }
    if (unmatched.length > 20) {
      console.log(`  ... og ${unmatched.length - 20} til`);
    }
    console.log('');
  }

  if (dryRun) {
    console.log('(--dry-run modus: ingen filer ble kopiert)');
  } else if (matched.length > 0) {
    console.log(`✓ ${matched.length} bilder kopiert til ${imageDestDir}`);
  }

  // Lagre umatchede til fil for AI-matching
  if (unmatched.length > 0 && useAI) {
    console.log('\n🤖 Starter AI-matching av usikre bilder...\n');
    await aiMatch(unmatched.filter(u => u.bestGuess));
  } else if (unmatched.length > 0) {
    console.log('Tips: Kjør med --ai for å bruke Claude Vision på umatchede bilder');
  }
}

async function aiMatch(items) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('Feil: ANTHROPIC_API_KEY mangler i miljøet');
    console.error('Kjør: export ANTHROPIC_API_KEY="sk-ant-..."');
    process.exit(1);
  }

  // Lag en kort liste over drakt-kandidater uten bilde
  const existingImages = existsSync(imageDestDir) ? readdirSync(imageDestDir) : [];
  const draktIdsWithImage = new Set(existingImages.map(f => basename(f, extname(f))));
  const candidates = draktData
    .filter(d => !draktIdsWithImage.has(d.id))
    .map(d => `${d.id} | ${d.navn} | ${d.land || ''} | ${d.farge}`);

  let aiMatched = 0;
  
  for (const item of items.slice(0, 50)) { // Maks 50 for å begrense kostnad
    const imagePath = join(imageSourceDir, item.image);
    const imageData = readFileSync(imagePath);
    const base64 = imageData.toString('base64');
    const ext = extname(item.image).toLowerCase();
    const mediaType = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';

    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 200,
          messages: [{
            role: 'user',
            content: [
              {
                type: 'image',
                source: { type: 'base64', media_type: mediaType, data: base64 },
              },
              {
                type: 'text',
                text: `This is a photo of a football/soccer kit (jersey). Based on the team logo, colors, sponsor, and any other visible details, which of these kits does it best match? Reply ONLY with the ID from the list, or "NONE" if no good match.

Candidates:
${candidates.slice(0, 100).join('\n')}`,
              },
            ],
          }],
        }),
      });

      const data = await response.json();
      const answer = data.content?.[0]?.text?.trim();

      if (answer && answer !== 'NONE') {
        const matchedDrakt = draktData.find(d => d.id === answer);
        if (matchedDrakt) {
          const destName = `${matchedDrakt.id}${ext}`;
          console.log(`  🤖 ${item.image} → ${destName} ("${matchedDrakt.navn}")`);
          if (!dryRun) {
            copyFileSync(imagePath, join(imageDestDir, destName));
          }
          aiMatched++;
          draktIdsWithImage.add(matchedDrakt.id);
        } else {
          console.log(`  ❓ ${item.image} → AI sa "${answer}" (ikke funnet i data)`);
        }
      } else {
        console.log(`  ✗ ${item.image} → Ingen AI-match`);
      }

      // Rate limiting
      await new Promise(r => setTimeout(r, 1000));
    } catch (err) {
      console.error(`  Feil for ${item.image}: ${err.message}`);
    }
  }

  console.log(`\n✓ AI matchet ${aiMatched} ekstra bilder`);
}

main().catch(console.error);
