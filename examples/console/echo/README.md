# Echo (console + stdin)

Reads lines from stdin with `BufferedReader.readLine()` and echoes each one back. `readLine()` answers `null` at end of input, which ends the loop.

## How to run

From the repository root:

```sh
node tools/wccompile.mjs examples/console/echo/Echo.java -o echo.wasm
printf 'one\ntwo\n' | node tools/wcrun.mjs echo.wasm
rm echo.wasm
```

Expected output:

```
got: one
got: two
```

Run without a pipe and the program reads from your terminal instead — one line at a time, Ctrl-D (Ctrl-Z on Windows) to end.
