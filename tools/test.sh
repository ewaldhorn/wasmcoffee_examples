#!/bin/sh
# test.sh — regression test for the tools/ CLI (wccompile + wcrun).
#
# Compiles and runs every examples/console program, checks stdout byte for
# byte, builds the WebGL triangle with the repo's wasm compiler only, and
# checks the error paths (compile error, browser-only refusal, runtime trap).
# Needs Node 18+ only.
#
#   ./tools/test.sh
set -e
cd "$(dirname "$0")/.."

PASS=0
FAIL=0
TMP="$(mktemp -d -t wctools_test)"
trap 'rm -rf "$TMP"' EXIT

check() { # name, expected, actual
  if [ "$2" = "$3" ]; then
    PASS=$((PASS + 1))
    echo "ok   $1"
  else
    FAIL=$((FAIL + 1))
    echo "FAIL $1"
    echo "--- expected ---"
    printf '%s' "$2" | head -c 500; echo
    echo "--- actual ---"
    printf '%s' "$3" | head -c 500; echo
  fi
}

check_exit() { # name, expected_code, actual_code
  if [ "$2" = "$3" ]; then
    PASS=$((PASS + 1))
    echo "ok   $1 (exit $3)"
  else
    FAIL=$((FAIL + 1))
    echo "FAIL $1 (expected exit $2, got $3)"
  fi
}

# 1. hello: single file, println(String).
node tools/wccompile.mjs examples/console/hello/Hello.java -o "$TMP/hello.wasm"
check "hello run" "Hello from WasmCoffee!" "$(node tools/wcrun.mjs "$TMP/hello.wasm")"

# 2. echo: stdin line reads.
node tools/wccompile.mjs examples/console/echo/Echo.java -o "$TMP/echo.wasm"
check "echo run" "$(printf 'got: one\ngot: two')" "$(printf 'one\ntwo\n' | node tools/wcrun.mjs "$TMP/echo.wasm")"

# 3. greet: multi-file set, first file names the program.
node tools/wccompile.mjs examples/console/greet/Greet.java examples/console/greet/Greeter.java -o "$TMP/greet.wasm"
check "greet run" "Hello, WasmCoffee!" "$(node tools/wcrun.mjs "$TMP/greet.wasm")"

# 4. bits: bitwise operations and intrinsics.
node tools/wccompile.mjs examples/console/bits/Bits.java -o "$TMP/bits.wasm"
EXPECTED_BITS=$(cat <<'EOF'
a & b: 12
a | b: 61
a ^ b: 49
~a: -61
a << 2: 240
a >> 2: 15
bitCount: 4
leadingZeros: 26
trailingZeros: 2
has read: true
has write: false
EOF
)
check "bits run" "$EXPECTED_BITS" "$(node tools/wcrun.mjs "$TMP/bits.wasm")"

# 5. compile error: exit 1, no output file.
printf 'public class Broken { this is not java }\n' | node tools/wccompile.mjs - -o "$TMP/broken.wasm" 2>"$TMP/diag.txt" || code=$?
check_exit "compile error exit" 1 "$code"
if [ -e "$TMP/broken.wasm" ]; then FAIL=$((FAIL + 1)); echo "FAIL compile error wrote output"; else PASS=$((PASS + 1)); echo "ok   compile error wrote nothing"; fi
if grep -q "error" "$TMP/diag.txt"; then PASS=$((PASS + 1)); echo "ok   compile error diagnostic"; else FAIL=$((FAIL + 1)); echo "FAIL compile error diagnostic"; fi

# 6. the WebGL example builds with the repo's wasm compiler only (no native
# toolchain, no sibling checkout). dist/ is gitignored build output, so the
# gate builds it fresh — and the refusal check below runs against that build.
./examples/webgl/triangle/build.sh >"$TMP/tri_build.txt" 2>&1
if [ -s examples/webgl/triangle/dist/triangle.wasm ]; then PASS=$((PASS + 1)); echo "ok   triangle builds native-free"; else FAIL=$((FAIL + 1)); echo "FAIL triangle builds native-free"; fi

# 7. browser-only program is refused, not run.
node tools/wcrun.mjs examples/webgl/triangle/dist/triangle.wasm 2>"$TMP/refuse.txt" || code=$?
check_exit "graphics refusal exit" 2 "$code"
if grep -q "needs a browser host" "$TMP/refuse.txt"; then PASS=$((PASS + 1)); echo "ok   graphics refusal message"; else FAIL=$((FAIL + 1)); echo "FAIL graphics refusal message"; fi

# 8. a program that traps exits nonzero and says so.
cat > "$TMP/DivZero.java" <<'EOF'
public class DivZero {
    public static void main(String[] args) {
        System.out.println(1 / 0);
    }
}
EOF
node tools/wccompile.mjs "$TMP/DivZero.java" -o "$TMP/divzero.wasm"
node tools/wcrun.mjs "$TMP/divzero.wasm" 2>"$TMP/trap.txt" || code=$?
check_exit "trap exit" 2 "$code"
if grep -q "trap" "$TMP/trap.txt"; then PASS=$((PASS + 1)); echo "ok   trap message"; else FAIL=$((FAIL + 1)); echo "FAIL trap message"; fi

echo
echo "$PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
