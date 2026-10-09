# Greet (multi-file console)

Two files, one program: `Greet.java` holds `main`, `Greeter.java` holds the helper. A file set is compiled as a single program — a name one file declares is a name in the others — and the FIRST file names it (its class is the entry point).

## How to run

From the repository root:

```sh
node tools/wccompile.mjs examples/console/greet/Greet.java examples/console/greet/Greeter.java -o greet.wasm
node tools/wcrun.mjs greet.wasm
rm greet.wasm
```

Expected output:

```
Hello, WasmCoffee!
```
