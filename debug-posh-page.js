// See what's actually on the posh.vip SF page
const puppeteer = require('puppeteer');
const fs = require('fs');

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function debugPoshPage() {
  console.log('🔍 Debugging posh.vip SF page...\n');
  
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080 });
  
  const url = 'https://posh.vip/explore?location=%7B%22type%22%3A%22custom%22%2C%22location%22%3A%22San+Francisco%2C+CA%2C+USA%22%2C%22long%22%3A-122.4194155%2C%22lat%22%3A37.7749295%7D';
  
  console.log('Loading page...');
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
  
  // Try different wait times
  for (let waitTime of [2000, 5000, 8000]) {
    console.log(`\n━━━ After ${waitTime/1000}s wait ━━━`);
    await wait(waitTime - (waitTime === 2000 ? 0 : 2000)); // Incremental waits
    
    const info = await page.evaluate(() => {
      return {
        title: document.title,
        bodyLength: document.body.innerHTML.length,
        bodyText: document.body.innerText.slice(0, 500),
        links: {
          total: document.querySelectorAll('a').length,
          eventLinks: document.querySelectorAll('a[href*="/e/"]').length,
          hrefSamples: Array.from(document.querySelectorAll('a')).slice(0, 10).map(a => a.href)
        },
        elements: {
          articles: document.querySelectorAll('article').length,
          divs: document.querySelectorAll('div').length,
          hasEvents: document.body.innerHTML.includes('event'),
          hasCard: document.body.innerHTML.includes('card')
        }
      };
    });
    
    console.log(`Title: ${info.title}`);
    console.log(`Body length: ${info.bodyLength} chars`);
    console.log(`Links: ${info.links.total} total, ${info.links.eventLinks} event links (/e/)`);
    console.log(`Articles: ${info.elements.articles}, Divs: ${info.elements.divs}`);
    console.log(`Has "event" in HTML: ${info.elements.hasEvents}`);
    console.log(`Has "card" in HTML: ${info.elements.hasCard}`);
    
    console.log('\nFirst 10 links on page:');
    info.links.hrefSamples.forEach((href, i) => {
      console.log(`  ${i+1}. ${href}`);
    });
    
    console.log('\nBody text preview:');
    console.log(info.bodyText.slice(0, 200));
  }
  
  // Save the full HTML
  console.log('\n📄 Saving full page HTML...');
  const html = await page.content();
  fs.writeFileSync('posh-sf-page.html', html);
  console.log('   Saved to: posh-sf-page.html');
  
  // Try scrolling (in case of lazy loading)
  console.log('\n📜 Trying to scroll page...');
  await page.evaluate(() => {
    window.scrollTo(0, document.body.scrollHeight);
  });
  await wait(3000);
  
  const afterScroll = await page.evaluate(() => {
    return {
      eventLinks: document.querySelectorAll('a[href*="/e/"]').length,
      bodyLength: document.body.innerHTML.length
    };
  });
  
  console.log(`   After scroll: ${afterScroll.eventLinks} event links, ${afterScroll.bodyLength} chars`);
  
  await page.screenshot({ path: 'posh-sf-final.png', fullPage: true });
  console.log('   Screenshot: posh-sf-final.png');
  
  await browser.close();
  
  console.log('\n✅ Debug complete!');
  console.log('\nNext steps:');
  console.log('1. Open posh-sf-page.html in browser to see the page');
  console.log('2. Search for event data in the HTML');
  console.log('3. Look for the correct selectors');
}

debugPoshPage().catch(console.error);