<#
.SYNOPSIS
  One-shot dev -> prod sync for the Microtubule Resonance Simulator.

.DESCRIPTION
  Copies the simulator's runtime files from THIS source repo
  (coherence-lab/sims/microtubule-resonance, repo benskamps/microtubule-resonance-sim)
  into the live website tree (brokenbranchdevwebsite/lab/microtubule).

  The CI workflow (.github/workflows/mirror-to-prod.yml) does this automatically
  on push to main. This script is the manual / offline equivalent and the
  break-glass tool when you want to preview or force a sync by hand.

  HEAD PRESERVATION
  -----------------
  The website pages carry a prod SEO <head> (canonical, OG, Twitter, JSON-LD,
  favicon). As of 2026-06-18 that head was folded back INTO this repo's HTML, so
  source is now authoritative for the head -- a verbatim copy is safe.

  As a safety net, -ReinjectHead writes the HTML files by splicing PROD's
  current <head> onto SOURCE's <body> (scripts/splice_head.py), so even if a
  source edit stripped the SEO head, prod's head survives.

  SAFETY: dry-run by default. Nothing is written until -Apply. This script only
  touches the local prod working tree; it never commits or pushes. The website
  repo is a live production site -- review, commit, and deploy through it.

.PARAMETER Apply
  Actually copy. Without it, prints what WOULD change (dry run).

.PARAMETER ReinjectHead
  Write HTML by splicing prod's current head onto source's body (safety net).

.PARAMETER ProdRoot
  Override the destination path (defaults to the sibling website repo).

.EXAMPLE
  pwsh scripts/sync-to-prod.ps1                      # dry run
  pwsh scripts/sync-to-prod.ps1 -Apply              # copy for real
  pwsh scripts/sync-to-prod.ps1 -Apply -ReinjectHead   # keep prod head via splice
#>
[CmdletBinding()]
param(
  [switch]$Apply,
  [switch]$ReinjectHead,
  [string]$ProdRoot = "$PSScriptRoot\..\..\..\..\brokenbranchdevwebsite\lab\microtubule"
)

$ErrorActionPreference = 'Stop'
$SrcRoot = (Resolve-Path "$PSScriptRoot\..").Path

if (-not (Test-Path $ProdRoot)) {
  Write-Error "Prod tree not found: $ProdRoot`nPass -ProdRoot <path> to the website's lab/microtubule directory."
  exit 1
}
$ProdRoot = (Resolve-Path $ProdRoot).Path

$HtmlFiles  = @('index.html', 'simulator.html', 'whitepaper.html')
$AssetFiles = @('landing.css', 'style.css', 'whitepaper.css', 'sim.js', 'physics.js')

function Compare-File($rel) {
  $s = Join-Path $SrcRoot $rel
  $d = Join-Path $ProdRoot $rel
  if (-not (Test-Path $s)) { return 'MISSING-SRC' }
  if (-not (Test-Path $d)) { return 'NEW' }
  $sc = (Get-Content -Raw $s) -replace "`r`n","`n"
  $dc = (Get-Content -Raw $d) -replace "`r`n","`n"
  if ($sc -eq $dc) { return 'SAME' } else { return 'DIFF' }
}

Write-Host "Microtubule dev -> prod sync" -ForegroundColor Cyan
Write-Host "  source: $SrcRoot"
Write-Host "  prod  : $ProdRoot"
Write-Host ("  mode  : {0}{1}" -f ($(if($Apply){'APPLY'}else{'DRY-RUN'})), $(if($ReinjectHead){' +ReinjectHead'}else{''}))
Write-Host ""

$copied = 0

Write-Host "HTML pages:" -ForegroundColor Yellow
foreach ($f in $HtmlFiles) {
  $st = Compare-File $f
  switch ($st) {
    'SAME'        { Write-Host "  [same] $f" }
    'NEW'         { Write-Host "  [new ] $f -> will create" -ForegroundColor Green }
    'DIFF'        { Write-Host "  [diff] $f -> will update" -ForegroundColor Green }
    'MISSING-SRC' { Write-Host "  [!!  ] $f missing in source -- skipping" -ForegroundColor Red }
  }
  if ($Apply -and $st -in 'NEW','DIFF') {
    $src = Join-Path $SrcRoot $f
    $dst = Join-Path $ProdRoot $f
    if ($ReinjectHead -and (Test-Path $dst)) {
      $tmp = "$dst.tmp"
      python (Join-Path $SrcRoot 'scripts/splice_head.py') $src $dst | Set-Content -NoNewline -Encoding utf8 $tmp
      Move-Item -Force $tmp $dst
    } else {
      Copy-Item $src $dst -Force
    }
    $copied++
  }
}

Write-Host ""
Write-Host "CSS + JS payload:" -ForegroundColor Yellow
foreach ($f in $AssetFiles) {
  $st = Compare-File $f
  switch ($st) {
    'SAME'        { Write-Host "  [same] $f" }
    'NEW'         { Write-Host "  [new ] $f -> will create" -ForegroundColor Green }
    'DIFF'        { Write-Host "  [diff] $f -> will update" -ForegroundColor Green }
    'MISSING-SRC' { Write-Host "  [!!  ] $f missing in source -- skipping" -ForegroundColor Red }
  }
  if ($Apply -and $st -in 'NEW','DIFF') {
    Copy-Item (Join-Path $SrcRoot $f) (Join-Path $ProdRoot $f) -Force
    $copied++
  }
}

Write-Host ""
if ($Apply) {
  Write-Host "Done. $copied file(s) written to prod working tree." -ForegroundColor Green
  Write-Host "NEXT: review with 'git status' / 'git diff' IN THE WEBSITE REPO, then commit + deploy there."
} else {
  Write-Host "Dry run -- nothing written. Re-run with -Apply to copy." -ForegroundColor Cyan
}
