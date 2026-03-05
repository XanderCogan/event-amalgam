# OG-IMAGE-SPEC.md
# iMessage Share Preview System for Bay Moves
#
# SCOPE: This ONLY affects what people see when a Bay Moves link is shared
# on iMessage, Twitter, Discord, Slack, etc. It does NOT change any visible
# part of the website. The existing event cards, styles, layout, and
# functionality remain 100% untouched.
#
# WHAT GETS ADDED:
# 1. OG meta tags in index.html head (invisible to users)
# 2. /e/{slug}.html pages — tiny redirect files with OG meta tags
# 3. /og-images/{slug}.png — static images generated at build time
# 4. A share button on each event card (one small visible addition)
# 5. og-template.html — HTML template that Puppeteer screenshots
#
# WHAT DOES NOT CHANGE:
# - Event card design (The Flyer / The Board)
# - CSS styles, colors, layout, filters, animations
# - Any existing JavaScript functionality
# - The look of the site in a browser

# ──────────────────────────────────────────────
# ARCHITECTURE
# ──────────────────────────────────────────────

# BUILD TIME (daily cron, inside build.js):
#   1. Scrape events (already done)
#   2. Generate index.html (already done)
#   3. NEW: Generate /e/{slug}.html per event (redirect + OG meta)
#   4. NEW: Generate /og-images/{slug}.png per event (Puppeteer screenshot)
#   5. NEW: Share button added to event card HTML
#
# RUNTIME (zero cost, zero changes):
#   User taps Share → copies baymoves.com/e/{slug}
#   Pastes in iMessage → Apple bot fetches /e/{slug}.html
#   Reads OG meta tags → shows preview image + title + description
#   Recipient taps → redirects to original event link or main site

# ──────────────────────────────────────────────
# STEP 1: SLUG GENERATION
# ──────────────────────────────────────────────

```javascript
function generateSlug(event) {
  const name = event.title.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 50);
  return `${name}-${event.date}`;
}
```

# ──────────────────────────────────────────────
# STEP 2: SITEWIDE OG TAGS
# ──────────────────────────────────────────────

# In generateHTML(), add these AFTER the viewport meta tag:

```html
<meta property="og:type" content="website">
<meta property="og:url" content="https://baymoves.com">
<meta property="og:title" content="BAY MOVES">
<meta property="og:description" content="Every rave, show & party in the Bay Area. Tonight.">
<meta property="og:image" content="https://baymoves.com/og-image.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:site_name" content="Bay Moves">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="BAY MOVES">
<meta name="twitter:description" content="Every rave, show & party in the Bay Area. Tonight.">
<meta name="twitter:image" content="https://baymoves.com/og-image.png">
```

# ──────────────────────────────────────────────
# STEP 3: PER-EVENT PAGES (/e/{slug}.html)
# ──────────────────────────────────────────────

```javascript
function generateEventPages(allEvents) {
  const dir = 'e';
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  allEvents.forEach(event => {
    const slug = generateSlug(event);
    const title = escapeHtml(event.title);
    const venue = escapeHtml(event.venue || '');
    const city = escapeHtml(event.city || '');
    const time = escapeHtml(event.time || '');
    const price = escapeHtml(event.price || event.details || '');
    const desc = [venue, city, time, price].filter(Boolean).join(' · ');
    const canonicalUrl = `https://baymoves.com/e/${slug}`;
    const ogImage = `https://baymoves.com/og-images/${slug}.png`;
    const redirect = event.link || `/?event=${slug}`;

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} — Bay Moves</title>
  <meta property="og:type" content="website">
  <meta property="og:url" content="${canonicalUrl}">
  <meta property="og:title" content="${title}">
  <meta property="og:description" content="${desc}">
  <meta property="og:image" content="${ogImage}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:site_name" content="Bay Moves">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${title}">
  <meta name="twitter:description" content="${desc}">
  <meta name="twitter:image" content="${ogImage}">
  <script>window.location.href = "${redirect}";</script>
