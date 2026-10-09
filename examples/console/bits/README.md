# Bits (bitwise operations and intrinsics)

A simple bit manipulation example demonstrating bitwise operators (`&`, `|`, `^`, `~`, `<<`, `>>`), bit-twiddling intrinsics (`Integer.bitCount`, `Integer.numberOfLeadingZeros`, `Integer.numberOfTrailingZeros`), and bit flag manipulation.

## How to run

From the repository root:

```sh
node tools/wccompile.mjs examples/console/bits/Bits.java -o bits.wasm
node tools/wcrun.mjs bits.wasm
rm bits.wasm
```

Expected output:

```
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
```
