// classify-events.js
const fetch = require('node-fetch');
const fs = require('fs');
const crypto = require('crypto');

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const CACHE_FILE = '.genre-cache.json';
const BATCH_SIZE = 50;

const SYSTEM_PROMPT = `You are a music event genre classifier for a Bay Area events website.

Classify each event into one or more of these genres based on the event title, venue, and any tags provided:

- "edm" — Electronic dance music: house, techno, trance, dubstep, drum & bass, ambient electronic, synthwave, etc.
- "raves" — Specifically rave-formatted events: warehouse parties, multi-DJ lineups, late-night/afterhours, events with "rave" in the name, underground dance events
- "punk" — Punk, hardcore, post-punk, emo, screamo, ska-punk
- "rock" — Rock, indie rock, alt-rock, metal, garage rock, shoegaze, grunge, classic rock
- "misc" — Anything that doesn't clearly fit above: jazz, hip-hop, R&B, pop, folk, country, comedy, spoken word, classical, experimental/noise, multi-genre festivals where genre is unclear

RULES:
- An event CAN have multiple genres (e.g. a techno rave = "edm,raves")
- If an event is clearly electronic music but NOT a rave format, just use "edm"
- If unsure, lean toward "misc" rather than guessing wrong
- Venue context matters: DNA Lounge, Public Works, Monarch, The Midway, 1015 Folsom → likely edm/raves. Gilman, Bottom of the Hill, Chapel, Fillmore → likely punk/rock.
- Look for DJ names, genre keywords, and event formatting cues

Respond with ONLY a JSON array of objects: [{"id": 0, "genres": "edm,raves"}, ...]
No markdown, no explanation. Just the JSON array.`;

// Hash an event for cache keying
function eventHash(event) {
  const str = `${event.title}|${event.venue || ''}|${event.tags || ''}`;
  return crypto.createHash('md5').update(str).digest('hex').slice(0, 12);
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

  // Check cache for each event
  events.forEach((event, i) => {
    const hash = eventHash(event);
    if (cache[hash]) {
      event.aiGenres = cache[hash];
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
          cache[eventHash(event)] = result.genres;
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
