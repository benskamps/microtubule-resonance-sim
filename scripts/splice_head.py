#!/usr/bin/env python3
"""Head-preserving HTML splice for the dev -> prod mirror.

The website tree (brokenbranchdevwebsite/lab/microtubule/) carries a
prod-INJECTED <head>: canonical URL, Open Graph / Twitter cards, JSON-LD
breadcrumb + SoftwareApplication blocks, the site favicon, etc. None of that
lives in this source repo. A naive `cp source -> prod` would DELETE that SEO
block and tank the page's search/social presence.

This script does the safe thing: it keeps PROD's <head> verbatim and grafts the
SOURCE <body> (the actual simulator/whitepaper content you edit here) onto it.

    output = prod[<!DOCTYPE ... </head>] + source[<body> ... </html>]

Usage:
    python splice_head.py <source.html> <prod.html>
      -> prints the spliced HTML to stdout (prod head + source body)

    python splice_head.py --check <source.html> <prod.html>
      -> exit 0 if prod already equals the spliced result (no drift),
         exit 1 if a sync would change prod, exit 2 on a structural error.

CRLF/LF differences are normalized to LF before comparison so a line-ending-only
delta does not read as drift. Output is always LF.

If either file is missing a single <head>...</head> or a <body, the script
refuses (exit 2) rather than emit a malformed page -- it never clobbers prod
with garbage.
"""
import io
import re
import sys

# Pages contain non-Latin-1 glyphs (emoji, em dashes). Force UTF-8 on stdout so
# the script behaves identically on Windows (cp1252 default) and Linux CI.
if hasattr(sys.stdout, "buffer"):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", newline="")

HEAD_RE = re.compile(r"(?is)^(.*?</head>)")
BODY_RE = re.compile(r"(?is)(<body\b.*</html>\s*)$")


def _read(path):
    with open(path, "r", encoding="utf-8") as fh:
        return fh.read().replace("\r\n", "\n").replace("\r", "\n")


def splice(source_path, prod_path):
    """Return prod's head + source's body, or raise ValueError on bad structure."""
    src = _read(source_path)
    prod = _read(prod_path)

    head_m = HEAD_RE.search(prod)
    if not head_m:
        raise ValueError(f"no <head>...</head> found in prod file: {prod_path}")
    prod_head = head_m.group(1)

    body_m = BODY_RE.search(src)
    if not body_m:
        raise ValueError(f"no <body>...</html> found in source file: {source_path}")
    src_body = body_m.group(1)

    # Single newline between </head> and <body>.
    return prod_head.rstrip("\n") + "\n" + src_body.lstrip("\n")


def main(argv):
    check = False
    args = [a for a in argv if a != "--check"]
    if "--check" in argv:
        check = True
    if len(args) != 2:
        sys.stderr.write(
            "usage: splice_head.py [--check] <source.html> <prod.html>\n"
        )
        return 2
    source_path, prod_path = args
    try:
        spliced = splice(source_path, prod_path)
    except (ValueError, OSError) as exc:
        sys.stderr.write(f"splice error: {exc}\n")
        return 2

    if check:
        current = _read(prod_path).rstrip("\n") + "\n"
        return 0 if current == spliced.rstrip("\n") + "\n" else 1

    sys.stdout.write(spliced)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
