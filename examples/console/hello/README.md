# Hello (console)

The canonical first program: one method, one `println`.

## How to run

From the repository root:

```sh
node tools/wccompile.mjs examples/console/hello/Hello.java -o hello.wasm
node tools/wcrun.mjs hello.wasm
rm hello.wasm
```

Expected output:

```
Hello from WasmCoffee!
```
