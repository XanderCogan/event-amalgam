# CURSOR-PROMPT.md
# Copy-paste the prompt below into Cursor. Reference @OG-IMAGE-SPEC.md.

```
Read @OG-IMAGE-SPEC.md completely before writing any code.

This adds an iMessage/social share preview system to Bay Moves. It ONLY
affects what bots see when a link is shared — the visible website stays
100% identical. No changes to existing card designs, CSS, layout, filters,
or JavaScript.

Do every step in @OG-IMAGE-SPEC.md in order:

1. Add generateSlug() helper to @build.js

2. Add sitewide OG meta tags to the <head> in generateHTML() — right after
   the viewport meta tag. These are invisible to users.

3. Add generateEventPages() to @build.js — creates /e/{slug}.html redirect
   files with per-event OG meta tags. Users never see these pages.

4. Create og-template.html in the project root using the EXACT HTML from
   the spec. This is the Puppeteer screenshot template — never served to users.
   It must match the V9 design spec exactly:
   - Background: #08080a (single dark surface, no split panels)
   - 496px date watermark at right:60px top:140px opacity:0.35
   - 64px rotated day at right:80px opacity:0.5
   - Genre color atmospheric gradient washes (3 layered gradients)
   - 5px genre top band, 3px bottom accent line
   - Angled clipPath price tag top-right
   - Title 66-120px depending on length
   - GENRE TAG directly below title: 70% of title font size, genre-colored,
     with 2px border at {color}55 and background at {color}10, padding 4px 14px,
     letter-spacing 0.15em. Uses genre labels: EDM, RAVE, PUNK, ROCK, MISC.
   - Venue with 7px genre dot
   - Scanlines at 0.012 opacity
   - Bebas Neue font (loaded via Google Fonts in the template)

5. Add GENRE_COLORS map (must include label field: EDM, RAVE, PUNK, ROCK, MISC),
   getPrimaryGenre(), and generateOGImages() to @build.js using the exact code
   from the spec. The genreTagSize must be computed as Math.round(titleSize * 0.7).
   The template replace must include {{GENRE_TAG_SIZE}} and {{GENRE_LABEL}}.

6. Add the share button to each event card — it goes inside .event-body,
   after the venue div. Add the .share-btn CSS and shareEvent() JS function.
   On mobile it uses navigator.share() (native share sheet).
   On desktop it copies the URL and shows "COPIED" feedback.
   The button must call event.preventDefault() and event.stopPropagation()
   so it doesn't trigger the card's link.

7. Wire it all into build() — after generateHTML(), call generateEventPages()
   then await generateOGImages(). Flatten events from eventsByDate with
   computed dayNum and dayAbbr.

CRITICAL RULES:
- Do NOT change any existing styles, card designs, or site functionality
- The og-template.html design must match the spec EXACTLY — same pixel
  values, same colors, same opacities. Do not "improve" or "clean up" the design.
- Bebas Neue MUST load in og-template.html via Google Fonts @import
- The genre tag MUST be 70% of the title size, not a fixed small size
- The share button is the ONLY visible addition to the site
- All OG image generation happens at build time via Puppeteer, not runtime
```
