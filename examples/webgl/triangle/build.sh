#!/bin/sh
# Build triangle.wasm and stage a static site in dist/.
#
#   1. compile Triangle.java -> dist/triangle.wasm  (with the repo's wasm-based compiler)
#   2. copy the runtime files (index.html, host.js) into dist/
#
# dist/ is wiped and restaged after a successful compile, so a typo should not destroy the last good build.
#
#   ./build.sh     compile and stage the static site
#   ./serve.sh     build, then serve dist/ on http://localhost:8080/
#
# Needs Node 18+ only: the compile runs through tools/wccompile.mjs, which
# drives the vendored wasm compiler — no native toolchain, no sibling checkout.
set -e
cd "$(dirname "$0")"

WCCOMPILE="$(cd ../../../tools && pwd)/wccompile.mjs"
DIST=dist

if ! command -v node >/dev/null 2>&1; then
  echo "build: node 18+ is required" >&2
  exit 1
fi
if [ ! -f "$WCCOMPILE" ]; then
  echo "build: no compiler front end at $WCCOMPILE" >&2
  exit 1
fi

# Compile to a temporary file first: a failed compile leaves dist/ untouched.
TMPWASM="$(mktemp -t triangle_build).wasm"
trap 'rm -f "$TMPWASM"' EXIT

node "$WCCOMPILE" --export-all Triangle.java -o "$TMPWASM"

rm -rf "$DIST"
mkdir -p "$DIST"
mv "$TMPWASM" "$DIST/triangle.wasm"
trap - EXIT

cp index.html host.js "$DIST/"

echo "build: staged $DIST/ ($(wc -c < "$DIST/triangle.wasm" | tr -d ' ') B wasm)"
echo "build: run ./serve.sh and open http://localhost:8080/"
