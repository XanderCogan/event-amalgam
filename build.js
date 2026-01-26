const fetch = require('node-fetch');
const cheerio = require('cheerio');
const fs = require('fs');

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
  $('ul > li').each((i, item) => {
    const $item = $(item);
    const text = $item.text().trim();
    
    // Check if this is a date header (e.g., "Tue Jan 20")
    // Date headers are typically direct children with no links
    const dateMatch = text.match(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+(\w+)\s+(\d{1,2})/i);
    if (dateMatch && $item.find('a').length === 0) {
      // This is a date header - extract and store the date
      const [, dayName, monthName, day] = dateMatch;
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
      return;
    }
    
    // Check if this item contains event data (has links)
    const links = $item.find('a');
    if (links.length === 0) return;
    
    // Get all text content - this is a continuous string format
    // Example: "Black Cat, S.F. Jezebel: Rewritten 21+ $30 6pm/7pm til 9pm"
    const fullText = $item.text().trim();
    
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
    
    // Extract bands (subsequent links)
    const bands = [];
    links.slice(1).each((j, link) => {
      const band = $(link).text().trim();
      if (band) bands.push(band);
    });
    
    // Extract the remaining text after all links (price, age, time)
    // Clone the item and remove all links to get just the text parts
    const $clone = $item.clone();
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
  
  return events;
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
  
  // Combine and group by date
  const allEvents = [...events19hz, ...foopeeEvents];
  
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
    <title>SF Event Aggregator</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
            line-height: 1.6;
            color: #333;
            background-color: #f5f5f5;
            padding: 20px;
        }
        
        .container {
            max-width: 1200px;
            margin: 0 auto;
            background: white;
            padding: 30px;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        
        h1 {
            color: #2c3e50;
            margin-bottom: 30px;
            border-bottom: 3px solid #3498db;
            padding-bottom: 10px;
        }
        
        .date-section {
            margin-bottom: 40px;
        }
        
        .date-header {
            font-size: 1.5em;
            font-weight: bold;
            color: #2c3e50;
            margin-bottom: 15px;
            padding: 10px;
            background: #ecf0f1;
            border-left: 4px solid #3498db;
        }
        
        .event {
            margin-bottom: 15px;
            padding: 15px;
            background: #fafafa;
            border-left: 3px solid #95a5a6;
            transition: all 0.2s;
        }
        
        .event:hover {
            background: #f0f0f0;
            border-left-color: #3498db;
        }
        
        .event-header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            margin-bottom: 8px;
        }
        
        .event-title {
            font-weight: bold;
            font-size: 1.1em;
            color: #2c3e50;
        }
        
        .event-venue {
            color: #7f8c8d;
            margin-top: 4px;
        }
        
        .event-time {
            color: #3498db;
            font-weight: 500;
            white-space: nowrap;
            margin-left: 15px;
        }
        
        .event-details {
            color: #555;
            font-size: 0.95em;
            margin-top: 8px;
        }
        
        .event-bands {
            color: #7f8c8d;
            font-size: 0.9em;
            margin-top: 5px;
            font-style: italic;
        }
        
        .event-source {
            display: inline-block;
            padding: 2px 8px;
            border-radius: 3px;
            font-size: 0.75em;
            font-weight: bold;
            margin-top: 8px;
            text-transform: uppercase;
        }
        
        .source-19hz {
            background: #e8f5e9;
            color: #2e7d32;
        }
        
        .source-foopee {
            background: #fff3e0;
            color: #e65100;
        }
        
        .no-events {
            text-align: center;
            color: #95a5a6;
            padding: 40px;
            font-style: italic;
        }
        
        @media (max-width: 768px) {
            .event-header {
                flex-direction: column;
            }
            
            .event-time {
                margin-left: 0;
                margin-top: 5px;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>SF Event Aggregator</h1>
`;

  if (sortedDates.length === 0) {
    html += `        <div class="no-events">No events found.</div>\n`;
  } else {
    sortedDates.forEach(date => {
      const dateObj = new Date(date + 'T00:00:00');
      const dateStr = dateObj.toLocaleDateString('en-US', { 
        weekday: 'long', 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric' 
      });
      
      html += `        <div class="date-section">\n`;
      html += `            <div class="date-header">${dateStr}</div>\n`;
      
      eventsByDate[date].forEach(event => {
        html += `            <div class="event">\n`;
        html += `                <div class="event-header">\n`;
        html += `                    <div>\n`;
        html += `                        <div class="event-title">${escapeHtml(event.title)}</div>\n`;
        if (event.venue) {
          const venueDisplay = event.city ? `${event.venue}, ${event.city}` : event.venue;
          html += `                        <div class="event-venue">@ ${escapeHtml(venueDisplay)}</div>\n`;
        }
        html += `                    </div>\n`;
        if (event.time) {
          html += `                    <div class="event-time">${escapeHtml(event.time)}</div>\n`;
        }
        html += `                </div>\n`;
        
        if (event.bands && event.bands.length > 1) {
          html += `                <div class="event-bands">${escapeHtml(event.bands.join(', '))}</div>\n`;
        }
        
        if (event.details) {
          html += `                <div class="event-details">${escapeHtml(event.details)}</div>\n`;
        }
        
        html += `                <span class="event-source source-${event.source}">${event.source}</span>\n`;
        html += `            </div>\n`;
      });
      
      html += `        </div>\n`;
    });
  }
  
  html += `    </div>
</body>
</html>`;
  
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
