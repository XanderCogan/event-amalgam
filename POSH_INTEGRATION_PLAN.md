# Posh.vip Integration Plan

## Executive Summary

**Status**: posh.vip is a React SPA (Single Page Application) that loads events via client-side JavaScript.  
**Recommended Approach**: Puppeteer-based scraping (headless browser)  
**Alternative**: Apify scraper service (paid, but battle-tested)  
**Complexity**: Medium - more complex than 19hz/Foopee but very doable  
**Performance Impact**: Minimal when cached properly

---

## Investigation Results

### What We Found:
1. **No Public API**: posh.vip doesn't offer a free public API for event listings
2. **React SPA**: Events load dynamically via JavaScript, so simple curl/fetch won't work
3. **Apify Scraper Exists**: There's a commercial scraper (https://apify.com/hypebridge/posh-vip) proving it's scrapable
4. **URL Structure**: 
   - Base: `https://posh.vip/explore`
   - Location parameter: `location={"type":"preset","location":"San Francisco","lat":37.7749,"long":-122.4194}`

### Why Puppeteer?
- Renders JavaScript (required for React apps)
- Can wait for dynamic content to load
- Relatively lightweight when configured properly
- Scales fine for 100 concurrent users (you're serving cached HTML)

---

## Implementation Approach

### Architecture Decision

```
Current:
  19hz (HTML scraping) ─┐
  Foopee (HTML scraping)─┼─> build.js -> index.html -> cached & served
                         │
New:
  posh.vip (Puppeteer) ──┘
```

**Key Point**: posh.vip scraping happens ONCE during build, not on every user request.  
Your HTML is cached and served statically, so 100 users = zero additional scraping.

---

## Code Implementation

### Step 1: Install Dependencies

```bash
npm install puppeteer --save
```

### Step 2: Create posh.vip Parser

Add to `build.js` after the Foopee parser (around line 280):

```javascript
// Parse posh.vip events using Puppeteer
async function parsePoshVip() {
  console.log('\n=== Scraping posh.vip ===');
  
  try {
    const puppeteer = require('puppeteer');
    
    // Launch headless browser
    const browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    const page = await browser.newPage();
    
    // Set viewport and user agent
    await page.setViewport({ width: 1920, height: 1080 });
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36');
    
    // San Francisco coordinates
    const location = {
      type: 'preset',
      location: 'San Francisco',
      lat: 37.7749,
      long: -122.4194
    };
    
    const url = `https://posh.vip/explore?location=${encodeURIComponent(JSON.stringify(location))}`;
    
    console.log(`  Navigating to: ${url}`);
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    
    // Wait for events to load (adjust selector based on actual page structure)
    await page.waitForSelector('[data-testid="event-card"], .event-card, article', { timeout: 10000 });
    
    // Extract event data
    const events = await page.evaluate(() => {
      const eventElements = document.querySelectorAll('[data-testid="event-card"], .event-card, article');
      const results = [];
      
      eventElements.forEach(el => {
        try {
          // Extract event details (these selectors need to be adjusted based on actual DOM)
          const title = el.querySelector('h2, h3, .event-title')?.textContent?.trim();
          const venue = el.querySelector('.venue, .location')?.textContent?.trim();
          const dateText = el.querySelector('.date, time')?.textContent?.trim();
          const timeText = el.querySelector('.time')?.textContent?.trim();
          const ageRestriction = el.textContent.toLowerCase();
          const link = el.querySelector('a')?.href;
          
          // Skip 21+ events
          if (ageRestriction.includes('21+')) {
            return;
          }
          
          if (title && dateText) {
            results.push({
              title,
              venue,
              dateText,
              timeText,
              link,
              rawHtml: el.outerHTML // for debugging
            });
          }
        } catch (err) {
          console.error('Error parsing event element:', err);
        }
      });
      
      return results;
    });
    
    await browser.close();
    
    console.log(`  Found ${events.length} posh.vip events`);
    
    // Convert to standardized format
    const formattedEvents = [];
    const now = new Date();
    
    events.forEach(event => {
      // Parse date (you'll need to adjust based on posh.vip's date format)
      const date = parsePoshDate(event.dateText);
      
      if (date) {
        formattedEvents.push({
          date,
          time: event.timeText || null,
          source: 'posh',
          title: event.title,
          venue: event.venue || '',
          city: 'San Francisco',
          details: '',
          bands: [],
          link: event.link
        });
      }
    });
    
    return formattedEvents;
    
  } catch (error) {
    console.error('Error scraping posh.vip:', error.message);
    console.error('Continuing without posh.vip events...');
    return []; // Graceful degradation
  }
}

