// INTEGRATION_STEPS.md
// Step-by-step guide to add posh.vip to your build.js

# Integration Steps

## Step 1: Install Puppeteer

Run in your project directory:
```bash
npm install puppeteer --save
```

This will update your package.json and install the necessary dependencies.

---

## Step 2: Test posh.vip Scraper First

Before integrating, test the scraper to find the correct selectors:

```bash
node test-posh.js
```

This will:
- Open a browser window to posh.vip
- Take a screenshot (posh-debug-screenshot.png)
- Save the HTML (posh-debug-page.html)
- Show sample event data

**IMPORTANT**: Look at the output and update the selectors in `posh-parser.js` to match the actual posh.vip DOM structure.

---

## Step 3: Add to build.js

### Location 1: Add at top of build.js (line 1-2)

```javascript
const fetch = require('node-fetch');
const cheerio = require('cheerio');
const fs = require('fs');
const puppeteer = require('puppeteer'); // ADD THIS LINE
```

### Location 2: Add parsePoshVip function

Copy the entire `parsePoshVip()` and `parsePoshDate()` functions from `posh-parser.js` and paste them AFTER the `parseFoopee()` function (around line 280 in your current build.js).

The structure should look like:

```javascript
// ... existing parse19hz function ...

// ... existing parseFoopee function and related helpers ...

// ===== NEW: ADD THESE FUNCTIONS HERE =====
async function parsePoshVip() {
  // ... paste entire function from posh-parser.js ...
}

function parsePoshDate(dateStr) {
  // ... paste entire function from posh-parser.js ...
}
// =========================================

// ... rest of the file (scrapeFoopee, build, generateHTML, etc) ...
```

### Location 3: Update the build() function

Find the `build()` function (around line 600). It currently looks like:

```javascript
async function build() {
  console.log('Starting event aggregation...\n');
  
  const allEvents = [];
  
  // Scrape 19hz
  const html19hz = await fetchHTML('https://19hz.info/eventlisting_BayArea.php');
  if (html19hz) {
    const events = parse19hz(html19hz);
    allEvents.push(...events);
    console.log(`✓ Scraped ${events.length} events from 19hz`);
  }
  
  // Scrape Foopee
  const foopeeEvents = await scrapeFoopee();
  allEvents.push(...foopeeEvents);
  console.log(`✓ Scraped ${foopeeEvents.length} events from Foopee`);
  
  // Generate HTML
  generateHTML(allEvents);
}
```

Change it to:

```javascript
async function build() {
  console.log('Starting event aggregation...\n');
  
  const allEvents = [];
  
  // Scrape 19hz
  const html19hz = await fetchHTML('https://19hz.info/eventlisting_BayArea.php');
  if (html19hz) {
    const events = parse19hz(html19hz);
    allEvents.push(...events);
    console.log(`✓ Scraped ${events.length} events from 19hz`);
  }
  
  // Scrape Foopee
  const foopeeEvents = await scrapeFoopee();
  allEvents.push(...foopeeEvents);
  console.log(`✓ Scraped ${foopeeEvents.length} events from Foopee`);
  
  // ===== NEW: ADD THESE LINES =====
  // Scrape posh.vip
  const poshEvents = await parsePoshVip();
  allEvents.push(...poshEvents);
  console.log(`✓ Scraped ${poshEvents.length} events from posh.vip`);
  // ================================
  
  // Generate HTML
  generateHTML(allEvents);
}
```

---

## Step 4: Test the Integration

Run a fresh build:

```bash
npm run dev
```

Watch the output. You should see:
```
Starting event aggregation...

=== Scraping 19hz ===
✓ Scraped X events from 19hz

=== Scraping Foopee ===
...
✓ Scraped X events from Foopee

=== Scraping posh.vip ===
  Navigating to posh.vip...
  Extracting event data...
  Found X raw events from posh.vip
  Successfully formatted X posh.vip events
✓ Scraped X events from posh.vip
```

---

## Step 5: Verify the Output

1. Open http://localhost:8080 (or wherever your site is served)
2. Look for events with "posh" source in the console/data
3. Verify events display correctly
4. Check that 21+ events are filtered out
5. Confirm dates are parsed correctly

---

## Step 6: Update Your Rebuild Script

Your current `rebuild.sh` should work as-is, but verify it includes:

```bash
#!/bin/bash
npm run build
```

The posh.vip scraping will automatically run as part of the build process.

---

## Troubleshooting

### Problem: "Cannot find module 'puppeteer'"
**Solution**: Run `npm install puppeteer --save`

### Problem: No events found from posh.vip
**Solution**: 
1. Run `node test-posh.js` to debug
2. Check the screenshot and HTML files
3. Update selectors in `parsePoshVip()` function

### Problem: Dates not parsing correctly
**Solution**: 
1. Check what format posh.vip uses in test output
2. Update `parsePoshDate()` function to handle that format

### Problem: 21+ events showing up
**Solution**: 
1. Check where age restriction appears in the HTML
2. Update the filter logic in `parsePoshVip()` evaluate function

### Problem: Build takes too long
**Solution**:
1. Change `headless: 'new'` to ensure it's running headless
2. Reduce `waitForTimeout` if events load faster
3. Consider parallel scraping (advanced)

---

## Optional Enhancements

### 1. Add Visual Badge for posh.vip Events

In the `generateHTML()` function, where event cards are created:

```javascript
const sourceLabel = event.source === 'posh' ? '<span class="source-badge">POSH</span>' : '';
cardsHtml += `                    <div class="event-title">${escapeHtml(event.title)} ${sourceLabel}</div>\n`;
```

Then add CSS in the style section:

```css
.source-badge {
    display: inline-block;
    padding: 2px 8px;
    font-size: 0.7rem;
    background: var(--acid-green);
    color: var(--deep-black);
    border-radius: 3px;
    margin-left: 8px;
}
```

### 2. Add Event Links (if available)

If posh.vip events have links, make the title clickable:

```javascript
if (event.link) {
    cardsHtml += `                    <a href="${escapeHtml(event.link)}" target="_blank" class="event-title">${escapeHtml(event.title)}</a>\n`;
} else {
    cardsHtml += `                    <div class="event-title">${escapeHtml(event.title)}</div>\n`;
}
```

### 3. Filter by Event Type

If posh.vip has event categories, you could filter for music events only:

```javascript
// In parsePoshVip evaluate function
const category = el.querySelector('[class*="category"]')?.textContent?.toLowerCase();
if (!category || !category.includes('music')) {
    return; // Skip non-music events
}
```

---

## Summary of Changes

Files Modified:
- ✅ package.json (add puppeteer dependency)
- ✅ build.js (add parsePoshVip function and call it in build())

Files Created (for testing):
- ✅ test-posh.js (standalone test script)
- ✅ posh-parser.js (reference implementation)

Expected Behavior:
- Daily cron job rebuilds site with posh.vip events
- Build time increases by ~10 seconds
- User experience unchanged (still serving static HTML)
- Graceful degradation if posh.vip fails

---

## Timeline

- **Testing**: 30 minutes (run test-posh.js, find selectors)
- **Integration**: 15 minutes (copy/paste code into build.js)
- **Verification**: 15 minutes (test full build, check output)
- **Total**: ~1 hour

---

## Need Help?

If you get stuck:

1. Run `node test-posh.js` and share the output
2. Check the screenshot files it generates
3. Verify puppeteer is installed: `npm list puppeteer`
4. Check for errors in the console when running `npm run dev`

The most common issue is selector mismatch - posh.vip's DOM structure might be different than expected, so the test script is crucial for finding the right selectors.
