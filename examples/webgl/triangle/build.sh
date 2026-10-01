#!/bin/sh
# Build triangle.wasm and stage a static site in dist/.
#
#   1. compile Triangle.java -> dist/triangle.wasm  (with the wasmcoffee compiler)
#   2. copy the runtime files (index.html, host.js) into dist/
#
# dist/ is wiped and restaged after a successful compile, so a typo should not destroy the last good build.
#
#   ./build.sh     compile and stage the static site
#   ./serve.sh     build, then serve dist/ on http://localhost:8080/
#
# Needs the WASMCOFFEE home dir in the environment:
#
#   WASMCOFFEE=/path/to/wasmcoffee ./build.sh
set -e
cd "$(dirname "$0")"

WASMCOFFEE="${WASMCOFFEE}/wasmcoffee"
DIST=dist

if [ ! -f "$WASMCOFFEE" ]; then
  echo "build: no compiler at $WASMCOFFEE" >&2
  echo "build: set WASMCOFFEE to the wasmcoffee home dir" >&2
  exit 1
fi

# Compile to a temporary file first: a failed compile leaves dist/ untouched.
TMPWASM="$(mktemp -t triangle_build).wasm"
trap 'rm -f "$TMPWASM"' EXIT

"$WASMCOFFEE" --export-all Triangle.java -o "$TMPWASM"

rm -rf "$DIST"
mkdir -p "$DIST"
mv "$TMPWASM" "$DIST/triangle.wasm"
trap - EXIT

cp index.html host.js "$DIST/"

echo "build: staged $DIST/ ($(wc -c < "$DIST/triangle.wasm" | tr -d ' ') B wasm)"
echo "build: run ./serve.sh and open http://localhost:8080/"