</head>
<body></body>
</html>`;

    fs.writeFileSync(`${dir}/${slug}.html`, html, 'utf8');
  });

  console.log(`Generated ${allEvents.length} event pages in /e/`);
}
```

# ──────────────────────────────────────────────
# STEP 4: OG IMAGE TEMPLATE (og-template.html)
# ──────────────────────────────────────────────

# This HTML file is NEVER served to users. It exists only for Puppeteer
# to screenshot at 1200x630 during build.

# Create this file as og-template.html in the project root:

```html
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&display=swap');
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: 1200px;
    height: 630px;
    overflow: hidden;
    background: #08080a;
    font-family: 'Bebas Neue', 'Impact', 'Arial Black', sans-serif;
  }
</style>
</head>
<body>
<div style="width:1200px; height:630px; position:relative; overflow:hidden;">

  <!-- LAYER 0: Atmospheric genre gradient wash -->
  <div style="position:absolute; inset:0; background:
    radial-gradient(ellipse 80% 120% at 95% 60%, {{GENRE_C}}18 0%, transparent 60%),
    radial-gradient(ellipse 60% 80% at 10% 90%, {{GENRE_C}}0c 0%, transparent 50%),
    linear-gradient(160deg, {{GENRE_DIM}}44 0%, transparent 40%);
  "></div>

  <!-- LAYER 1: GIANT DATE WATERMARK — 496px, top:140, right:60, opacity 0.35 -->
  <div style="position:absolute; right:60px; top:140px; font-size:496px; font-weight:900; line-height:0.75; color:{{GENRE_C}}; opacity:0.35; letter-spacing:-0.04em; pointer-events:none;">{{DAY_NUM}}</div>

  <!-- LAYER 2: Day abbreviation rotated 90deg — 64px, right:80, opacity 0.5 -->
  <div style="position:absolute; right:80px; top:50%; transform:translateY(-50%) rotate(90deg); transform-origin:center center; font-size:64px; letter-spacing:0.3em; color:{{GENRE_C}}; opacity:0.5; pointer-events:none;">{{DAY_ABBR}}</div>

  <!-- TOP GENRE BAND — 5px gradient -->
  <div style="position:absolute; top:0; left:0; right:0; height:5px; background:linear-gradient(90deg, {{GENRE_C}}, {{GENRE_C}}66, transparent 70%);"></div>

  <!-- BOTTOM ACCENT LINE — 3px gradient -->
  <div style="position:absolute; bottom:0; left:0; right:0; height:3px; background:linear-gradient(90deg, {{GENRE_C}}88, {{GENRE_C}}22);"></div>

  <!-- PRICE TAG — angled clipPath, top right -->
  <div style="position:absolute; top:24px; right:0; padding:{{PRICE_PADDING}}; background:{{PRICE_BG}}; color:{{PRICE_COLOR}}; font-size:{{PRICE_SIZE}}px; font-weight:700; letter-spacing:{{PRICE_SPACING}}; clip-path:polygon(18px 0, 100% 0, 100% 100%, 0 100%); z-index:5; {{PRICE_BORDER}}">{{PRICE}}</div>

  <!-- SCANLINES -->
  <div style="position:absolute; inset:0; background:repeating-linear-gradient(0deg, transparent, transparent 14px, rgba(255,255,255,0.012) 14px, rgba(255,255,255,0.012) 15px); pointer-events:none; z-index:4;"></div>

  <!-- MAIN CONTENT -->
  <div style="position:relative; z-index:3; padding:44px 48px 36px; height:100%; display:flex; flex-direction:column; justify-content:space-between;">

    <!-- TOP: Readable date + time -->
    <div style="display:flex; align-items:baseline; gap:14px;">
      <span style="font-size:52px; color:{{GENRE_C}}; letter-spacing:0.06em; line-height:1; text-shadow:0 0 40px {{GENRE_C}}33;">{{DAY_ABBR}} {{DAY_NUM}}</span>
      <span style="font-size:20px; color:#333; font-family:monospace; letter-spacing:0.08em;">{{TIME}}</span>
    </div>

    <!-- CENTER: TITLE + GENRE TAG -->
    <div>
      <div style="font-size:{{TITLE_SIZE}}px; line-height:0.95; color:#fff; letter-spacing:0.03em; text-transform:uppercase; max-width:75%; text-shadow:0 2px 20px rgba(0,0,0,0.5);">{{TITLE}}</div>
      <!-- GENRE TAG — 70% of title size, genre-colored, bordered -->
      <div style="margin-top:10px; display:inline-block; font-size:{{GENRE_TAG_SIZE}}px; color:{{GENRE_C}}; letter-spacing:0.15em; padding:4px 14px; border:2px solid {{GENRE_C}}55; background:{{GENRE_C}}10;">{{GENRE_LABEL}}</div>
    </div>

    <!-- BOTTOM: Venue + brand -->
    <div style="display:flex; justify-content:space-between; align-items:flex-end;">
      <div style="display:flex; align-items:center; gap:10px;">
        <div style="width:7px; height:7px; border-radius:50%; background:{{GENRE_C}}; opacity:0.6; box-shadow:0 0 10px {{GENRE_C}}44;"></div>
        <span style="font-size:22px; color:#444; font-family:monospace; letter-spacing:0.03em;">{{VENUE}}, {{CITY}}</span>
      </div>
      <div style="font-size:18px; color:#ccff00; letter-spacing:0.12em; opacity:0.35;">BAYMOVES.COM</div>
    </div>

  </div>
</div>
</body>
</html>
```

