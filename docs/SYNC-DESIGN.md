# Dev -> prod mirror: design note

**Status:** shipped 2026-06-18. CI mirror + manual sync script + head guard.

## The problem

This repo (`benskamps/microtubule-resonance-sim`, working tree at
`coherence-lab/sims/microtubule-resonance`) is the dev home of the simulator.
The live page is served from a *different* repo,
`benskamps/brokenbranchdevwebsite`, at `lab/microtubule/`. There was **no sync
mechanism** between them, so the trees drifted: edits landed on one side and not
the other.

By 2026-06-18 the divergence was, exactly:

- **All three HTML pages** (`index.html`, `simulator.html`, `whitepaper.html`)
  had a prod-injected `<head>`: `<link rel="canonical">`, Open Graph, Twitter
  cards, two JSON-LD blocks (BreadcrumbList + SoftwareApplication), and the site
  favicon. None of that was in source.
- `index.html` had a prod-only `← the lab` back-link `<a>` at the top of `<body>`.
- `simulator.html` had prod-only `type="button"` attributes on ~30 buttons (an
  accessibility hand-edit).
- The CSS/JS payload (`landing.css`, `style.css`, `whitepaper.css`, `sim.js`,
  `physics.js`) was content-identical (CRLF-only deltas).

So the prod tree was a strict superset of source: prod head + prod nav + prod
a11y on top of the same body and payload.

## The fix (windowsill model)

The gold-standard mirror in the estate is `windowsill-lab`'s `mirror-page.yml`:
a verbatim `cp` of one file into the website repo, gated by a
`SITE_SYNC_TOKEN` PAT. It can be verbatim because **source already owns the SEO
head** -- there is nothing prod-only to preserve.

We brought microtubule to the same invariant:

1. **Folded every prod-only edit back into source** (head + nav + a11y), making
   this repo authoritative for the *entire* page, head included. After this,
   source == prod byte-for-byte (modulo line endings).
2. **CI mirror** (`.github/workflows/mirror-to-prod.yml`): on push to `main`
   that touches any runtime file, check out the website repo with
   `SITE_SYNC_TOKEN`, copy the eight runtime files into `lab/microtubule/`, and
   commit+push only if something changed. Same shape as windowsill, extended to
   multiple files.
3. **Head guard** (defense in depth): before mirroring, CI greps each HTML page
   for `rel="canonical"` and `application/ld+json`. If a future source edit
   strips the SEO head, the mirror **fails loudly** instead of pushing a
   head-less page to prod.

## Head-splice safety net

Because making source authoritative shifts the responsibility for the head onto
whoever edits source, there is a break-glass tool for the day someone forgets:

- `scripts/splice_head.py` -- writes `prod<head>` + `source<body>`, so prod's
  injected SEO head survives even if source lost it. `--check` mode is a pure
  drift detector (exit 1 if a sync would change prod).
- `scripts/sync-to-prod.{sh,ps1}` -- manual dry-run-by-default sync (mirrors the
  CI copy locally). Pass `--reinject-head` / `-ReinjectHead` to route HTML
  through the splicer instead of a verbatim copy.

These never commit or push; they only touch the local prod working tree for
review.

## Why not a pure splice in CI?

A pure `prod-head + source-body` splice was the first design, but it would have
**dropped prod's body-level hand-edits** (the `← the lab` nav, the `type=button`
a11y attributes) on every run, because those live in prod's body, not source's.
Folding everything into source once, then mirroring verbatim, is lossless and
matches the proven windowsill pattern. The splice logic is retained only as the
reinject safety net above.

## Related

- `wormhole` already has its own `scripts/sync-to-prod.{sh,ps1}` (JS payload +
  gated HTML). It is **already covered**; this note does not touch it.
- Future sims should adopt this same shape: source owns the head, CI mirrors
  verbatim, a head guard prevents accidental SEO loss.
