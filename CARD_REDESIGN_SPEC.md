# BAY MOVES — EVENT CARD REDESIGN SPEC

> **For Cursor / AI code editor**: This document contains everything needed to
> redesign the event cards in Bay Moves. It covers TWO design options.
> Implement whichever one the developer chooses (ask them).
> All changes happen in `build.js` — the site is static HTML generated at build time.

---

## CONTEXT: HOW THE SITE WORKS

Bay Moves is a static site. `build.js` scrapes events, classifies genres via AI,
then generates `index.html` with all event cards baked in. There is no frontend
framework — just a big HTML template literal in `generateHTML()`.

**The event object shape** (available at card-generation time):
```js
{
  date: "2026-03-22",       // always present
  time: "9pm" | "7pm/8pm",  // usually present, sometimes null
  source: "19hz" | "foopee" | "posh.vip" | "partiful",
  title: "SPFDJ + Blawan",  // always present
  venue: "The Midway",      // usually present
  city: "S.F." | "Oakland" | "Berkeley",  // usually present
  details: "$10-$20 all ages | electronic, techno",  // 19hz only, contains price+tags
  bands: [],                 // array, sometimes populated
  link: "https://...",       // sometimes null
  aiGenres: "edm,raves"     // set by classifier, comma-separated
}
```

**Price data**: Currently buried in the `details` string for 19hz events
(e.g. `"$10-$20 all ages | electronic, techno"` or `"free all ages"`).
Not extracted as a separate field yet. Other sources don't have price.

**Genre data**: `getGenres(event)` returns a comma-separated string like `"edm,raves"`.
The PRIMARY genre (for color) is the first one: `getGenres(event).split(',')[0]`.

---

## STEP 1: ADD PRICE EXTRACTION TO BUILD.JS

Add this helper function near the other helpers (near `escapeHtml`, `getGenres`):

```js
// Extract price string from event details (19hz stores price in details field)
// Returns: "FREE", "$10", "$10–$20", or null
function extractPrice(event) {
  const details = (event.details || '').toLowerCase();

  // Check for free
  if (details.includes('free') || details.includes('no cover')) {
    return 'FREE';
  }

  // Match price patterns: $10, $10-$20, $10–$20, $10/$20
  const priceMatch = (event.details || '').match(/\$[\d]+(?:\s*[-–\/]\s*\$?[\d]+)?/);
  if (priceMatch) {
    // Normalize dashes to en-dash for display
    return priceMatch[0].replace(/-/g, '–');
  }

  return null;
}
```

---

## STEP 2: GENRE COLOR SYSTEM (CSS)

Add these CSS custom properties alongside your existing `:root` variables.
The PRIMARY genre of each event determines its accent color.

```css
/* Genre accent colors — used for card borders, badges, hover glows */
/* Applied via data-primary-genre attribute on .event-card */
.event-card[data-primary-genre="edm"]   { --genre-accent: #00f0ff; }
.event-card[data-primary-genre="raves"] { --genre-accent: #e040fb; }
.event-card[data-primary-genre="punk"]  { --genre-accent: #ff2d2d; }
.event-card[data-primary-genre="rock"]  { --genre-accent: #ff8a00; }
.event-card[data-primary-genre="misc"]  { --genre-accent: #ccff00; }

/* Fallback if no genre */
.event-card { --genre-accent: #ccff00; }
```

---

## STEP 3: UPDATE CARD HTML GENERATION IN build.js

In the `generateHTML()` function, find the loop where cards are built.
Currently it looks like:

```js
eventsByDate[date].forEach(event => {
  const genres = getGenres(event);
  const venueDisplay = event.city ? `${event.venue}, ${event.city}` : event.venue;
  const cardContent = `<div class="event-header">...`;
  // etc
});
```

**Replace the card generation** with this (keeping the same loop structure):

