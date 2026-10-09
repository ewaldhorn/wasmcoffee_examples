#!/usr/bin/env node
// wcrun — run a compiled WasmCoffee console program in the terminal.
//
// Implements the console part of the host ABI: System.out.println (console_*),
// stdin line reads (read_line), System.nanoTime, and the Math.* imports (JS Math.*).
//
// Java console output is a plain byte stream, so everything the program prints goes to stdout
// verbatim, which is what makes `printf ... | node tools/wcrun.mjs echo.wasm` work for test
// automation. Stdin is line-oriented (BufferedReader.readLine / IO.readln).

import { readFileSync, readSync, writeSync, existsSync, statSync } from 'node:fs';
import { basename } from 'node:path';

// ------------------------------------------------------------------------------------------------
// Synchronous writes: process.stdout may be an async pipe, and process.exit()
// truncates it — and the program's output must land byte-exact.
const out = (text) => writeSync(1, text);
const err = (text) => writeSync(2, text);

const decoder = new TextDecoder('utf-8');
const encoder = new TextEncoder();

// ------------------------------------------------------------------------------------------------
function usage() {
  return `wcrun — run a compiled WasmCoffee console program.

Usage:
  node tools/wcrun.mjs <program.wasm> [options]

Options:
      --allow-unimplemented  Stub browser-only imports instead of refusing (brittle!)
  -h, --help                 This message

Implements the console ABI: System.out.println, stdin line reads
(BufferedReader.readLine / IO.readln), System.nanoTime, and the Math.*
imports (JS Math.*).

Programs that need a DOM will fail, because those ABIs are JS runtimes that require a browser.

Exit status: 0 on success, 2 on usage/ABI/runtime error.`;
}

// ------------------------------------------------------------------------------------------------
function parseArgs(argv) {
  const opts = { program: null, allowUnimplemented: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') { writeSync(1, usage() + '\n'); process.exit(0); }
    else if (a === '--allow-unimplemented') opts.allowUnimplemented = true;
    else if (a.startsWith('-')) { err(`wcrun: unknown option ${a}\n\n${usage()}\n`); process.exit(2); }
    else if (opts.program === null) opts.program = a;
    else { err(`wcrun: unexpected argument ${a}\n\n${usage()}\n`); process.exit(2); }
  }
  if (opts.program === null) { err(usage() + '\n'); process.exit(2); }
  return opts;
}

// ------------------------------------------------------------------------------------------------
// Stdin, line-oriented: the host provided support for Strings.
//
// One LINE per read_line call — the bytes up to and including the `\n`, or the
// final unterminated line — and `-1` once there is nothing left. Bytes pass
// through untouched (a `\r\n` terminator included): the module chomps it.
//
// A pipe is slurped up front, which is what lets a scripted input drive an
// interactive program. A terminal is read on demand, one blocking line at a
// time, so an interactive program genuinely interacts instead of waiting for
// Ctrl-D before its first prompt is answered.
function makeStdin() {
  if (process.stdin.isTTY) {
    let eof = false;
    const buf = Buffer.alloc(1);
    return {
      nextLine() {
        if (eof) return null;
        const chunks = [];
        for (;;) {
          let n;
          try { n = readSync(0, buf, 0, 1); }
          catch { eof = true; return chunks.length > 0 ? Buffer.concat(chunks) : null; }
          if (n === 0) { eof = true; return chunks.length > 0 ? Buffer.concat(chunks) : null; }
          chunks.push(Buffer.from(buf));
          if (buf[0] === 0x0a) return Buffer.concat(chunks);
        }
      },
    };
  }
  const data = readSyncStdin();
  let pos = 0;
  return {
    nextLine() {
      if (pos >= data.length) return null;
      const nl = data.indexOf(0x0a, pos);
      const end = nl < 0 ? data.length : nl + 1;
      const line = data.subarray(pos, end);
      pos = end;
      return line;
    },
  };
}

function readSyncStdin() {
  const chunks = [];
  const buf = Buffer.alloc(64 * 1024);
  for (;;) {
    let n;
    try { n = readSync(0, buf, 0, buf.length); }
    catch { break; }
    if (n === 0) break;
    chunks.push(Buffer.from(buf.subarray(0, n)));
  }
  return Buffer.concat(chunks);
}

// ------------------------------------------------------------------------------------------------
function guardNaN(fn) {
  return function (...args) {
    try {
      const val = fn(...args);
      return isNaN(val) ? NaN : val;
    } catch {
      return NaN;
    }
  };
}

