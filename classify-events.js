// classify-events.js
const fetch = require('node-fetch');
const fs = require('fs');
const crypto = require('crypto');

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const CACHE_FILE = '.genre-cache.json';
const BATCH_SIZE = 50;

const SYSTEM_PROMPT = `You are a music event genre classifier for a Bay Area events website.

Classify each event into one or more of these genres based on the event title, venue, details/description, tags, and source hint:

- "edm" — Clubbing: club nights, electronic dance at clubs (house, techno, trance, dubstep, drum & bass, etc.). DNA Lounge, Public Works, Monarch, The Midway, 1015 Folsom are clubs → use "edm" for their dance nights.
- "raves" — ONLY for rave-formatted events: warehouse parties, multi-DJ lineups, late-night/afterhours, events with "rave" in the name, underground dance events, TBA warehouse. A regular club night with one headliner = "edm" (clubbing) only, NOT "raves".
- "punk" — Punk, hardcore, post-punk, emo, screamo, ska-punk. Use only when the event is clearly in this vein.
- "rock" — Rock, indie rock, alt-rock, metal, garage rock, shoegaze, grunge, classic rock. Use only when the event is clearly in this vein.
- "misc" — Anything that doesn't clearly fit above: jazz, hip-hop, R&B, pop, folk, country, comedy, spoken word, classical, experimental/noise, multi-genre festivals where genre is unclear

PREFER A SINGLE GENRE: Only assign multiple genres when the event clearly fits both (e.g. "techno warehouse rave" = edm,raves; "punk and rock showcase" = punk,rock). When in doubt, pick the single best fit—do not add both "edm" and "raves" or both "rock" and "punk" unless the event explicitly warrants both.

CLUBBING vs RAVES: Use "raves" ONLY when at least one applies: warehouse/underground/afterhours/TBA venue, "rave" in the title, or explicitly multi-DJ/lineup. Club nights (including DNA Lounge, etc.) = "edm" (clubbing) only.
ROCK vs PUNK: Use "punk" for punk, hardcore, post-punk, emo, screamo, ska-punk. Use "rock" for indie rock, metal, shoegaze, grunge, classic rock. Use BOTH only when the event clearly spans both (e.g. "punk and rock night"); otherwise pick the single best fit.

If unsure, lean toward "misc" rather than guessing wrong. Venue context: DNA Lounge (club), Public Works, Monarch, The Midway, 1015 Folsom → clubbing, use "edm". Gilman, Bottom of the Hill, Chapel, Fillmore → often punk/rock. Use details and source as hints.

EXAMPLES:
- "Techno Tuesday" @ DNA Lounge (club) → "edm"
- "Warehouse Rave" @ TBA → "edm,raves"
- "Indie Night" @ Bottom of the Hill → "rock"
- "Hardcore Show" @ Gilman → "punk"
- "Punk & Rock Showcase" @ Chapel → "punk,rock"

Respond with ONLY a JSON array of objects: [{"id": 0, "genres": "edm"}, ...]
No markdown, no explanation. Just the JSON array.`;

// Hash an event for cache keying (includes all fields used in classification so cache invalidates when input changes)
function eventHash(event) {
  const details = (event.details || '').slice(0, 300);
  const desc = (event.description || '').slice(0, 300);
  const str = `${event.title}|${event.venue || ''}|${event.tags || ''}|${details}|${desc}|${event.source || ''}`;
  return crypto.createHash('md5').update(str).digest('hex').slice(0, 12);
}

// Cache key includes prompt hash so changing the classifier prompt invalidates old entries
const PROMPT_HASH = crypto.createHash('md5').update(SYSTEM_PROMPT).digest('hex').slice(0, 8);
function cacheKey(event) {
  return PROMPT_HASH + ':' + eventHash(event);
}

// Load cache from disk
function loadCache() {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
    }
  } catch (e) {
    console.log('Genre cache corrupted, starting fresh');
  }
  return {};
}

// Save cache to disk
function saveCache(cache) {
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
}

// Classify a batch of events via Haiku
async function classifyBatch(events) {
  const prompt = events.map((e, i) => {
    let line = `${i}. "${e.title}"`;
    if (e.venue) line += ` @ ${e.venue}`;
    if (e.tags) line += ` [${e.tags}]`;
    const extra = [e.details, e.description].filter(Boolean).join(' ').slice(0, 300);
    if (extra) line += ` | ${extra}`;
    if (e.source) line += ` (Source: ${e.source})`;
    return line;
  }).join('\n');

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2000,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Anthropic API error: ${response.status} - ${err}`);
  }

  const data = await response.json();
  const text = data.content[0].text.trim();

  // Parse JSON response, stripping markdown fences if present
  const clean = text.replace(/```json\n?|```\n?/g, '').trim();
  return JSON.parse(clean);
}

// Main classification function
async function classifyAllEvents(events) {
  if (!ANTHROPIC_API_KEY) {
    console.log('⚠️  No ANTHROPIC_API_KEY set — falling back to source-based genres');
    return events; // Return unmodified, getGenres() fallback still works
  }

  const cache = loadCache();
  const uncached = [];
  const uncachedIndices = [];

  // Check cache for each event (key includes prompt hash so prompt changes invalidate cache)
  events.forEach((event, i) => {
    const key = cacheKey(event);
    if (cache[key]) {
      event.aiGenres = cache[key];
    } else {
      uncached.push(event);
      uncachedIndices.push(i);
    }
  });

  console.log(`Genre cache: ${events.length - uncached.length} cached, ${uncached.length} need classification`);

  // Batch-classify uncached events
  for (let i = 0; i < uncached.length; i += BATCH_SIZE) {
    const batch = uncached.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(uncached.length / BATCH_SIZE);

    console.log(`  Classifying batch ${batchNum}/${totalBatches} (${batch.length} events)...`);

    try {
      const results = await classifyBatch(batch);
      results.forEach(result => {
        const event = batch[result.id];
        if (event) {
          event.aiGenres = result.genres;
          cache[cacheKey(event)] = result.genres;
        }
      });
    } catch (err) {
      console.error(`  ⚠️  Batch ${batchNum} failed: ${err.message}`);
      // Fallback: leave aiGenres unset, getGenres() handles it
    }

    // Small delay between batches to be polite
    if (i + BATCH_SIZE < uncached.length) {
      await new Promise(r => setTimeout(r, 500));
    }
  }

  saveCache(cache);
  console.log(`Genre classification complete. Cache now has ${Object.keys(cache).length} entries.`);

  return events;
}

module.exports = { classifyAllEvents };
