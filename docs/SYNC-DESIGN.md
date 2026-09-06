# Source-of-truth and mirror: design note

**Status:** pull model, since 2026-09-06. No workflow, no token, no push.

## The model

This repo (`benskamps/microtubule-resonance-sim`) is the single source of
truth for the simulator. The live page at
<https://www.brokenbranch.dev/labs/microtubule/> is a **pull mirror**: the
website repo (`benskamps/brokenbranchdevwebsite`) runs
`scripts/mirror-pull.mjs` daily (and on demand), checks out this repo's
`main`, and copies these ten files verbatim into `labs/microtubule/`:

```
index.html   simulator.html   whitepaper.html
landing.css  style.css        whitepaper.css
sim.js       physics.js       README.md
assets/og.png
```

Nothing is rewritten in transit. Whatever these files contain on `main` is
what the site serves the next morning.

## What that means for edits here

- **The production `<head>` lives in this repo.** Canonical URLs
  (`https://www.brokenbranch.dev/labs/microtubule/...`), Open Graph and
  Twitter cards, `og:image` (`assets/og.png`), `theme-color`, and the JSON-LD
  blocks (BreadcrumbList, SoftwareApplication, TechArticle) are all part of
  the source HTML. Edit them here; there is no site-side splice.
- **The site serves an enforced CSP:** `script-src 'self'`, no inline
  scripts and no inline event handlers (`onclick=`, `onmouseover=`);
  `style-src 'self' 'unsafe-inline'`; `font-src 'self'`. Keep all behaviour
  in `sim.js` / `physics.js` and wire events with `addEventListener` or
  delegated `data-action` attributes. A page that regresses on this will
  load on GitHub Pages and silently break on the site.
- **The Vercel analytics tags** at the bottom of each page
  (`/js/va-shim.js`, `/_vercel/insights/script.js`) are site paths. They 404
  harmlessly when the repo is opened standalone and are what let the site
  count visits; leave them in.
- **Numbers on the pages are receipts, not prose.** Every Monte Carlo runs
  from a fixed seed (`DEFAULT_SEED = 20260906`, mulberry32, in
  `physics.js`). `node scripts/recompute-figures.mjs` prints every figure the
  pages quote; its output is committed at `docs/figures-20260906.txt`. If you
  change an engine, re-run it, update the pages, and commit the new receipt.

## What was retired

The previous push model (`.github/workflows/mirror-to-prod.yml`,
`scripts/sync-to-prod.{sh,ps1}`, `scripts/splice_head.py`) copied files
*into* the website repo on every push to `main`, authenticated with a
`SITE_SYNC_TOKEN` PAT. It targeted the retired `lab/microtubule/` path, the
token expired, and the mirror silently froze, which is how the site's copy
got ahead of this repo. Those files are deleted; the site-side pull needs no
secret because this repo is public.

## Related

- `windowsill-lab` and `leanto` are pulled by the same `mirror-pull.mjs`.
  The leanto page gets a handful of asserted site-side deltas; this project
  needs none, because the source already carries the site's head, `<main>`
  landmark, and analytics include.