// ------------------------------------------------------------------------------------------------
async function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (!existsSync(opts.program)) { err(`wcrun: no such file: ${opts.program}\n`); process.exit(2); }
  if (statSync(opts.program).isDirectory()) { err(`wcrun: ${opts.program} is a directory\n`); process.exit(2); }
  let bytes;
  try { bytes = readFileSync(opts.program); }
  catch (e) { err(`wcrun: cannot read ${opts.program}: ${e.message}\n`); process.exit(2); }

  let module;
  try { module = await WebAssembly.compile(bytes); }
  catch (e) { err(`wcrun: cannot compile ${opts.program}: ${e.message}\n`); process.exit(2); }

  const name = basename(opts.program);
  const declared = WebAssembly.Module.imports(module);
  const foreign = [...new Set(
    declared.filter((imp) => imp.module !== 'wasmcoffee_env').map((imp) => `${imp.module}.${imp.name}`),
  )];
  if (foreign.length > 0 && !opts.allowUnimplemented) {
    err(`wcrun: ${name} needs a browser host — it imports:\n`);
    for (const f of foreign) err(`  ${f}\n`);
    err('\nThese ABIs are supplied by a JS host page and need a real DOM.\n');
    err('Run the program in the Web IDE or as a hosted page instead.\n');
    err('Console-only programs should just work.\n');
    process.exit(2);
  }
  if (foreign.length > 0) {
    err(`wcrun: warning — stubbing ${foreign.length} browser import(s), output will be wrong\n`);
  }

  const stdin = makeStdin();
  let memory = null;
  let outBytes = 0;
  const print = (text) => { outBytes += Buffer.byteLength(text); out(text); };
  // Fresh view per call: the module may grow its memory, detaching the old buffer.
  const mem = () => new Uint8Array(memory.buffer);

  const wasmcoffeeEnv = {
    console_i32: (v) => print(String(v)),
    console_i64: (v) => print(String(v)),
    console_f32: (v) => print(String(v)),
    console_f64: (v) => print(String(v)),
    console_bool: (v) => print(v ? 'true' : 'false'),
    console_nl: () => print('\n'),
    console_str: (ptr, len) => print(decoder.decode(mem().subarray(ptr, ptr + len))),
    // `(ptr, cap) -> byteLen`, one line at a time, `-1` at end of input. A line
    // that does not fit is REPORTED and nothing is written, so the module's own
    // over-cap guard is what traps (the run harness's rule in check_run.py).
    read_line: (ptr, cap) => {
      const line = stdin.nextLine();
      if (line === null) return -1;
      if (line.length > cap) return line.length;
      mem().set(line, ptr);
      return line.length;
    },
    // No arguments, one monotonic i64 back — the wasm i64 result must be a BigInt here.
    nano_time: () => process.hrtime.bigint(),
    math_sin: guardNaN(Math.sin),
    math_cos: guardNaN(Math.cos),
    math_tan: guardNaN(Math.tan),
    math_asin: guardNaN(Math.asin),
    math_acos: guardNaN(Math.acos),
    math_atan: guardNaN(Math.atan),
    math_atan2: guardNaN(Math.atan2),
    math_exp: guardNaN(Math.exp),
    math_log: guardNaN(Math.log),
    math_log10: guardNaN(Math.log10),
    math_pow: guardNaN(Math.pow),
    math_cbrt: guardNaN(Math.cbrt),
    math_hypot: guardNaN(Math.hypot),
    math_sinh: guardNaN(Math.sinh),
    math_cosh: guardNaN(Math.cosh),
    math_tanh: guardNaN(Math.tanh),
  };

  const fallback = () => 0;
  const importObject = new Proxy(
    { wasmcoffee_env: wasmcoffeeEnv },
    { get: (t, p) => (p in t ? t[p] : new Proxy({}, { get: () => fallback })) },
  );

  const hasMain = WebAssembly.Module.exports(module).some((e) => e.name === 'wasmcoffee_main');
  if (!hasMain) {
    err(`wcrun: ${name} exports no wasmcoffee_main — not a console program?\n`);
    err('wcrun: host-driven programs (triangle_main, ...) need their own host page.\n');
    process.exit(2);
  }

  try {
    const instance = await WebAssembly.instantiate(module, importObject);
    memory = instance.exports.memory;
    instance.exports.wasmcoffee_main();
  } catch (e) {
    if (e instanceof WebAssembly.RuntimeError) {
      err(`wcrun: trap: ${e.message}\n`);
      process.exit(2);
    }
    throw e;
  }

  if (outBytes === 0) {
    err('wcrun: note — the program wrote nothing to stdout.\n');
  }
}

// ------------------------------------------------------------------------------------------------
main().then(
  () => process.exit(0),
  (e) => { err(`wcrun: ${e.message}\n`); process.exit(2); },
);