# ──────────────────────────────────────────────
# STEP 5: OG IMAGE GENERATION (Puppeteer screenshots)
# ──────────────────────────────────────────────

```javascript
const GENRE_COLORS = {
  edm:        { c: '#00f0ff', dim: '#003840', label: 'EDM' },
  raves:      { c: '#e040fb', dim: '#3a0042', label: 'RAVE' },
  punk:       { c: '#ff2d2d', dim: '#400000', label: 'PUNK' },
  rock:       { c: '#ff8a00', dim: '#3d2000', label: 'ROCK' },
  misc:       { c: '#ccff00', dim: '#2a3300', label: 'MISC' },
  electronic: { c: '#00f0ff', dim: '#003840', label: 'EDM' },
};

function getPrimaryGenre(event) {
  const genres = getGenres(event).split(',').map(g => g.trim().toLowerCase());
  for (const g of ['raves', 'edm', 'electronic', 'punk', 'rock']) {
    if (genres.includes(g)) return g;
  }
  return 'misc';
}

async function generateOGImages(allEvents) {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1200, height: 630 });

  const dir = 'og-images';
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const template = fs.readFileSync('og-template.html', 'utf8');

  for (const event of allEvents) {
    const slug = generateSlug(event);
    const genre = getPrimaryGenre(event);
    const gc = GENRE_COLORS[genre] || GENRE_COLORS.misc;
    const free = (event.price || event.details || '').toUpperCase().includes('FREE');

    const displayTitle = escapeHtml(event.title);
    const tLen = displayTitle.length;
    const titleSize = tLen <= 8 ? 120 : tLen <= 14 ? 100 : tLen <= 20 ? 82 : 66;
    const genreTagSize = Math.round(titleSize * 0.7);

    const priceText = event.price || event.details || '';
    const pricePadding = free ? '8px 26px 8px 34px' : '6px 22px 6px 28px';
    const priceBg = free ? gc.c : '#151518';
    const priceColor = free ? '#000' : '#555';
    const priceSize = free ? 26 : 20;
    const priceSpacing = free ? '0.12em' : '0.06em';
    const priceBorder = free ? '' : 'border:1px solid #222; border-right:none;';

    const dateObj = new Date(event.date + 'T12:00:00');
    const dayNum = String(dateObj.getDate()).padStart(2, '0');
    const dayAbbr = dateObj.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase();

    let html = template
      .replace(/\{\{TITLE\}\}/g, displayTitle)
      .replace(/\{\{TITLE_SIZE\}\}/g, String(titleSize))
      .replace(/\{\{GENRE_TAG_SIZE\}\}/g, String(genreTagSize))
      .replace(/\{\{GENRE_LABEL\}\}/g, gc.label)
      .replace(/\{\{VENUE\}\}/g, escapeHtml(event.venue || ''))
      .replace(/\{\{CITY\}\}/g, escapeHtml(event.city || ''))
      .replace(/\{\{TIME\}\}/g, escapeHtml(event.time || ''))
      .replace(/\{\{DAY_NUM\}\}/g, dayNum)
      .replace(/\{\{DAY_ABBR\}\}/g, dayAbbr)
      .replace(/\{\{GENRE_C\}\}/g, gc.c)
      .replace(/\{\{GENRE_DIM\}\}/g, gc.dim)
      .replace(/\{\{PRICE\}\}/g, escapeHtml(priceText))
      .replace(/\{\{PRICE_PADDING\}\}/g, pricePadding)
      .replace(/\{\{PRICE_BG\}\}/g, priceBg)
      .replace(/\{\{PRICE_COLOR\}\}/g, priceColor)
      .replace(/\{\{PRICE_SIZE\}\}/g, String(priceSize))
      .replace(/\{\{PRICE_SPACING\}\}/g, priceSpacing)
      .replace(/\{\{PRICE_BORDER\}\}/g, priceBorder);

    await page.setContent(html, { waitUntil: 'networkidle0' });
    await page.evaluateHandle('document.fonts.ready');
    await page.screenshot({
      path: `${dir}/${slug}.png`,
      type: 'png',
      clip: { x: 0, y: 0, width: 1200, height: 630 }
    });
  }

  await browser.close();
  console.log(`Generated ${allEvents.length} OG images in /og-images/`);
}
```

