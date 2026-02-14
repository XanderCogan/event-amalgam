const fetch = require('node-fetch');
const cheerio = require('cheerio');
const fs = require('fs');
const puppeteer = require('puppeteer');

// Fetch HTML from a URL
async function fetchHTML(url) {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return await response.text();
  } catch (error) {
    console.error(`Error fetching ${url}:`, error.message);
    return null;
  }
}

// Helper function to parse date strings
function parseDateString(dateStr) {
  // Parse MM/DD/YYYY format
  if (dateStr.includes('/')) {
    const parts = dateStr.split('/');
    if (parts.length === 3) {
      const [month, day, year] = parts;
      return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    }
  }
  
  // Try to parse "Monday, Jan 20" or "Mon Jan 20" format
  const dateObj = new Date(dateStr);
  if (!isNaN(dateObj.getTime())) {
    const year = dateObj.getFullYear();
    const month = String(dateObj.getMonth() + 1).padStart(2, '0');
    const day = String(dateObj.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  
  return null;
}

// Parse 19hz.info events
function parse19hz(html) {
  const $ = cheerio.load(html);
  const events = [];
  
  // Find the table with events
  $('table').each((i, table) => {
    $(table).find('tbody tr').each((j, row) => {
      const cells = $(row).find('td');
      if (cells.length < 6) return; // Skip header rows or incomplete rows
      
      const dateTime = $(cells[0]).text().trim();
      const eventTitleVenue = $(cells[1]).text().trim();
      const tags = $(cells[2]).text().trim();
      const priceAge = $(cells[3]).text().trim();
      const organizers = $(cells[4]).text().trim();
      const links = $(cells[5]).text().trim();
      
      // Filter: exclude 21+ events
      if (priceAge.toLowerCase().includes('21+') || priceAge.toLowerCase().includes('+ 21')) {
        return;
      }
      
      // Filter: exclude Sacramento events
      if (eventTitleVenue.includes('(Sacramento)')) {
        return;
      }
      
      // Parse date and time
      let date = null;
      let time = null;
      
      // Try to match date and time together first
      const dateTimeMatch = dateTime.match(/(\d{1,2}\/\d{1,2}\/\d{4}|\w+day,?\s+\w+\s+\d{1,2})[\s,]+(\d{1,2}:\d{2}\s*(?:am|pm|AM|PM)?)/i);
      if (dateTimeMatch) {
        const dateStr = dateTimeMatch[1];
        const timeStr = dateTimeMatch[2];
        time = timeStr.trim();
        date = parseDateString(dateStr);
      } else {
        // Try to match date without time
        const dateOnlyMatch = dateTime.match(/(\d{1,2}\/\d{1,2}\/\d{4}|\w+day,?\s+\w+\s+\d{1,2})/i);
        if (dateOnlyMatch) {
          date = parseDateString(dateOnlyMatch[1]);
          // Try to extract time separately
          const timeMatch = dateTime.match(/(\d{1,2}:\d{2}\s*(?:am|pm|AM|PM)?)/i);
          if (timeMatch) {
            time = timeMatch[1].trim();
          }
        }
      }
      
      // Extract venue from eventTitleVenue (format: "Event Title @ Venue (City)")
      // Example: "Sound Box - Tash, Snkr @ Make-Out Room (San Francisco)"
      const venueMatch = eventTitleVenue.match(/@\s*(.+)$/);
      let venue = venueMatch ? venueMatch[1].trim() : '';
      const title = venueMatch ? eventTitleVenue.substring(0, venueMatch.index).trim() : eventTitleVenue;
      
      // Extract city from parentheses at the end of venue
      let city = null;
      const cityMatch = venue.match(/\s*\(([^)]+)\)\s*$/);
      if (cityMatch) {
        city = cityMatch[1].trim();
        // Remove the city from the venue name
        venue = venue.substring(0, cityMatch.index).trim();
      }
      
      if (date) {
        events.push({
          date,
          time,
          source: '19hz',
          title,
          venue,
          city,
          details: `${priceAge}${tags ? ' | ' + tags : ''}`,
          bands: [],
          link: null
        });
      }
    });
  });
  
  return events;
}






// Parse Foopee events from a single page
function parseFoopeePage(html) {
  const $ = cheerio.load(html);
  const events = [];
  let currentDate = null;

  console.log('  Parsing Foopee page...');

  
  // Get the date range from the h2 heading (e.g., "Jan 19 - Jan 25")
  const heading = $('h2').first().text();
  const headingMatch = heading.match(/(\w+)\s+(\d{1,2})\s*-\s*(\w+)\s+(\d{1,2})/);
  let weekStartDate = null;
  if (headingMatch) {
    const [, startMonth, startDay, endMonth, endDay] = headingMatch;
    const now = new Date();
    const year = now.getFullYear();
    const monthNames = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 
                       'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
    const startMonthIndex = monthNames.findIndex(m => 
      startMonth.toLowerCase().startsWith(m.toLowerCase())
    );
    if (startMonthIndex !== -1) {
      weekStartDate = new Date(year, startMonthIndex, parseInt(startDay));
    }
  }
  
  // Find the main list structure - iterate through top-level list items
  // Find the main list structure - iterate through top-level list items
$('body > ul > li, body > ol > li').each((i, item) => {
  const $item = $(item);
  const text = $item.text().trim();
  
  // Check if this is a date header
  const dateMatch = text.match(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+(\w+)\s+(\d{1,2})/i);
  if (dateMatch) {
    const [, dayName, monthName, day] = dateMatch;
    console.log(`    Found date header: ${dayName} ${monthName} ${day}`);
    const now = new Date();
    const year = now.getFullYear();
    const monthNames = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 
                       'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
    const monthIndex = monthNames.findIndex(m => 
      monthName.toLowerCase().startsWith(m.toLowerCase())
    );
    
    if (monthIndex !== -1) {
      currentDate = `${year}-${String(monthIndex + 1).padStart(2, '0')}-${day.padStart(2, '0')}`;
    }
    console.log(`    Set currentDate to: ${currentDate}`);
    
    // Now process the nested events for this date
    $item.find('ul > li').each((j, eventItem) => {
      const $eventItem = $(eventItem);


      // Check if this item contains event data (has links)
      const links = $eventItem.find('a');
      if (links.length === 0) return;

      // Get all text content - this is a continuous string format
      // Example: "Black Cat, S.F. Jezebel: Rewritten 21+ $30 6pm/7pm til 9pm"
      const fullText = $eventItem.text().trim();
      
      // Filter: exclude 21+ events
      if (fullText.toLowerCase().includes('21+')) {
        return;
      }
      
      // Extract venue and city from first link (format: "Black Cat, S.F." or "Venue Name, City")
      const venueFull = $(links[0]).text().trim();
      let venue = venueFull;
      let city = null;
      
      // Split on comma to separate venue and city
      const commaIndex = venueFull.lastIndexOf(',');
      if (commaIndex !== -1) {
        venue = venueFull.substring(0, commaIndex).trim();
        city = venueFull.substring(commaIndex + 1).trim();
      }
      
      // Filter: only include S.F., Oakland, and Berkeley events
      if (city) {
        const cityLower = city.toLowerCase();
        const allowedCities = ['s.f.', 'san francisco', 'oakland', 'berkeley', 'berkely'];
        if (!allowedCities.includes(cityLower)) {
          return;
        }
      } else {
        // If no city is found, exclude the event
        return;
      }
      
      // Extract bands (subsequent links)
      const bands = [];
      links.slice(1).each((j, link) => {
        const band = $(link).text().trim();
        if (band) bands.push(band);
      });
      
      // Extract the remaining text after all links (price, age, time)
      // Clone the item and remove all links to get just the text parts
      const $clone = $eventItem.clone();
      $clone.find('a').remove();
      let details = $clone.text().trim();
      // Clean up commas and whitespace
      details = details.replace(/^[\s,]+/, '').replace(/[\s,]+$/, '').trim();
      
      // Extract time from details - handle formats like:
      // "6pm/7pm til 9pm", "7pm/8pm", "7:30pm", "7pm", "6pm/7pm"
      let time = null;
      // Try to match time patterns (including ranges like "6pm/7pm til 9pm")
      const timeMatch = details.match(/(\d{1,2}(?::\d{2})?\s*(?:am|pm|AM|PM)(?:\/\d{1,2}(?::\d{2})?\s*(?:am|pm|AM|PM))?(?:\s+til\s+\d{1,2}(?::\d{2})?\s*(?:am|pm|AM|PM))?)/i);
      if (timeMatch) {
        time = timeMatch[0].trim();
      } else {
        // Fallback: try simpler time pattern
        const simpleTimeMatch = details.match(/(\d{1,2}:\d{2}\s*(?:am|pm|AM|PM)?)/i);
        if (simpleTimeMatch) {
          time = simpleTimeMatch[1].trim();
        }
      }
      
      // Use currentDate if available, otherwise try to infer from structure
      let date = currentDate;
      if (!date && weekStartDate) {
        // Fallback: use week start date if we can't find a specific date
        date = `${weekStartDate.getFullYear()}-${String(weekStartDate.getMonth() + 1).padStart(2, '0')}-${String(weekStartDate.getDate()).padStart(2, '0')}`;
      }

      
      if (date && venue) {
        console.log(`    Adding event on ${date}: ${venue}`);
        events.push({
          date,
          time,
          source: 'foopee',
          title: bands.length > 0 ? bands[0] : venue,
          venue,
          city,
          details,
          bands,
          link: null
        });
      }
    });  
  }
  });
  return events;
}










// Parse posh.vip events via API (no Puppeteer needed!)
async function scrapePoshVip() {
  console.log('Fetching events from posh.vip...');
  
  try {
    const allEvents = [];
    const timeRanges = ['This Week', 'Next Week', 'This Month'];
    
    for (const when of timeRanges) {
      console.log(`  Fetching ${when}...`);
      
      const params = {
        sort: "Trending",
        when: when,
        search: "",
        location: {
          type: "custom",
          location: "San Francisco, CA, USA",
          lat: 37.7749295,
          long: -122.4194155
        },
        secondaryFilters: [],
        where: "San Francisco, CA, USA",
        coordinates: [-122.4194155, 37.7749295],
        limit: 100,
        clientTimezone: "America/Los_Angeles"
      };
      
      const url = `https://posh.vip/api/web/v2/trpc/events.fetchMarketplaceEvents?input=${encodeURIComponent(JSON.stringify(params))}`;
      const response = await fetch(url);
      
      if (!response.ok) {
        console.log(`  ⚠️  Failed to fetch (${response.status})`);
        continue;
      }
      
      const data = await response.json();
      const events = data?.result?.data?.events || [];
      console.log(`  Found ${events.length} events`);
      allEvents.push(...events);
    }
    
    const uniqueEvents = [];
    const seen = new Set();
    allEvents.forEach(event => {
      if (!seen.has(event._id)) {
        seen.add(event._id);
        uniqueEvents.push(event);
      }
    });
    
    const formattedEvents = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    for (const event of uniqueEvents) {
      const dateStr = event.startUtc;
      if (!dateStr) continue;
      
      const date = parseDateString(dateStr);
      if (!date) continue;
      
      const eventDate = new Date(date + 'T00:00:00');
      if (eventDate < today) continue;
      
      const startDate = new Date(dateStr);
      const hours = startDate.getHours();
      const minutes = startDate.getMinutes();
      const ampm = hours >= 12 ? 'PM' : 'AM';
      const displayHours = hours % 12 || 12;
      const time = `${displayHours}:${String(minutes).padStart(2, '0')} ${ampm}`;
      
      const fullText = `${event.name} ${event.venue?.name || ''} ${event.description || ''}`.toLowerCase();
      if (fullText.includes('21+') || fullText.includes('(21+)') || fullText.includes('21 +')) {
        continue;
      }
      
      formattedEvents.push({
        date,
        time,
        source: 'posh.vip',
        title: event.name,
        venue: event.venue?.name || '',
        city: 'San Francisco',
        details: '',
        bands: [],
        link: `https://posh.vip/e/${event.url}`
      });
    }
    
    console.log(`Parsed ${formattedEvents.length} events from posh.vip`);
    return formattedEvents;
    
  } catch (error) {
    console.error('Error scraping posh.vip:', error.message);
    return [];
  }
}



// Wait helper (replaces deprecated page.waitForTimeout in Puppeteer 22+)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Parse posh.vip events using Puppeteer
async function parsePoshVip() {
  console.log('\n=== Scraping posh.vip ===');

  let browser;
  try {
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

    await page.goto(url, {
      waitUntil: 'networkidle2',
      timeout: 30000
    });

    await sleep(3000);

    console.log(`  Extracting event data...`);

    const rawEvents = await page.evaluate(() => {
      const eventElements = document.querySelectorAll('[data-testid="event-card"], .event-card, article');
      const results = [];

      eventElements.forEach((el, index) => {
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

          if (!title || !dateText) {
            return;
          }

          if (allText.includes('21+') || allText.includes('21 +') || allText.includes('21 and over')) {
            return;
          }

          results.push({
            title,
            dateText,
            venue,
            link
          });
        } catch (err) {
          console.error(`Error parsing event ${index}:`, err.message);
        }
      });

      return results;
    });

    await browser.close();
    browser = null;

    console.log(`  Found ${rawEvents.length} raw events from posh.vip`);

    const formattedEvents = [];

    rawEvents.forEach((event, index) => {
      try {
        const date = parsePoshDate(event.dateText);

        if (!date) {
          console.log(`  Warning: Could not parse date "${event.dateText}" for event: ${event.title}`);
          return;
        }

        let time = null;
        const timeMatch = event.dateText.match(/(\d{1,2}:\d{2}\s*(?:AM|PM|am|pm)?)/);
        if (timeMatch) {
          time = timeMatch[1];
        }

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
        console.error(`Error formatting event ${index}:`, err.message);
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

// Main build function
async function build() {
  console.log('Fetching events from 19hz.info...');
  const html19hz = await fetchHTML('https://19hz.info/eventlisting_BayArea.php');
  let events19hz = [];
  if (html19hz) {
    events19hz = parse19hz(html19hz);
    console.log(`Parsed ${events19hz.length} events from 19hz`);
  }
  
  console.log('Fetching events from Foopee...');
  const foopeeEvents = [];
  for (let week = 0; week < 8; week++) {
    const url = `http://www.foopee.com/punk/the-list/by-date.${week}.html`;
    console.log(`  Fetching week ${week}...`);
    const html = await fetchHTML(url);
    if (html) {
      const pageEvents = parseFoopeePage(html);
      foopeeEvents.push(...pageEvents);
    }
  }
  console.log(`Parsed ${foopeeEvents.length} events from Foopee`);

  // Fetch posh.vip events (API-based, no Puppeteer)
  const poshEvents = await scrapePoshVip();
  console.log(`Parsed ${poshEvents.length} events from posh.vip`);
  
  // Combine and group by date
  const allEvents = [...events19hz, ...foopeeEvents, ...poshEvents];
  
  // Group by date
  const eventsByDate = {};
  allEvents.forEach(event => {
    if (!eventsByDate[event.date]) {
      eventsByDate[event.date] = [];
    }
    eventsByDate[event.date].push(event);
  });
  
  // Sort dates
  const sortedDates = Object.keys(eventsByDate).sort();
  
  // Sort events within each date by time
  sortedDates.forEach(date => {
    eventsByDate[date].sort((a, b) => {
      if (!a.time && !b.time) return 0;
      if (!a.time) return 1;
      if (!b.time) return -1;
      return a.time.localeCompare(b.time);
    });
  });
  
  // Generate HTML
  generateHTML(eventsByDate, sortedDates);
  
  console.log(`\nBuild complete! Generated index.html with ${allEvents.length} events across ${sortedDates.length} dates.`);
}

// Generate HTML output
function generateHTML(eventsByDate, sortedDates) {
  let html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>SF MUSIC EVENTS</title>
    <link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Azeret+Mono:wght@400;600&family=DM+Mono:wght@300;400&display=swap" rel="stylesheet">
    <style>
        :root {
            --acid-green: #CCFF00;
            --electric-blue: #00F0FF;
            --deep-black: #0A0A0A;
            --concrete: #1A1A1A;
            --white: #FFFFFF;
            --warning-red: #FF0055;
            --grid-size: 8px;
        }

        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            background: var(--deep-black);
            color: var(--white);
            font-family: 'DM Mono', monospace;
            overflow-x: hidden;
            cursor: crosshair;
        }

        /* Animated grid background */
        body::before {
            content: '';
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background-image: 
                repeating-linear-gradient(0deg, transparent, transparent calc(var(--grid-size) * 10 - 1px), var(--concrete) calc(var(--grid-size) * 10)),
                repeating-linear-gradient(90deg, transparent, transparent calc(var(--grid-size) * 10 - 1px), var(--concrete) calc(var(--grid-size) * 10));
            opacity: 0.15;
            animation: gridPulse 4s ease-in-out infinite;
            pointer-events: none;
            z-index: 0;
        }

        @keyframes gridPulse {
            0%, 100% { opacity: 0.15; }
            50% { opacity: 0.08; }
        }

        /* Noise texture overlay */
        body::after {
            content: '';
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 400 400' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E");
            opacity: 0.03;
            pointer-events: none;
            z-index: 1;
        }

        .container {
            position: relative;
            z-index: 2;
            max-width: 1600px;
            margin: 0 auto;
            padding: 40px 20px;
        }

        /* Masthead */
        header {
            border: 2px solid var(--acid-green);
            padding: 30px;
            margin-bottom: 60px;
            position: relative;
            animation: slideDown 0.8s cubic-bezier(0.16, 1, 0.3, 1);
            background: linear-gradient(135deg, rgba(204, 255, 0, 0.03) 0%, transparent 100%);
        }

        @keyframes slideDown {
            from {
                opacity: 0;
                transform: translateY(-30px);
            }
            to {
                opacity: 1;
                transform: translateY(0);
            }
        }

        header::before {
            content: '';
            position: absolute;
            top: -2px;
            left: -2px;
            right: -2px;
            bottom: -2px;
            background: linear-gradient(45deg, var(--acid-green), var(--electric-blue), var(--acid-green));
            z-index: -1;
            opacity: 0;
            transition: opacity 0.3s;
        }

        header:hover::before {
            opacity: 0.2;
        }

        h1 {
            font-family: 'Bebas Neue', sans-serif;
            font-size: clamp(3rem, 8vw, 7rem);
            letter-spacing: 0.05em;
            line-height: 0.9;
            color: var(--acid-green);
            text-shadow: 3px 3px 0 var(--electric-blue);
            margin-bottom: 20px;
        }

        .subtitle {
            font-family: 'Azeret Mono', monospace;
            font-size: clamp(0.9rem, 1.5vw, 1.1rem);
            color: var(--electric-blue);
            letter-spacing: 0.15em;
            text-transform: uppercase;
            font-weight: 600;
        }

        /* Filter bar */
        .filters {
            display: flex;
            gap: 15px;
            margin-bottom: 40px;
            flex-wrap: wrap;
            animation: slideDown 0.8s cubic-bezier(0.16, 1, 0.3, 1) 0.2s backwards;
        }

        .filter-btn {
            font-family: 'Azeret Mono', monospace;
            background: transparent;
            border: 1px solid var(--concrete);
            color: var(--white);
            padding: 12px 24px;
            cursor: pointer;
            text-transform: uppercase;
            font-size: 0.85rem;
            letter-spacing: 0.1em;
            transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
            position: relative;
            overflow: hidden;
        }

        .filter-btn::before {
            content: '';
            position: absolute;
            top: 0;
            left: -100%;
            width: 100%;
            height: 100%;
            background: var(--acid-green);
            transition: left 0.3s cubic-bezier(0.16, 1, 0.3, 1);
            z-index: -1;
        }

        .filter-btn:hover::before,
        .filter-btn.active::before {
            left: 0;
        }

        .filter-btn:hover,
        .filter-btn.active {
            color: var(--deep-black);
            border-color: var(--acid-green);
        }

        /* Events grid */
        .events-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
            gap: 20px;
            margin-bottom: 60px;
        }

        .event-card {
            border: 1px solid var(--concrete);
            background: linear-gradient(135deg, rgba(26, 26, 26, 0.6) 0%, rgba(10, 10, 10, 0.9) 100%);
            position: relative;
            overflow: hidden;
            animation: fadeInUp 0.6s cubic-bezier(0.16, 1, 0.3, 1) backwards;
            transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
        }

        .event-card:nth-child(1) { animation-delay: 0.1s; }
        .event-card:nth-child(2) { animation-delay: 0.15s; }
        .event-card:nth-child(3) { animation-delay: 0.2s; }
        .event-card:nth-child(4) { animation-delay: 0.25s; }
        .event-card:nth-child(5) { animation-delay: 0.3s; }
        .event-card:nth-child(6) { animation-delay: 0.35s; }
        .event-card:nth-child(n+7) { animation-delay: 0.4s; }

        @keyframes fadeInUp {
            from {
                opacity: 0;
                transform: translateY(30px);
            }
            to {
                opacity: 1;
                transform: translateY(0);
            }
        }

        .event-card::before {
            content: '';
            position: absolute;
            top: 0;
            left: -100%;
            width: 100%;
            height: 2px;
            background: linear-gradient(90deg, transparent, var(--acid-green), transparent);
            transition: left 0.6s cubic-bezier(0.16, 1, 0.3, 1);
        }

        .event-card:hover::before {
            left: 100%;
        }

        .event-card:hover {
            border-color: var(--acid-green);
            transform: translateY(-4px);
            box-shadow: 0 10px 40px rgba(204, 255, 0, 0.1);
        }

        .event-header {
            padding: 20px;
            border-bottom: 1px solid var(--concrete);
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
        }

        .event-date {
            font-family: 'Bebas Neue', sans-serif;
            font-size: 2.5rem;
            line-height: 1;
            color: var(--acid-green);
            letter-spacing: 0.05em;
        }

        .event-day {
            font-size: 0.75rem;
            color: var(--electric-blue);
            text-transform: uppercase;
            letter-spacing: 0.15em;
            margin-top: 5px;
        }

        .event-time {
            font-size: 0.85rem;
            color: var(--electric-blue);
            text-align: right;
            font-family: 'Azeret Mono', monospace;
            font-weight: 600;
        }

        .event-body {
            padding: 20px;
        }

        .event-title {
            font-family: 'Azeret Mono', monospace;
            font-size: 1.1rem;
            font-weight: 600;
            margin-bottom: 12px;
            color: var(--white);
            line-height: 1.3;
            text-transform: uppercase;
            letter-spacing: 0.05em;
        }

        .event-venue {
            font-size: 0.9rem;
            color: var(--electric-blue);
            margin-bottom: 8px;
            font-weight: 400;
        }

        .event-genre {
            display: inline-block;
            background: rgba(204, 255, 0, 0.1);
            border: 1px solid var(--acid-green);
            color: var(--acid-green);
            padding: 4px 10px;
            font-size: 0.75rem;
            text-transform: uppercase;
            letter-spacing: 0.1em;
            margin-top: 12px;
            font-family: 'Azeret Mono', monospace;
        }

        .event-source {
            position: absolute;
            top: 10px;
            right: 10px;
            font-size: 1rem;
            color: var(--acid-green);
            text-transform: uppercase;
            letter-spacing: 0.15em;
            font-weight: 600;
            opacity: 0.7;
        }

        /* Live indicator */
        .live-indicator {
            position: fixed;
            bottom: 30px;
            right: 30px;
            background: var(--deep-black);
            border: 1px solid var(--acid-green);
            padding: 15px 25px;
            font-family: 'Azeret Mono', monospace;
            font-size: 0.85rem;
            letter-spacing: 0.1em;
            z-index: 1000;
            animation: slideUp 0.8s cubic-bezier(0.16, 1, 0.3, 1) 1s backwards;
        }

        @keyframes slideUp {
            from {
                opacity: 0;
                transform: translateY(30px);
            }
            to {
                opacity: 1;
                transform: translateY(0);
            }
        }

        .live-dot {
            display: inline-block;
            width: 8px;
            height: 8px;
            background: var(--acid-green);
            border-radius: 50%;
            margin-right: 10px;
            animation: pulse 2s ease-in-out infinite;
        }

        @keyframes pulse {
            0%, 100% { 
                opacity: 1;
                transform: scale(1);
            }
            50% { 
                opacity: 0.4;
                transform: scale(1.2);
            }
        }

        /* Scrollbar */
        ::-webkit-scrollbar {
            width: 12px;
        }

        ::-webkit-scrollbar-track {
            background: var(--deep-black);
        }

        ::-webkit-scrollbar-thumb {
            background: var(--concrete);
            border: 2px solid var(--deep-black);
        }

        ::-webkit-scrollbar-thumb:hover {
            background: var(--acid-green);
        }

        /* Responsive */
        @media (max-width: 768px) {
            .events-grid {
                grid-template-columns: 1fr;
            }

            h1 {
                font-size: 3rem;
            }

            .live-indicator {
                bottom: 15px;
                right: 15px;
                padding: 10px 15px;
                font-size: 0.75rem;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <header>
            <h1>SF MUSIC EVENTS</h1>
            <div class="subtitle">Bay Area // All Ages // Live Aggregation</div>
        </header>

        <div class="filters">
            <button class="filter-btn active" data-filter="all">All Events</button>
            <button class="filter-btn" data-filter="tonight">Tonight</button>
            <button class="filter-btn" data-filter="weekend">This Weekend</button>
            <button class="filter-btn" data-filter="electronic">Electronic</button>
            <button class="filter-btn" data-filter="live">Live Music</button>
        </div>

        <div class="events-grid" id="eventsGrid">
            <!--EVENT_CARDS_PLACEHOLDER-->
        </div>
    </div>

    <div class="live-indicator">
        <span class="live-dot"></span>
        LIVE DATA
    </div>

    <script>
        // Remove past events on page load
        document.addEventListener('DOMContentLoaded', function() {
            const today = new Date();
            today.setHours(0, 0, 0, 0);

            document.querySelectorAll('.event-card').forEach(card => {
                const eventDateStr = card.dataset.eventDate;
                if (eventDateStr) {
                    const eventDate = new Date(eventDateStr + 'T00:00:00');
                    if (eventDate < today) {
                        card.remove(); // Actually remove from DOM
                    }
                }
            });

            // Filter functionality
            const filterBtns = document.querySelectorAll('.filter-btn');
            const eventCards = document.querySelectorAll('.event-card');

            filterBtns.forEach(btn => {
                btn.addEventListener('click', () => {
                    // Update active state
                    filterBtns.forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');

                    const filter = btn.dataset.filter;

                    // Filter events
                    eventCards.forEach(card => {
                        if (filter === 'all' || card.dataset.category === filter) {
                            card.style.display = 'block';
                            // Re-trigger animation
                            card.style.animation = 'none';
                            setTimeout(() => {
                                card.style.animation = '';
                            }, 10);
                        } else {
                            card.style.display = 'none';
                        }
                    });
                });
            });

            // Add hover sound effect simulation (visual feedback)
            eventCards.forEach(card => {
                card.addEventListener('mouseenter', () => {
                    card.style.transform = 'translateY(-4px) scale(1.01)';
                });
                card.addEventListener('mouseleave', () => {
                    card.style.transform = 'translateY(0) scale(1)';
                });
            });

            // Parallax effect on scroll
            window.addEventListener('scroll', () => {
                const scrolled = window.pageYOffset;
                document.querySelector('header').style.transform = 'translateY(' + (scrolled * 0.3) + 'px)';
            });
        });
    </script>
</body>
</html>
`;

  // Generate event cards from scraped data
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  
  const filteredDates = sortedDates.filter(date => {
    return date >= todayStr;  // Show today and FUTURE dates
  });

  let cardsHtml = '';
  if (filteredDates.length === 0) {
    cardsHtml = '            <div class="no-events">No events found.</div>\n';
  } else {
    filteredDates.forEach(date => {
      const dateObj = new Date(date + 'T00:00:00');
      const dayNum = String(dateObj.getDate()).padStart(2, '0');
      const dayAbbr = dateObj.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase();
      
      eventsByDate[date].forEach(event => {
        const category = event.source === '19hz' ? 'electronic' : 'live';
        const venueDisplay = event.city ? `${event.venue}, ${event.city}` : event.venue;
        
        cardsHtml += `            <div class="event-card" data-category="${category}" data-event-date="${date}">\n`;
        cardsHtml += `                <div class="event-header">\n`;
        cardsHtml += `                    <div>\n`;
        cardsHtml += `                        <div class="event-date">${dayNum}</div>\n`;
        cardsHtml += `                        <div class="event-day">${dayAbbr}</div>\n`;
        cardsHtml += `                    </div>\n`;
        if (event.time) {
          cardsHtml += `                    <div class="event-time">${escapeHtml(event.time)}</div>\n`;
        }
        cardsHtml += `                </div>\n`;
        cardsHtml += `                <div class="event-body">\n`;
        cardsHtml += `                    <div class="event-title">${escapeHtml(event.title)}</div>\n`;
        if (event.venue) {
          cardsHtml += `                    <div class="event-venue">${escapeHtml(venueDisplay)}</div>\n`;
        }
        cardsHtml += `                </div>\n`;
        cardsHtml += `            </div>\n\n`;
      });
    });
  }
  
  // Replace placeholder with generated cards
  html = html.replace('<!--EVENT_CARDS_PLACEHOLDER-->', cardsHtml);
  
  fs.writeFileSync('index.html', html, 'utf8');
}

// Escape HTML to prevent XSS
function escapeHtml(text) {
  if (!text) return '';
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return String(text).replace(/[&<>"']/g, m => map[m]);
}

// Run the build
build().catch(error => {
  console.error('Build failed:', error);
  process.exit(1);
});