// Helper function to parse posh.vip dates
function parsePoshDate(dateStr) {
  if (!dateStr) return null;
  
  // Examples of possible formats:
  // "Fri, Feb 14" or "Feb 14" or "2/14/2026"
  
  try {
    const dateObj = new Date(dateStr);
    if (!isNaN(dateObj.getTime())) {
      const year = dateObj.getFullYear();
      const month = String(dateObj.getMonth() + 1).padStart(2, '0');
      const day = String(dateObj.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    }
  } catch (err) {
    console.error('Date parse error:', err);
  }
  
  return null;
}
```

### Step 3: Integrate into Main Build Function

Find the `build()` function (around line 600) and add posh.vip:

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
  
  // ===== NEW: Scrape posh.vip =====
  const poshEvents = await parsePoshVip();
  allEvents.push(...poshEvents);
  console.log(`✓ Scraped ${poshEvents.length} events from posh.vip`);
  // ================================
  
  // Generate HTML (existing code continues...)
  generateHTML(allEvents);
}
```

### Step 4: Update package.json

```json
{
  "dependencies": {
    "cheerio": "^1.0.0",
    "node-fetch": "^2.7.0",
    "puppeteer": "^22.0.0"
  }
}
```

---

## Testing Strategy

### Phase 1: Inspect the DOM (Do This First!)

Before running the scraper, manually visit:
```
https://posh.vip/explore?location=%7B%22type%22%3A%22preset%22%2C%22location%22%3A%22San%20Francisco%22%2C%22lat%22%3A37.7749%2C%22long%22%3A-122.4194%7D
```

**In browser DevTools**:
1. Inspect an event card
2. Note the class names/selectors
3. Check date format
4. Verify age restriction text location

**Update selectors in code** based on what you find.

### Phase 2: Test Scraper Standalone

Create `test-posh.js`:

```javascript
const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ headless: false }); // headless: false to watch
  const page = await browser.newPage();
  
  const location = {
    type: 'preset',
    location: 'San Francisco',
    lat: 37.7749,
    long: -122.4194
  };
  
  const url = `https://posh.vip/explore?location=${encodeURIComponent(JSON.stringify(location))}`;
  
  await page.goto(url, { waitUntil: 'networkidle2' });
  
  // Wait a bit for content to load
  await page.waitForTimeout(3000);
  
  // Take screenshot for debugging
  await page.screenshot({ path: 'posh-debug.png', fullPage: true });
  
  // Extract page content
  const content = await page.content();
  console.log('Page title:', await page.title());
  console.log('Event cards found:', await page.$$eval('*', els => els.length));
  
  await browser.close();
})();
```

Run: `node test-posh.js`

### Phase 3: Integration Test

```bash
npm run dev
```

Check output for:
- "Scraped X events from posh.vip"
- No errors
- Events display on site

---

## Performance Considerations

### Concern: "Will Puppeteer slow down my site?"

**Answer: NO** - Here's why:

1. **Build-time only**: Puppeteer runs during `npm run dev` or cron rebuild
2. **Not per-request**: Users get static HTML (already generated)
3. **Cached output**: 100 users = 0 additional scraping
4. **Daily rebuild**: posh.vip scraping happens once per day at midnight

### Actual Performance Impact:

```
Current build time: ~5-10 seconds (19hz + Foopee)
With posh.vip: ~15-20 seconds (adds 10 seconds for browser launch)
User experience: ZERO change (they see cached HTML)
```

### Optimization Options:

If build time becomes an issue:
1. **Parallel scraping**: Run all scrapers simultaneously
2. **Headless optimization**: Use `headless: 'new'` mode
3. **Selector optimization**: More specific selectors = faster extraction

---

## Error Handling & Resilience

### Graceful Degradation

The code includes try-catch blocks:
```javascript
try {
  const poshEvents = await parsePoshVip();
  allEvents.push(...poshEvents);
} catch (error) {
  console.error('posh.vip scraping failed, continuing without...');
  // Site still works with 19hz + Foopee events
}
```

**Translation**: If posh.vip scraping fails, your site still shows 19hz and Foopee events.

### Common Issues & Solutions:

| Issue | Solution |
|-------|----------|
| Timeout | Increase `waitUntil` timeout to 60000ms |
| Selector not found | Update selectors after DOM inspection |
| Rate limiting | Add delay: `await page.waitForTimeout(2000)` |
| Memory leak | Ensure `browser.close()` in finally block |

---

## Alternative Approach: Apify Scraper

### Pros:
- ✅ Battle-tested, maintained by professionals
- ✅ Handles rate limiting, retries, errors
- ✅ Just API calls (no Puppeteer setup)

### Cons:
- ❌ Costs money (~$5-10/month for your volume)
- ❌ External dependency

### Implementation:

```javascript
async function parsePoshVipApify() {
  const APIFY_TOKEN = process.env.APIFY_TOKEN; // Store in .env
  
  const response = await fetch('https://api.apify.com/v2/acts/hypebridge~posh-vip/runs', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${APIFY_TOKEN}`
    },
    body: JSON.stringify({
      startUrls: [{
        url: 'https://posh.vip/explore?location=...'
      }],
      scrapeEventDetails: false,
      maxEvents: 100
    })
  });
  
  // Poll for results...
  // Transform to your event format...
}
```

---

## Deployment Checklist

### Before Going Live:

- [ ] Test scraper locally with `node test-posh.js`
- [ ] Verify selectors match current posh.vip DOM
- [ ] Run full build: `npm run dev`
- [ ] Check for duplicates across sources
- [ ] Verify 21+ filtering works
- [ ] Test date parsing for various formats
- [ ] Confirm automated rebuild works
- [ ] Monitor build times (should be <30 seconds)
- [ ] Set up error alerting (optional: email on build failure)

### Production Monitoring:

Add logging to track posh.vip health:
```javascript
const stats = {
  '19hz': events19hz.length,
  'foopee': foopeeEvents.length,
  'posh': poshEvents.length,
  'total': allEvents.length
};

console.log('\n=== Scraping Summary ===');
console.log(JSON.stringify(stats, null, 2));
```

---

## Next Steps

1. **Immediate**: Install Puppeteer and test the scraper
2. **Adjust**: Update selectors based on actual DOM structure
3. **Integrate**: Add to build.js following the code above
4. **Test**: Run full build and verify output
5. **Deploy**: Update rebuild.sh to include posh.vip events

**Estimated Time**: 2-3 hours (mostly selector adjustment and testing)

---

## Questions to Answer Before Starting

1. **Do you want ALL posh.vip events, or just certain categories?** (e.g., music only)
2. **Should we include events outside SF city limits?** (Oakland/Berkeley already in Foopee)
3. **Any specific venue filters?** (e.g., exclude certain venues)
4. **Budget for Apify if Puppeteer is too complex?** ($5-10/month alternative)

---

## Summary

**Recommended Path**: Puppeteer-based scraping
- Medium complexity
- Zero ongoing costs
- Full control
- Scales with your existing architecture

**Backup Path**: Apify scraper
- Low complexity
- Small monthly cost
- Maintained by professionals
- Quick to implement

Both approaches work fine with 100 concurrent users because scraping happens at build-time, not request-time.
