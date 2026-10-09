# tools/

Command-line front end for the WasmCoffee compiler that ships in this
directory as `wasmcoffee.wasm` — the same compiler module the Web IDE runs,
driven outside the browser.

The compiler is a single WebAssembly module with a very small host surface,
so it can be run almost anywhere. These scripts do that with plain Node — no
network, no dependencies and no native toolchain.

| Script | Purpose |
|---|---|
| [`wccompile.mjs`](wccompile.mjs) | Compile Java source to a `.wasm` binary |
| [`wcrun.mjs`](wcrun.mjs) | Run a compiled console program in a terminal |
| [`test.sh`](test.sh) | Regression test: compiles and runs every console example, for my sanity |

Requires **Node 20 or newer** (`node --version`) to compile. Running programs
needs Wasm-GC (ideally Node 22+), because compiled programs keep strings
in GC globals. Everything runs offline.

## How this works

The compiler module declares two imports:

- `odin_env.write(fd, ptr, len)` — diagnostics (and panic text before a trap)
- `odin_env.rand_bytes(ptr, len)` — randomness

It exports its memory and a small C-style API:
`wasmcoffee_source_ptr`, `wasmcoffee_compile`, `wasmcoffee_output_ptr/len`,
`wasmcoffee_diag_ptr/len`, `wasmcoffee_add_unit`, `wasmcoffee_clear_units`,
`wasmcoffee_set_root_name`.

Supplying those two imports is the job of the host. The browser IDE
does the same thing in webcoffee's `worker.js`, and this repo's `wccompile`
is that host without the browser functionality.

## wccompile

```bash
node tools/wccompile.mjs <main.java> [more.java ...] [options]
```

Options:

- `-o, --out <file>` — output path (default `<main>.wasm` next to the source; `-` writes to stdout)
- `--compiler <path>` — compiler module (default `tools/wasmcoffee.wasm`)
- `--export-all` — export every host-callable static method by name
- `--initial-memory N` — linear memory size in bytes, rounded up to a page (0 = default)
- `-v, --verbose` — list compiled files and report timings
- `-h, --help`

Examples:

```bash
node tools/wccompile.mjs examples/console/hello/Hello.java -o hello.wasm
node tools/wccompile.mjs examples/console/greet/Greet.java examples/console/greet/Greeter.java -o greet.wasm -v
cat Hello.java | node tools/wccompile.mjs - -o - > hello.wasm
node tools/wccompile.mjs --export-all examples/webgl/triangle/Triangle.java -o triangle.wasm
```

### File sets

A file set is one program: every `.java` file on the command line is compiled
together, a name one file declares is a name in the others, and the first file
names it (its class is the entry point). An `import` declaration is recorded
and never resolved — the set is what puts another file's classes in the
program.

> **Ordering matters inside the compiler**: units are staged through the same
> scratch buffer that holds the main source, so `wccompile` adds every unit
> *before* writing the main program. Writing the main source first lets a unit
> silently overwrite it.

Output is written only if the compile succeeds, and diagnostics come back from
the compiler verbatim on stderr. A trap (a feature the compiler cannot build
yet, an internal assertion) is reported as the compiler's own panic sentence
rather than an `unreachable`, just like the Web IDE does it.

## wcrun

```bash
node tools/wcrun.mjs <program.wasm> [options]
```

Options:

- `--allow-unimplemented` — stub browser-only imports instead of refusing to run
- `-h, --help`

Examples:

```bash
node tools/wcrun.mjs hello.wasm
printf 'one\ntwo\n' | node tools/wcrun.mjs echo.wasm   # pipe input, handy for test automation
```

### What it implements

The console part of the ABI: `System.out.println` (`console_i32/i64/f32/f64/bool/nl/str`),
stdin line reads (`read_line` behind `BufferedReader.readLine` / `IO.readln`),
`System.nanoTime` (a monotonic clock), and the `Math.*` imports (`math_sin` … `math_tanh`).

- Program output goes to stdout as-is.
- Stdin is line-oriented: one line per read (terminator included, the module
  chomps `\n` and `\r\n`), `-1` at end of input. A pipe is read up front, so a
  scripted input drives an interactive program; a terminal is read one blocking
  line at a time, so interactive programs genuinely interact.
- A line longer than the module's scratch capacity is reported without writing
  anything, and the module's own over-cap guard traps it.

### What it refuses

Programs that draw to a canvas or the DOM. The runner identifies them from the
compiled program's imports: anything outside `wasmcoffee_env` (`webgl_env`,
`web_*`, …) needs a JS host page with a real DOM, so the runner names the
imports and stops. Console programs are unaffected, and
`--allow-unimplemented` will still run them (with no visible graphics).

A program that traps (`1/0`, a null dereference, …) stops with `wcrun: trap: …`
and a nonzero exit, its output up to the trap is already on stdout.

## test.sh

```bash
./tools/test.sh
```

Compiles and runs every `examples/console` program and checks stdout, builds
the WebGL triangle through its own `build.sh` (proving the repo builds with
the wasm compiler only), then checks the error paths: a compile error (exit 1,
no output file), a browser-only refusal (exit 2), and a runtime trap (exit 2).
Twelve checks, all green is the gate for touching anything in this directory.

---

---
What follows is notes for me, on how to maintain this, because I forget things sometimes.
---

## Refreshing the vendored compiler

`tools/wasmcoffee.wasm` is a copy of webcoffee's `dist/wasmcoffee.wasm`,
rebuilt from the wasmcoffee core. To refresh it after a compiler change:

```bash
(cd <webcoffee> && ./build.sh)       # rebuilds dist/wasmcoffee.wasm
cp <webcoffee>/dist/wasmcoffee.wasm tools/wasmcoffee.wasm
./tools/test.sh                        # the gate
```

This copy was built 2026-10-09 from wasmcoffee core `7c4853b` (v0.0.1,
adds bit-twiddling intrinsics and wrapper API). A stale copy shows up as
missing exports (`set_root_name` and friends degrade gracefully) or as
behaviour the gate catches, rerun it after every refresh.

To try a fresh compiler build without replacing the vendored one, point at it
explicitly: `node tools/wccompile.mjs --compiler <webcoffee>/dist/wasmcoffee.wasm …`.