# ──────────────────────────────────────────────
# STEP 6: SHARE BUTTON (the one visible addition)
# ──────────────────────────────────────────────

# In the event card HTML generation loop, after the venue div, add:

```javascript
const slug = generateSlug(event);
const shareUrl = `https://baymoves.com/e/${slug}`;
const shareBtn = `<button class="share-btn" onclick="event.preventDefault();event.stopPropagation();shareEvent('${shareUrl}','${escapeHtml(event.title).replace(/'/g, "\\'")}')" title="Share">` +
  `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>` +
  `</button>`;
```

# Add this CSS to the existing style block:

```css
.share-btn {
  background: transparent;
  border: 1px solid #1a1a1a;
  color: #555;
  padding: 6px 10px;
  cursor: pointer;
  font-family: 'Azeret Mono', monospace;
  font-size: 0.7rem;
  letter-spacing: 0.1em;
  transition: all 0.2s;
  display: inline-flex;
  align-items: center;
  margin-top: 10px;
}
.share-btn:hover {
  border-color: var(--acid-green);
  color: var(--acid-green);
}
.share-btn.copied {
  border-color: var(--acid-green);
  color: var(--acid-green);
}
```

# Add this JS inside the existing DOMContentLoaded or at end of body:

```javascript
function shareEvent(url, title) {
  if (navigator.share) {
    navigator.share({ title: title, url: url }).catch(function(){});
  } else {
    navigator.clipboard.writeText(url).then(function() {
      var btn = document.activeElement;
      if (btn && btn.classList.contains('share-btn')) {
        btn.classList.add('copied');
        var origHTML = btn.innerHTML;
        btn.innerHTML = 'COPIED';
        setTimeout(function() {
          btn.innerHTML = origHTML;
          btn.classList.remove('copied');
        }, 1500);
      }
    });
  }
}
```

# ──────────────────────────────────────────────
# STEP 7: WIRE IT INTO build()
# ──────────────────────────────────────────────

# In the build() function, AFTER generateHTML(eventsByDate, sortedDates), add:

```javascript
const allEventsList = sortedDates.flatMap(date =>
  (eventsByDate[date] || []).map(event => {
    const dateObj = new Date(date + 'T12:00:00');
    return {
      ...event,
      date: date,
      dayNum: String(dateObj.getDate()).padStart(2, '0'),
      dayAbbr: dateObj.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase(),
    };
  })
);
generateEventPages(allEventsList);
await generateOGImages(allEventsList);
```

# ──────────────────────────────────────────────
# DESIGN SPEC (exact values — V9 final)
# ──────────────────────────────────────────────
#
# Background: #08080a (single dark surface, NOT a split panel)
# Font: Bebas Neue, fallback Impact/Arial Black
#
# GENRE COLORS + LABELS:
#   edm/electronic: c=#00f0ff dim=#003840 label=EDM
#   raves:          c=#e040fb dim=#3a0042 label=RAVE
#   punk:           c=#ff2d2d dim=#400000 label=PUNK
#   rock:           c=#ff8a00 dim=#3d2000 label=ROCK
#   misc:           c=#ccff00 dim=#2a3300 label=MISC
#
# GIANT DATE WATERMARK:
#   font-size: 496px | right: 60px | top: 140px
#   color: genre color | opacity: 0.35
#   font-weight: 900 | line-height: 0.75 | letter-spacing: -0.04em
#
# ROTATED DAY:
#   font-size: 64px | right: 80px | top: 50% translateY(-50%) rotate(90deg)
#   color: genre color | opacity: 0.5 | letter-spacing: 0.3em
#
# GENRE GRADIENT WASH (3 layers):
#   radial-gradient(ellipse 80% 120% at 95% 60%, {c}18, transparent 60%)
#   radial-gradient(ellipse 60% 80% at 10% 90%, {c}0c, transparent 50%)
#   linear-gradient(160deg, {dim}44, transparent 40%)
#
# Top band: 5px, gradient {c} → {c}66 → transparent 70%
# Bottom line: 3px, gradient {c}88 → {c}22
#
# Price tag: clipPath polygon(18px 0, 100% 0, 100% 100%, 0 100%)
#   FREE: bg=genre color, text=#000, 26px, spacing 0.12em
#   Paid: bg=#151518, text=#555, 20px, spacing 0.06em, border 1px #222
#
# Readable date: 52px, genre color, glow text-shadow
# Title: 66-120px (≤8ch:120, ≤14ch:100, ≤20ch:82, >20ch:66)
#   white, uppercase, max-width 75%, text-shadow depth
#
# GENRE TAG (directly below title):
#   font-size: 70% of title size (titleSize * 0.7)
#   color: genre color
#   letter-spacing: 0.15em
#   padding: 4px 14px
#   border: 2px solid {genre_color}55
#   background: {genre_color}10
#   margin-top: 10px
#   display: inline-block
#   Uses the genre label text (EDM, RAVE, PUNK, ROCK, MISC)
#
# Venue: 22px monospace #444, 7px genre dot with glow
# Brand: BAYMOVES.COM, 18px, #ccff00, opacity 0.35
# Scanlines: 14px gap, rgba(255,255,255,0.012)
#
# ──────────────────────────────────────────────
# TESTING
# ──────────────────────────────────────────────
#
# 1. npm run build
# 2. Check /e/ has .html files and /og-images/ has .png files
# 3. Validate at https://opengraph.xyz
# 4. iMessage caches aggressively — test with fresh URLs
# 5. Confirm the site looks IDENTICAL in the browser (zero visual changes)
