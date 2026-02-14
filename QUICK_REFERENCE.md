// QUICK_REFERENCE.md
// Copy/paste these exact snippets into your build.js

# Quick Reference: Code Snippets

## 1️⃣ Add to top of build.js (after line 3)

```javascript
const puppeteer = require('puppeteer');
```

---

## 2️⃣ Add these TWO functions after parseFoopee (around line 280)

```javascript
// Parse posh.vip events using Puppeteer
async function parsePoshVip() {
  console.log('\n=== Scraping posh.vip ===');
  
  let browser;
  try {
    const puppeteer = require('puppeteer');
    
    browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu'
      ]
    });
    
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    const location = {
      type: 'preset',
      location: 'San Francisco',
      lat: 37.7749,
      long: -122.4194
    };
    
    const url = `https://posh.vip/explore?location=${encodeURIComponent(JSON.stringify(location))}`;
    
    console.log(`  Navigating to posh.vip...`);
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    await page.waitForTimeout(3000);
    
    console.log(`  Extracting event data...`);
    
    const rawEvents = await page.evaluate(() => {
      // UPDATE THESE SELECTORS based on test-posh.js findings!
      const eventElements = document.querySelectorAll('[data-testid="event-card"], .event-card, article');
      const results = [];
      
      eventElements.forEach((el) => {
        try {
          const titleEl = el.querySelector('h1, h2, h3, h4, [class*="title"], [class*="Title"]');
          const dateEl = el.querySelector('time, [class*="date"], [class*="Date"]');
          const venueEl = el.querySelector('[class*="venue"], [class*="Venue"], [class*="location"], [class*="Location"]');
          const linkEl = el.querySelector('a');
          
          const title = titleEl?.textContent?.trim();
          const dateText = dateEl?.textContent?.trim() || dateEl?.getAttribute('datetime');
          const venue = venueEl?.textContent?.trim();
          const link = linkEl?.href;
          const allText = el.textContent.toLowerCase();
          
          if (!title || !dateText) return;
          if (allText.includes('21+') || allText.includes('21 +')) return;
          
          results.push({ title, dateText, venue, link });
        } catch (err) {
          console.error('Error parsing event:', err.message);
        }
      });
      
      return results;
    });
    
    await browser.close();
    browser = null;
    
    console.log(`  Found ${rawEvents.length} raw events from posh.vip`);
    
    const formattedEvents = [];
    
    rawEvents.forEach((event) => {
      try {
        const date = parsePoshDate(event.dateText);
        if (!date) return;
        
        let time = null;
        const timeMatch = event.dateText.match(/(\d{1,2}:\d{2}\s*(?:AM|PM|am|pm)?)/);
        if (timeMatch) time = timeMatch[1];
        
        formattedEvents.push({
          date,
          time,
          source: 'posh',
          title: event.title,
          venue: event.venue || '',
          city: 'San Francisco',
          details: '',
          bands: [],
          link: event.link || null
        });
      } catch (err) {
        console.error('Error formatting event:', err.message);
      }
    });
    
    console.log(`  Successfully formatted ${formattedEvents.length} posh.vip events`);
    return formattedEvents;
    
  } catch (error) {
    console.error(`  ❌ Error scraping posh.vip: ${error.message}`);
    console.error(`  Continuing without posh.vip events...`);
    return [];
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch (e) {}
    }
  }
}

function parsePoshDate(dateStr) {
  if (!dateStr) return null;
  
  try {
    let cleaned = dateStr.replace(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*,?\s*/i, '');
    const dateObj = new Date(cleaned);
    
    if (isNaN(dateObj.getTime())) {
      const currentYear = new Date().getFullYear();
      const withYear = `${cleaned}, ${currentYear}`;
      const dateObj2 = new Date(withYear);
      
      if (!isNaN(dateObj2.getTime())) {
        const year = dateObj2.getFullYear();
        const month = String(dateObj2.getMonth() + 1).padStart(2, '0');
        const day = String(dateObj2.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
      }
      return null;
    }
    
    const year = dateObj.getFullYear();
    const month = String(dateObj.getMonth() + 1).padStart(2, '0');
    const day = String(dateObj.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
    
  } catch (err) {
    console.error(`Date parsing error for "${dateStr}":`, err.message);
    return null;
  }
}
```

---

## 3️⃣ Add to build() function (around line 620)

Find this section:
```javascript
  // Scrape Foopee
  const foopeeEvents = await scrapeFoopee();
  allEvents.push(...foopeeEvents);
  console.log(`✓ Scraped ${foopeeEvents.length} events from Foopee`);
  
  // Generate HTML
  generateHTML(allEvents);
```

Change to:
```javascript
  // Scrape Foopee
  const foopeeEvents = await scrapeFoopee();
  allEvents.push(...foopeeEvents);
  console.log(`✓ Scraped ${foopeeEvents.length} events from Foopee`);
  
  // Scrape posh.vip
  const poshEvents = await parsePoshVip();
  allEvents.push(...poshEvents);
  console.log(`✓ Scraped ${poshEvents.length} events from posh.vip`);
  
  // Generate HTML
  generateHTML(allEvents);
```

---

## ✅ That's it! Three small changes.

**Before running**, you MUST:
1. Install Puppeteer: `npm install puppeteer --save`
2. Run the test script: `node test-posh.js`
3. Update the selectors in step 2 based on what you find

**Then run:**
```bash
npm run dev
```

---

## Expected Console Output

```
Starting event aggregation...

=== Scraping 19hz ===
  Fetching https://19hz.info/eventlisting_BayArea.php...
✓ Scraped 47 events from 19hz

=== Scraping Foopee ===
  Fetching week pages...
  Found 12 events from Foopee
✓ Scraped 12 events from Foopee

=== Scraping posh.vip ===
  Navigating to posh.vip...
  Extracting event data...
  Found 23 raw events from posh.vip
  Successfully formatted 18 posh.vip events
✓ Scraped 18 events from posh.vip

Generating HTML from 77 total events...
✓ Build complete!
```

---

## Common Issues

| Error | Fix |
|-------|-----|
| "Cannot find module 'puppeteer'" | Run `npm install puppeteer --save` |
| "Found 0 raw events from posh.vip" | Update selectors (run test-posh.js first!) |
| "Navigation timeout" | Increase timeout to 60000ms |
| Build takes forever | Set `headless: 'new'` (should already be set) |

---

## Performance Note

⏱️ Build time will increase by ~10-15 seconds  
👥 User experience: NO CHANGE (serving cached HTML)  
🔄 Automation: Works with existing cron job  
💾 Memory: Puppeteer uses ~200MB during build (released after)
