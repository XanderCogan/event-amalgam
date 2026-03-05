require('dotenv').config();
const fetch = require('node-fetch');
const cheerio = require('cheerio');
const fs = require('fs');
const puppeteer = require('puppeteer');
const { classifyAllEvents } = require('./classify-events');

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

// Current date in Pacific (America/Los_Angeles) for consistent filtering on Vercel (UTC) and local builds
function getTodayPacificDateString() {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  const parts = formatter.formatToParts(new Date());
  const year = parts.find(p => p.type === 'year').value;
  const month = parts.find(p => p.type === 'month').value;
  const day = parts.find(p => p.type === 'day').value;
  return `${year}-${month}-${day}`;
}

/**
 * Nightlife convention: events between midnight and 5:59am belong to the previous night.
 * Given a date string "2026-02-20" and a time like "5:00 AM", returns "2026-02-19".
 * Returns the original date if time is missing, unparseable, or >= 6am.
 */
function adjustForAfterMidnight(dateStr, timeStr) {
  if (!dateStr || !timeStr) return dateStr;

  // Parse the time string to extract hour and AM/PM
  const match = timeStr.match(/(\d{1,2}):(\d{2})\s*(am|pm)/i);
  if (!match) return dateStr;

  let hour = parseInt(match[1], 10);
  const ampm = match[3].toLowerCase();

  // Convert to 24h
  if (ampm === 'am' && hour === 12) hour = 0;
  if (ampm === 'pm' && hour !== 12) hour += 12;

  // If between midnight (0:00) and 5:59am, roll back one day
  if (hour < 6) {
    const d = new Date(dateStr + 'T12:00:00'); // noon to avoid TZ edge cases
    d.setDate(d.getDate() - 1);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  return dateStr;
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
    const todayStr = getTodayPacificDateString();
    
    for (const event of uniqueEvents) {
      const dateStr = event.startUtc;
      if (!dateStr) continue;
      
      const date = parseDateString(dateStr);
      if (!date) continue;
      
      if (date < todayStr) continue;
      
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

// Electronic music keywords for Partiful category detection
const ELECTRONIC_KEYWORDS = [
  'electronic', 'dj', 'techno', 'house', 'edm', 'rave', 'drum and bass',
  'dubstep', 'trance', 'drum & bass', 'd&b', 'dnb', 'breakbeat', 'ambient',
  'idm', 'electro', 'disco house', 'deep house', 'tech house', 'minimal'
];

function detectPartifulCategory(title, details) {
  const text = `${title || ''} ${details || ''}`.toLowerCase();
  return ELECTRONIC_KEYWORDS.some(kw => text.includes(kw)) ? 'electronic' : 'live';
}

// Parse Partiful events from discover/sf page. Uses __NEXT_DATA__ in the HTML so we
// never depend on a Next.js build ID (which changes on every Partiful deploy).
const PARTIFUL_DISCOVER_URL = 'https://partiful.com/discover/sf';

async function parsePartiful() {
  const todayStr = getTodayPacificDateString();
  const bayAreaCities = ['san francisco', 'sf', 'oakland', 'berkeley', 'san jose', 'bay area', 'emeryville'];

  try {
    const html = await fetchHTML(PARTIFUL_DISCOVER_URL);
    if (!html) {
      console.log('  Partiful: Failed to fetch discover page, skipping.');
      return [];
    }
    const $ = cheerio.load(html);
    const nextDataScript = $('#__NEXT_DATA__').html();
    if (!nextDataScript) {
      console.log('  Partiful: No __NEXT_DATA__ in page, skipping.');
      return [];
    }
    const data = JSON.parse(nextDataScript);
    const pp = data?.props?.pageProps;
    if (!pp) {
      console.log('  Partiful: No pageProps in response, skipping.');
      return [];
    }

    // Collect event objects from feedItems and from each section's items (dedupe by id)
    const seenIds = new Set();
    const rawEvents = [];
    for (const item of pp.feedItems || []) {
      if (item?.event && !seenIds.has(item.event.id)) {
        seenIds.add(item.event.id);
        rawEvents.push(item.event);
      }
    }
    for (const section of pp.sections || []) {
      for (const item of section.items || []) {
        if (item?.event && !seenIds.has(item.event.id)) {
          seenIds.add(item.event.id);
          rawEvents.push(item.event);
        }
      }
    }

    if (rawEvents.length === 0) {
      console.log('  Partiful: No events in response, skipping.');
      return [];
    }

    const events = [];
    for (const e of rawEvents) {
      const title = e.title ?? '';
      const venue = e.locationInfo?.mapsInfo?.name ?? '';
      const addressLines = e.locationInfo?.mapsInfo?.addressLines || e.locationInfo?.displayAddressLines || [];
      const cityStr = (e.locationInfo?.mapsInfo?.approximateLocation || addressLines[addressLines.length - 1] || '').toString().toLowerCase();
      const fullText = `${title} ${venue} ${e.description || ''}`.toLowerCase();

      if (fullText.includes('21+') || fullText.includes('21 and over') || fullText.includes('(21+)') || fullText.includes('21 & up')) continue;
      const inBayArea = bayAreaCities.some(c => cityStr.includes(c) || fullText.includes(c));
      if (!inBayArea) continue;

      const dateStr = e.startDate;
      if (!dateStr) continue;
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) continue;
      // Partiful stores UTC; format date and time in event timezone (America/Los_Angeles for discover/sf).
      // Use formatToParts so we always get YYYY-MM-DD (toLocaleDateString format can vary by env and break filteredDates).
      const tz = e.timezone || 'America/Los_Angeles';
      const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
      const get = (type) => (parts.find(p => p.type === type) || {}).value || '';
      const date = `${get('year')}-${get('month')}-${get('day')}`;
      if (date < todayStr) continue;

      let time = '';
      const timeParts = d.toLocaleTimeString('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true });
      if (timeParts) time = timeParts.replace(/\s/g, ' ').trim();

      const details = (e.description || '').slice(0, 200);
      const link = `https://partiful.com/e/${e.id}`;
      const category = detectPartifulCategory(title, details);
      const city = cityStr || null;

      events.push({
        date,
        time,
        source: 'partiful',
        title: title || 'Event',
        venue,
        city,
        details,
        bands: [],
        link,
        category
      });
    }

    return events;
  } catch (error) {
    console.log('  Partiful scraping skipped:', error.message);
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

  // Fetch Partiful events (graceful if API unavailable)
  console.log('Fetching events from Partiful...');
  let partifulEvents = [];
  try {
    partifulEvents = await parsePartiful();
    console.log(`Parsed ${partifulEvents.length} events from Partiful`);
  } catch (err) {
    console.log('Partiful skipped:', err.message);
  }
  
  // Combine and group by date
  const allEvents = [...events19hz, ...foopeeEvents, ...poshEvents, ...partifulEvents];

  // AI genre classification
  await classifyAllEvents(allEvents);

  // After-midnight rollback: events 12am–5:59am belong to the previous night
  allEvents.forEach(event => {
    event.date = adjustForAfterMidnight(event.date, event.time);
  });

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

  console.log(`\nBuild complete! Generated index.html with ${allEvents.length} events across ${sortedDates.length} dates.`);
}

// Known club venues: always show as Clubs (edm) regardless of cache/AI
const KNOWN_CLUB_VENUES = ['dna lounge', 'public works', 'monarch', 'the midway', '1015 folsom'];
function isKnownClub(venue) {
  if (!venue || typeof venue !== 'string') return false;
  const v = venue.trim().toLowerCase();
  return KNOWN_CLUB_VENUES.some(club => v === club || v.includes(club));
}

// Return comma-separated genre tags for an event (multi-genre support)
function getGenres(event) {
  // Known clubs always = Clubs (edm) so DNA Lounge etc. are correct even when cache/AI is wrong
  if (isKnownClub(event.venue)) return 'edm';
  // If AI classified it, use that
  if (event.aiGenres) return event.aiGenres;
  // Fallback: source-based (only hits if API key missing or classification failed)
  if (event.source === '19hz') return 'edm,raves';
  if (event.source === 'foopee') return 'punk,rock';
  const cat = (event.category || '').toLowerCase();
  if (cat === 'electronic') return 'edm,raves';
  return 'misc';
}

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
  page.setDefaultNavigationTimeout(60000);
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

    await page.setContent(html, { waitUntil: 'load', timeout: 60000 });
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

function generateSlug(event) {
  const name = event.title.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 50);
  return `${name}-${event.date}`;
}

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
    const redirect = (event.link || `/?event=${slug}`).replace(/\\/g, '\\\\').replace(/"/g, '\\"');

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

// Generate HTML output
function generateHTML(eventsByDate, sortedDates) {
  const todayStr = getTodayPacificDateString();
  let html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Bay Moves – Bay Area Music Events, Raves, Shows & Nightlife</title>
    <meta name="description" content="Find every rave, club night, punk show, and indie concert in San Francisco, Oakland, Berkeley, and San Jose. Updated daily. All ages welcome.">
    <link rel="canonical" href="https://baymoves.now/" />

    <!-- Open Graph -->
    <meta property="og:type" content="website" />
    <meta property="og:title" content="Bay Moves – Bay Area Music Events & Nightlife" />
    <meta property="og:description" content="Every rave, club night, punk show, and indie concert across the Bay Area. Updated daily." />
    <meta property="og:url" content="https://baymoves.now/" />
    <meta property="og:site_name" content="Bay Moves" />
    <meta property="og:image" content="https://baymoves.now/og-image.png" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />

    <!-- Twitter Card -->
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="Bay Moves – Bay Area Music Events & Nightlife" />
    <meta name="twitter:description" content="Every rave, club night, punk show, and indie concert across the Bay Area. Updated daily." />
    <meta name="twitter:image" content="https://baymoves.now/og-image.png" />

    <meta name="robots" content="index, follow" />
    <meta name="theme-color" content="#0A0A0A" />
    <link rel="icon" type="image/png" href="baymovesLogo1.png" />

    <!-- Fonts -->
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

        .primary-filters {
            margin-bottom: 16px;
        }

        /* Genre chips (secondary filter) */
        .genre-filters {
            display: flex;
            align-items: center;
            gap: 10px;
            margin-bottom: 40px;
            flex-wrap: wrap;
            animation: slideDown 0.8s cubic-bezier(0.16, 1, 0.3, 1) 0.25s backwards;
        }

        .genre-label {
            font-family: 'Azeret Mono', monospace;
            font-size: 0.75rem;
            letter-spacing: 0.15em;
            color: var(--concrete);
            text-transform: uppercase;
        }

        .genre-chip {
            font-family: 'Azeret Mono', monospace;
            background: transparent;
            border: 1px solid var(--concrete);
            color: var(--white);
            padding: 6px 14px;
            cursor: pointer;
            text-transform: uppercase;
            font-size: 0.75rem;
            letter-spacing: 0.08em;
            transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
            position: relative;
            overflow: hidden;
        }

        .genre-chip::before {
            content: '';
            position: absolute;
            top: 0;
            left: -100%;
            width: 100%;
            height: 100%;
            background: var(--electric-blue);
            transition: left 0.3s cubic-bezier(0.16, 1, 0.3, 1);
            z-index: -1;
        }

        .genre-chip:hover::before,
        .genre-chip.active::before {
            left: 0;
        }

        .genre-chip:hover,
        .genre-chip.active {
            color: var(--deep-black);
            border-color: var(--electric-blue);
        }

        /* Events grid */
        .no-events,
        .no-events-filtered {
            grid-column: 1 / -1;
            text-align: center;
            padding: 48px 24px;
            color: var(--electric-blue);
            font-size: 1.1rem;
            border: 1px dashed var(--concrete);
            border-radius: 8px;
        }

        /* ═══════════════════════════════════════════════
           EVENT CARDS — "The Flyer" design
           ═══════════════════════════════════════════════ */

        .event-card-link {
            text-decoration: none;
            color: inherit;
            display: block;
        }

        /* Genre accent colors — used for card borders, badges, hover glows */
        .event-card[data-primary-genre="edm"]   { --genre-accent: #00f0ff; }
        .event-card[data-primary-genre="raves"] { --genre-accent: #e040fb; }
        .event-card[data-primary-genre="punk"]  { --genre-accent: #ff2d2d; }
        .event-card[data-primary-genre="rock"]  { --genre-accent: #ff8a00; }
        .event-card[data-primary-genre="misc"]  { --genre-accent: #ccff00; }
        .event-card { --genre-accent: #ccff00; }

        .event-card {
            position: relative;
            background: #08080a;
            overflow: hidden;
            box-shadow: 0 0 0 1px #1a1a1a;
            transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1),
                        box-shadow 0.3s ease;
            cursor: pointer;
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
            padding-right: 60px;
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
    <script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "WebSite",
  "name": "Bay Moves",
  "url": "https://baymoves.now/",
  "description": "Bay Area music event aggregator covering raves, club nights, punk, indie, and electronic shows in San Francisco, Oakland, Berkeley, and San Jose.",
  "potentialAction": {
    "@type": "SearchAction",
    "target": "https://baymoves.now/?q={search_term_string}",
    "query-input": "required name=search_term_string"
  }
}
    </script>
</head>
<body data-today="${todayStr}">
    <div class="container">
        <header>
            <h1>BAYMOVES.NOW</h1>
            <div class="subtitle">Bay Area // All Ages // Live Aggregation</div>
        </header>

        <!-- Primary time filters -->
        <div class="filters primary-filters">
            <button class="filter-btn" data-time-filter="tonight">Tonight</button>
            <button class="filter-btn" data-time-filter="weekend">This Weekend</button>
            <button class="filter-btn active" data-time-filter="all">All Events</button>
        </div>

        <!-- Secondary genre filters -->
        <div class="genre-filters">
            <span class="genre-label">FILTER BY:</span>
            <button class="genre-chip active" data-genre-filter="all">All</button>
            <button class="genre-chip" data-genre-filter="edm">Clubs</button>
            <button class="genre-chip" data-genre-filter="punk">Punk</button>
            <button class="genre-chip" data-genre-filter="rock">Rock</button>
            <button class="genre-chip" data-genre-filter="raves">Raves</button>
            <button class="genre-chip" data-genre-filter="misc">Misc</button>
        </div>

        <div class="events-grid" id="eventsGrid">
            <div class="no-events-filtered" id="noEventsFiltered" style="display: none;">No events found</div>
            <!--EVENT_CARDS_PLACEHOLDER-->
        </div>
    </div>

    <div class="live-indicator">
        <span class="live-dot"></span>
        LIVE DATA
    </div>

    <script>
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
        document.addEventListener('DOMContentLoaded', function() {
            const timeFilterBtns = document.querySelectorAll('.filter-btn[data-time-filter]');
            const genreChipBtns = document.querySelectorAll('.genre-chip');
            const eventCards = document.querySelectorAll('.event-card');
            const todayStr = document.body.dataset.today || '';

            function getThisWeekendDateSet(todayStr) {
                if (!todayStr) return {};
                var d = new Date(todayStr + 'T00:00:00');
                var day = d.getDay();
                var fridayOffset;
                if (day <= 4) fridayOffset = 5 - day;
                else if (day === 5) fridayOffset = 0;
                else if (day === 6) fridayOffset = -1;
                else fridayOffset = -2;
                var friday = new Date(d);
                friday.setDate(friday.getDate() + fridayOffset);
                var saturday = new Date(friday);
                saturday.setDate(saturday.getDate() + 1);
                var sunday = new Date(friday);
                sunday.setDate(sunday.getDate() + 2);
                function toStr(date) {
                    var y = date.getFullYear(), m = date.getMonth() + 1, dayNum = date.getDate();
                    return y + '-' + (m < 10 ? '0' + m : m) + '-' + (dayNum < 10 ? '0' + dayNum : dayNum);
                }
                var set = {};
                var friStr = toStr(friday), satStr = toStr(saturday), sunStr = toStr(sunday);
                if (friStr >= todayStr) set[friStr] = true;
                if (satStr >= todayStr) set[satStr] = true;
                if (sunStr >= todayStr) set[sunStr] = true;
                return set;
            }

            var thisWeekendDates = getThisWeekendDateSet(todayStr);

            function matchesTime(card, timeFilter) {
                if (timeFilter === 'all') return true;
                var dateStr = card.dataset.eventDate || '';
                if (timeFilter === 'tonight') return dateStr === todayStr;
                if (timeFilter === 'weekend') return thisWeekendDates[dateStr] === true;
                return true;
            }

            function matchesGenre(card, genreFilter) {
                if (genreFilter === 'all') return true;
                var genres = (card.dataset.genres || '').split(',').map(function(g) { return g.trim().toLowerCase(); });
                return genres.indexOf(genreFilter.toLowerCase()) !== -1;
            }

            function applyFilters() {
                var timeFilter = document.querySelector('.filter-btn.active[data-time-filter]');
                var genreFilter = document.querySelector('.genre-chip.active');
                var timeVal = timeFilter ? timeFilter.dataset.timeFilter : 'all';
                var genreVal = genreFilter ? genreFilter.dataset.genreFilter : 'all';

                var visibleCount = 0;
                eventCards.forEach(function(card) {
                    var show = matchesTime(card, timeVal) && matchesGenre(card, genreVal);
                    if (show) visibleCount++;
                    var el = card.closest('.event-card-link') || card;
                    el.style.display = show ? 'block' : 'none';
                    if (show) {
                        card.style.animation = 'none';
                        card.offsetHeight;
                        card.style.animation = '';
                    }
                });

                var noEventsEl = document.getElementById('noEventsFiltered');
                if (noEventsEl) {
                    noEventsEl.style.display = (eventCards.length > 0 && visibleCount === 0) ? 'block' : 'none';
                }
            }

            timeFilterBtns.forEach(function(btn) {
                btn.addEventListener('click', function() {
                    timeFilterBtns.forEach(function(b) { b.classList.remove('active'); });
                    btn.classList.add('active');
                    applyFilters();
                });
            });

            genreChipBtns.forEach(function(btn) {
                btn.addEventListener('click', function() {
                    genreChipBtns.forEach(function(b) { b.classList.remove('active'); });
                    btn.classList.add('active');
                    applyFilters();
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

  // Generate event cards from scraped data (use Pacific date so Vercel UTC build matches local)
  const filteredDates = sortedDates.filter(date => {
    return date >= todayStr;  // Show today and FUTURE dates
  });

  let cardsHtml = '';
  if (filteredDates.length === 0) {
    cardsHtml = '            <div class="no-events">No events to display</div>\n';
  } else {
    filteredDates.forEach(date => {
      const dateObj = new Date(date + 'T00:00:00');
      const dayNum = String(dateObj.getDate()).padStart(2, '0');
      const dayAbbr = dateObj.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase();
      
      eventsByDate[date].forEach(event => {
        const genres = getGenres(event);
        const primaryGenre = genres.split(',')[0].trim().toLowerCase() || 'misc';
        const venueDisplay = event.city ? `${event.venue}, ${event.city}` : event.venue;
        const price = extractPrice(event);
        const isFree = price === 'FREE';

        const slug = generateSlug(event);
        const shareUrl = `https://baymoves.com/e/${slug}`;
        const shareTitleJs = (event.title || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
        const shareOnclick = `event.preventDefault();event.stopPropagation();shareEvent('${shareUrl}','${shareTitleJs}')`
          .replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const shareBtn = `<button class="share-btn" onclick="${shareOnclick}" title="Share">` +
          `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>` +
          `</button>`;

        const cardContent =
          // Genre color band — top edge
          `                <div class="card-genre-bar"></div>\n` +
          // Price badge — top right corner, skip if no price
          (price
            ? `                <div class="card-price${isFree ? ' card-price--free' : ''}">${escapeHtml(price)}</div>\n`
            : '') +
          // Card body
          `                <div class="card-body">\n` +
          `                  <div class="card-dateline">\n` +
          `                    <span class="card-day-date">${dayAbbr} ${dayNum}</span>\n` +
          (event.time
            ? `                    <span class="card-time">${escapeHtml(event.time)}</span>\n`
            : '') +
          `                  </div>\n` +
          `                  <h3 class="card-title">${escapeHtml(event.title)}</h3>\n` +
          `                  <div class="card-venue-row">\n` +
          `                    <span class="card-genre-dot"></span>\n` +
          (event.venue
            ? `                    <span class="card-venue">${escapeHtml(venueDisplay)}</span>\n`
            : '') +
          `                  </div>\n` +
          `                  ${shareBtn}\n` +
          `                </div>\n` +
          // Bottom accent line (animates on hover)
          `                <div class="card-hover-line"></div>\n`;

        const openWrap = event.link
          ? `            <a href="${escapeHtml(event.link)}" target="_blank" rel="noopener noreferrer" class="event-card-link">\n`
          : '';
        const closeWrap = event.link ? `            </a>\n` : '';

        cardsHtml += openWrap +
          `            <div class="event-card" data-genres="${escapeHtml(genres)}" data-primary-genre="${primaryGenre}" data-event-date="${date}">\n` +
          cardContent +
          `            </div>\n` +
          closeWrap + '\n';
      });
    });
  }
  
  // Replace placeholder with generated cards
  html = html.replace('<!--EVENT_CARDS_PLACEHOLDER-->', cardsHtml);

  fs.writeFileSync('index.html', html, 'utf8');

  // SEO: robots.txt and sitemap.xml
  const robotsTxt = `User-agent: *
Allow: /
Sitemap: https://baymoves.now/sitemap.xml
`;
  fs.writeFileSync('robots.txt', robotsTxt, 'utf8');

  const sitemapXml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://baymoves.now/</loc>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
  </url>
</urlset>
`;
  fs.writeFileSync('sitemap.xml', sitemapXml, 'utf8');
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
