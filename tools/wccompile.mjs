#!/usr/bin/env node
// wccompile — offline CLI compiler for WasmCoffee.
//
// We use the `wasmcoffee.wasm` compiler, just like the online IDE does. Well, with just like,
// I mean we create a suitable host environment, of course. But it's the same wasm binary.
//
// You need a version of Node that handles Web Assembly properly, so anything from 20 onwards
// seems to have all the right functionality.
//
// The compiler module declares two required host imports:
//   odin_env.write(fd, ptr, len)   -> diagnostics / panic text
//   odin_env.rand_bytes(ptr, len)  -> randomness
//
// It also exports the required touch points:
//  source buffer, compile, output, diag, add_unit, set_root_name
//
// It's just as used by the web IDE (webcoffee's worker.js) and needed to create the right
// runtime environment.

import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomFillSync } from 'node:crypto';

// ------------------------------------------------------------------------------------------------
const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_COMPILER = resolve(HERE, 'wasmcoffee.wasm');

// Must match SOURCE_CAPACITY in webcoffee's src/main.odin.
const SOURCE_CAP = 8 * 1024 * 1024;

const decoder = new TextDecoder('utf-8');
const encoder = new TextEncoder();

// ------------------------------------------------------------------------------------------------
function usage() {
  return `wccompile — compile WasmCoffee (Java subset) source to WebAssembly.

Usage:
  node tools/wccompile.mjs <main.java> [more.java ...] [options]
  node tools/wccompile.mjs - [options] < main.java

Options:
  -o, --out <file>      Write the .wasm here (default: <main>.wasm; "-" = stdout)
      --compiler <path> Compiler wasm (default: tools/wasmcoffee.wasm)
      --export-all      Export every host-callable static method by name
      --initial-memory N  Linear memory size in bytes, rounded up to a page
  -v, --verbose         Show resolved files, handy for debugging
  -h, --help            Help

A FILE SET IS ONE PROGRAM. All .java files are compiled as a single program:
a name one file declares is a name in the others, and the FIRST file names it
(its class is the entry point).

Exit status: 0 on success, 1 on compile error, 2 on usage/IO error.`;
}

// ------------------------------------------------------------------------------------------------
function parseArgs(argv) {
  const opts = {
    mains: [], out: null, compiler: DEFAULT_COMPILER,
    exportAll: false, initialMemory: 0, verbose: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') { console.log(usage()); process.exit(0); }
    else if (a === '-o' || a === '--out') opts.out = argv[++i];
    else if (a === '--compiler') opts.compiler = resolve(argv[++i]);
    else if (a === '--export-all') opts.exportAll = true;
    else if (a === '--initial-memory') opts.initialMemory = argv[++i];
    else if (a === '-v' || a === '--verbose') opts.verbose = true;
    else if (a.startsWith('-') && a !== '-') { console.error(`wccompile: unknown option ${a}\n`); console.error(usage()); process.exit(2); }
    else opts.mains.push(a);
  }

  if (opts.mains.length === 0) { console.error(usage()); process.exit(2); }
  if (opts.mains.includes('-') && opts.mains.length > 1) {
    console.error('wccompile: stdin ("-") cannot be combined with other files\n');
    process.exit(2);
  }
  if (opts.mains.includes('-') && opts.out === null) {
    console.error('wccompile: reading from stdin needs an explicit -o (or -o - for stdout)\n');
    process.exit(2);
  }
  if (opts.out === undefined || opts.compiler === undefined || opts.initialMemory === undefined) {
    console.error('wccompile: option is missing its value\n');
    process.exit(2);
  }
  if (typeof opts.initialMemory === 'string') {
    const n = Number(opts.initialMemory);
    if (!Number.isInteger(n) || n < 0) {
      console.error(`wccompile: --initial-memory must be a non-negative integer, got ${opts.initialMemory}\n`);
      process.exit(2);
    }
    opts.initialMemory = n;
  }

  return opts;
}

// ------------------------------------------------------------------------------------------------
/** Load a Java source file, or stdin when the argument is "-". */
function readSource(arg) {
  if (arg === '-') {
    try { return readFileSync(0, 'utf8'); }
    catch (err) { console.error(`wccompile: cannot read source from stdin: ${err.message}`); process.exit(2); }
  }
  const p = resolve(arg);
  if (!existsSync(p)) { console.error(`wccompile: no such file: ${arg}`); process.exit(2); }
  if (statSync(p).isDirectory()) { console.error(`wccompile: ${arg} is a directory`); process.exit(2); }
  try { return readFileSync(p, 'utf8'); }
  catch (err) { console.error(`wccompile: cannot read ${arg}: ${err.message}`); process.exit(2); }
}

// ------------------------------------------------------------------------------------------------
// Turn captured compiler output — an Odin `panic` line, when present — into a diagnostic.
function compilerFailureDiagnostic(logParts, trap) {
  const text = (logParts || []).join('');
  const panic = text.match(/panic:\s*([\s\S]*)$/);
  if (panic && panic[1].trim()) {
    return 'error: ' + panic[1].trim() + '\n';
  }
  if (text.trim()) {
    return 'error: ' + text.trim() + '\n';
  }
  return (
    'error: the compiler failed without a diagnostic' +
    (trap && trap.message ? ' (' + trap.message + ')' : '') +
    '\n'
  );
}