```js
eventsByDate[date].forEach(event => {
  const genres = getGenres(event);
  const primaryGenre = genres.split(',')[0].trim().toLowerCase() || 'misc';
  const venueDisplay = event.city ? `${event.venue}, ${event.city}` : event.venue;
  const price = extractPrice(event);
  const isFree = price === 'FREE';

  const cardContent =
    // Genre color band — top edge
    `<div class="card-genre-bar"></div>\n` +

    // Price badge — top right corner, skip if no price
    (price
      ? `<div class="card-price${isFree ? ' card-price--free' : ''}">${escapeHtml(price)}</div>\n`
      : '') +

    // Card body
    `<div class="card-body">\n` +
      // Date line: "SAT 22 · 9PM"
      `  <div class="card-dateline">\n` +
      `    <span class="card-day-date">${dayAbbr} ${dayNum}</span>\n` +
      (event.time
        ? `    <span class="card-time">${escapeHtml(event.time)}</span>\n`
        : '') +
      `  </div>\n` +

      // Title — the main hook
      `  <h3 class="card-title">${escapeHtml(event.title)}</h3>\n` +

      // Venue row with genre dot
      `  <div class="card-venue-row">\n` +
      `    <span class="card-genre-dot"></span>\n` +
      (event.venue
        ? `    <span class="card-venue">${escapeHtml(venueDisplay)}</span>\n`
        : '') +
      `  </div>\n` +
    `</div>\n` +

    // Bottom accent line (animates on hover)
    `<div class="card-hover-line"></div>\n`;

  const openWrap = event.link
    ? `<a href="${escapeHtml(event.link)}" target="_blank" rel="noopener noreferrer" class="event-card-link">\n`
    : '';
  const closeWrap = event.link ? `</a>\n` : '';

  cardsHtml += openWrap +
    `<div class="event-card" data-genres="${escapeHtml(genres)}" data-primary-genre="${primaryGenre}" data-event-date="${date}">\n` +
    cardContent +
    `</div>\n` +
    closeWrap + '\n';
});
```

---

## STEP 4: REPLACE CARD CSS

Remove ALL existing `.event-card`, `.event-header`, `.event-body`, `.event-date`,
`.event-day`, `.event-time`, `.event-title`, `.event-venue`, `.event-genre`,
`.event-source` CSS rules.

Replace with this complete card stylesheet:

```css
/* ═══════════════════════════════════════════════
   EVENT CARDS — "The Flyer" design
   ═══════════════════════════════════════════════ */

.event-card-link {
    text-decoration: none;
    color: inherit;
    display: block;
}

.event-card {
    position: relative;
    background: #08080a;
    overflow: hidden;
    box-shadow: 0 0 0 1px #1a1a1a;
    transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1),
                box-shadow 0.3s ease;
    cursor: pointer;
    /* Remove old animation stuff if you want, or keep fadeInUp */
    animation: fadeInUp 0.5s cubic-bezier(0.16, 1, 0.3, 1) backwards;
}
.event-card:nth-child(1) { animation-delay: 0.05s; }
.event-card:nth-child(2) { animation-delay: 0.08s; }
.event-card:nth-child(3) { animation-delay: 0.11s; }
.event-card:nth-child(4) { animation-delay: 0.14s; }
.event-card:nth-child(5) { animation-delay: 0.17s; }
.event-card:nth-child(n+6) { animation-delay: 0.2s; }

@keyframes fadeInUp {
    from { opacity: 0; transform: translateY(20px); }
    to   { opacity: 1; transform: translateY(0); }
}

.event-card:hover {
    transform: translateY(-4px) scale(1.01);
    box-shadow: 0 12px 40px color-mix(in srgb, var(--genre-accent) 12%, transparent),
                0 0 0 1px color-mix(in srgb, var(--genre-accent) 40%, transparent);
}

/* --- Genre color band (top edge) --- */
.card-genre-bar {
    height: 4px;
    background: linear-gradient(90deg, var(--genre-accent), color-mix(in srgb, var(--genre-accent) 50%, transparent), transparent);
}

/* --- Price badge (top-right corner) --- */
.card-price {
    position: absolute;
    top: 16px;
    right: 0;
    padding: 3px 12px 3px 16px;
    background: #111;
    color: #777;
    font-family: 'Bebas Neue', 'Impact', sans-serif;
    font-size: 0.85rem;
    letter-spacing: 0.06em;
    clip-path: polygon(14px 0, 100% 0, 100% 100%, 0 100%);
}

.card-price--free {
    background: var(--genre-accent);
    color: #000;
    font-size: 1rem;
    letter-spacing: 0.12em;
    padding: 4px 14px 4px 18px;
    font-weight: 700;
}

/* --- Card body --- */
.card-body {
    padding: 18px 18px 14px;
}

/* --- Date line: "SAT 22 · 9PM" --- */
.card-dateline {
    display: flex;
    align-items: baseline;
    gap: 8px;
    margin-bottom: 8px;
}

.card-day-date {
    font-family: 'Bebas Neue', 'Impact', sans-serif;
    font-size: 1.1rem;
    color: var(--genre-accent);
    letter-spacing: 0.1em;
}

.card-time {
    font-size: 0.72rem;
    color: #444;
    font-family: 'DM Mono', 'Azeret Mono', 'Courier New', monospace;
    letter-spacing: 0.05em;
}

/* --- Title — the hook --- */
.card-title {
    margin: 0 0 12px 0;
    font-family: 'Bebas Neue', 'Impact', sans-serif;
    font-size: 1.5rem;
    line-height: 1.05;
    color: #fff;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    padding-right: 60px; /* room for price badge */
    transition: color 0.2s;
}

.event-card:hover .card-title {
    color: var(--genre-accent);
}

/* --- Venue row --- */
.card-venue-row {
    display: flex;
    align-items: center;
    gap: 8px;
}

.card-genre-dot {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: var(--genre-accent);
    opacity: 0.6;
    flex-shrink: 0;
}

.card-venue {
    font-size: 0.78rem;
    color: #555;
    letter-spacing: 0.02em;
}

/* --- Bottom hover line --- */
.card-hover-line {
    height: 2px;
    background: var(--genre-accent);
    transform: scaleX(0);
    transform-origin: left;
    transition: transform 0.4s cubic-bezier(0.16, 1, 0.3, 1);
}

.event-card:hover .card-hover-line {
    transform: scaleX(1);
}

/* ═══════════════════════════════════════════════
   GRID — keep existing .events-grid but update minmax
   ═══════════════════════════════════════════════ */
.events-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
    gap: 14px;
    margin-bottom: 60px;
}

/* Mobile: single column */
@media (max-width: 640px) {
    .events-grid {
        grid-template-columns: 1fr;
        gap: 10px;
    }

    .card-title {
        font-size: 1.3rem;
    }

    .card-body {
        padding: 14px 14px 12px;
    }
}
```

