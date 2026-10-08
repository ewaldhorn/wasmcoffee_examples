# WasmCoffee Examples

Example programs for [WasmCoffee](https://wasmcoffee.com/), the Java-subset to WebAssembly compiler and an offline CLI for the compiler, so the examples build and run with no browser involved.

## Repository structure

| Folder | Contents |
|---|---|
| [`examples/console/`](examples/console/) | Console programs: `println`, stdin reads, multi-file sets. Compile and run in a terminal. |
| [`examples/webgl/`](examples/webgl/) | Browser programs: WebGL with a JS host page. Served statically, needs a browser. |
| [`tools/`](tools/) | Offline CLI front ends for the compiler: `wccompile.mjs` (source to `.wasm`) and `wcrun.mjs` (run a console program in a terminal). Node only, no dependencies. |

## How to run as a CLI compiler

The compiler in [`tools/`](tools/) is a Wasm binary with a two-import host surface, so it runs just about anywhere — here, wrapped in Node (20+ to run, since programs use Wasm-GC).

### Compile

```bash
node tools/wccompile.mjs examples/console/hello/Hello.java -o hello.wasm
node tools/wccompile.mjs examples/console/greet/Greet.java examples/console/greet/Greeter.java -o greet.wasm
cat Hello.java | node tools/wccompile.mjs - -o - > hello.wasm
```

A file set is one program: all `.java` files are compiled together and the first one names it. Output is written only if the compile succeeds, and diagnostics come back verbatim on stderr. Add `-v` to see the file list and timings.

### Run

```bash
node tools/wcrun.mjs hello.wasm
printf 'one\ntwo\n' | node tools/wcrun.mjs echo.wasm   # pipe input, handy for test automation
```

`wcrun.mjs` implements the console half of the host ABI: `println`, stdin line reads, `nanoTime`, and the `Math.*` imports. Programs that need a DOM are refused by import name, please run those as hosted pages instead.

[`tools/README.md`](tools/README.md) has the full option list, the host ABI details, and how to refresh the vendored compiler. `./tools/test.sh` is the regression gate for the CLI.

## How to run the browser examples

```sh
cd examples/webgl/triangle && ./serve.sh   # builds, then serves on :8080
```

See each example's README for detailed instructions.