// ------------------------------------------------------------------------------------------------
async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const t0 = Date.now();

  // Read every source up front: a missing file fails the process here.
  const files = opts.mains.map((arg) => ({
    arg,
    name: arg === '-' ? 'Program.java' : basename(arg),
    source: readSource(arg),
  }));
  const [root, ...units] = files;

  let compilerBytes;
  try { compilerBytes = readFileSync(opts.compiler); }
  catch (err) { console.error(`wccompile: cannot read compiler ${opts.compiler}: ${err.message}`); process.exit(2); }

  let mod;
  try { mod = await WebAssembly.compile(compilerBytes); }
  catch (err) { console.error(`wccompile: cannot compile ${opts.compiler}: ${err.message}`); process.exit(2); }

  // The compiler writes an Odin `panic` message to fd 1 (stdout) *before* it traps to
  // `unreachable`. Capturing every host write lets a trap be reported as the compiler's own
  // sentence instead of a bare "unreachable" (a feature it cannot compile yet, an internal
  // assertion, and so on).
  const compilerLog = [];
  let memory = null;
  let instance;
  try {
    instance = await WebAssembly.instantiate(mod, {
      odin_env: {
        write: (fd, ptr, len) => {
          if (!memory) return;
          const str = decoder.decode(new Uint8Array(memory.buffer, ptr, len));
          compilerLog.push(str);
          if (fd === 2) process.stderr.write(`[wasmcoffee] ${str}`);
        },
        rand_bytes: (ptr, len) => {
          if (!memory) return;
          randomFillSync(new Uint8Array(memory.buffer, ptr, len));
        },
      },
    });
  } catch (err) { console.error(`wccompile: cannot instantiate ${opts.compiler}: ${err.message}`); process.exit(2); }

  const e = instance.exports;
  memory = e.memory;

  const stage = (bytes, label) => {
    if (bytes.length > SOURCE_CAP) {
      console.error(`wccompile: ${label} exceeds the 8 MiB staging buffer`);
      process.exit(2);
    }
    const ptr = e.wasmcoffee_source_ptr();
    new Uint8Array(memory.buffer, ptr, bytes.length).set(bytes);
    return ptr;
  };

  // Units are staged through the same scratch buffer that holds the main source, so every
  // unit is added before writing the main program. Writing the main source first lets a
  // unit silently overwrite it.
  if (typeof e.wasmcoffee_clear_units === 'function') e.wasmcoffee_clear_units();
  for (const u of units) {
    const encName = encoder.encode(u.name);
    const encSrc = encoder.encode(u.source);
    if (encName.length + encSrc.length > SOURCE_CAP) {
      console.error(`wccompile: unit ${u.name} exceeds the 8 MiB staging buffer`);
      process.exit(2);
    }
    const ptr = e.wasmcoffee_source_ptr();
    const buf = new Uint8Array(memory.buffer, ptr, encName.length + encSrc.length);
    buf.set(encName, 0);
    buf.set(encSrc, encName.length);
    const ret = e.wasmcoffee_add_unit(ptr, encName.length, ptr + encName.length, encSrc.length);
    if (ret < 0) {
      console.error(`wccompile: add_unit ${u.name} failed: ${ret}`);
      process.exit(2);
    }
  }

  // The root's file name for diagnostics
  if (typeof e.wasmcoffee_set_root_name === 'function') {
    const encName = encoder.encode(root.name);
    const ptr = stage(encName, `root file name ${root.name}`);
    const ret = e.wasmcoffee_set_root_name(ptr, encName.length);
    if (ret < 0) {
      console.error(`wccompile: set_root_name failed: ${ret}`);
      process.exit(2);
    }
  }

  const encRoot = encoder.encode(root.source);
  const srcPtr = stage(encRoot, `source ${root.arg}`);
  const t1 = Date.now();

  let ret;
  try {
    ret = e.wasmcoffee_compile(encRoot.length, opts.exportAll, opts.initialMemory);
  } catch (trap) {
    process.stderr.write(compilerFailureDiagnostic(compilerLog, trap));
    process.exit(1);
  }

  const diagLen = e.wasmcoffee_diag_len();
  const diag = diagLen > 0
    ? decoder.decode(new Uint8Array(memory.buffer, e.wasmcoffee_diag_ptr(), diagLen))
    : '';

  if (ret !== 0) {
    process.stderr.write(diag || compilerFailureDiagnostic(compilerLog, null));
    process.exit(1);
  }
  // Success with warnings: the diagnostics ride along on stderr, the module on the out path.
  if (diag) process.stderr.write(diag);

  const outLen = e.wasmcoffee_output_len();
  const out = Buffer.alloc(outLen);
  Buffer.from(memory.buffer, e.wasmcoffee_output_ptr(), outLen).copy(out);

  if (opts.out === '-') {
    process.stdout.write(out);
  } else {
    const outPath = opts.out || root.arg.replace(/\.java$/i, '') + '.wasm';
    try { writeFileSync(outPath, out); }
    catch (err) { console.error(`wccompile: cannot write ${outPath}: ${err.message}`); process.exit(2); }
  }

  if (opts.verbose) {
    const ms = Date.now() - t0;
    console.error(`wccompile: root ${root.name} + ${units.length} unit(s), ${outLen} B wasm in ${ms} ms`);
    for (const u of units) console.error(`wccompile: unit ${u.name}`);
  }
}

await main();