---

## STEP 5: UPDATE THE HOVER JS

In the existing `<script>` section, find the `mouseenter`/`mouseleave` listeners
on event cards. **Remove them** — the hover is now handled entirely by CSS
(the `.event-card:hover` rules above). The JS hover was:

```js
// REMOVE THIS:
eventCards.forEach(card => {
    card.addEventListener('mouseenter', () => {
        card.style.transform = 'translateY(-4px) scale(1.01)';
    });
    card.addEventListener('mouseleave', () => {
        card.style.transform = 'translateY(0) scale(1)';
    });
});
```

Delete those lines. CSS handles it now with better transitions.

---

## STEP 6: VERIFY NOTHING ELSE BREAKS

Things that must still work after the change:
- `data-genres` attribute → used by genre filter chips (`.genre-chip` click handler)
- `data-event-date` attribute → used by time filter (`matchesTime()`)
- `.event-card-link` wrapping → used by filter show/hide logic (`card.closest('.event-card-link')`)
- `.event-card` class → used by `document.querySelectorAll('.event-card')` for filtering
- `fadeInUp` animation → kept in the new CSS

All of these are preserved in the new card HTML structure above.

---

## QUICK REFERENCE: DATA FIELD → DISPLAY MAPPING

| Display element    | Data source                          | Example output       |
|--------------------|--------------------------------------|----------------------|
| Day abbreviation   | `dateObj.toLocaleDateString(weekday)`| `SAT`                |
| Day number         | `dateObj.getDate()`                  | `22`                 |
| Time               | `event.time`                         | `9PM` or `7pm/8pm`   |
| Title              | `event.title`                        | `SPFDJ + Blawan`     |
| Venue + City       | `event.venue` + `event.city`         | `The Midway, S.F.`   |
| Price              | `extractPrice(event)`                | `FREE` / `$10–$20`   |
| Genre accent color | `primaryGenre` from `getGenres()`    | CSS var per genre     |
| Genre dot color    | Same as accent                       | Colored circle        |

---

## WHAT NOT TO TOUCH

- The filter system (time filters, genre chips) — works as-is
- The scraper functions (parse19hz, parseFoopee, etc.)
- The genre classification system (classify-events.js)
- The `getGenres()` function
- The `escapeHtml()` function
- The header, footer, subscribe section, or any non-card HTML

---

## NOTES FOR THE IMPLEMENTER

1. **`color-mix()` browser support**: Works in all modern browsers (Chrome 111+,
   Safari 16.2+, Firefox 113+). If you need older browser support, replace
   `color-mix(in srgb, var(--genre-accent) 12%, transparent)` with a fallback
   like `rgba(204, 255, 0, 0.1)` per genre.

2. **Price will be null for most events** — only 19hz currently provides price
   data in the `details` field. That's fine. Cards without price just don't show
   the badge. The design still works without it.

3. **No images, no external JS, no runtime API calls** — everything is CSS + static
   HTML. Zero performance impact for your 100 concurrent users.

4. **The `clip-path` on the price badge** creates an angled left edge (like a
   sticker). If it looks weird, you can remove it and just use a normal rectangle.
