// host.js — a thin, generic WebGL 2 binding for the triangle demo.
//
// The split, in one sentence: Java owns the demo — the shader sources, the pipeline
// orchestration, the layout, the uniforms, the geometry — and this file owns one small
// function per GL call plus the boot/rAF plumbing. Nothing in here names a shader, a
// uniform, an attribute or a colour: those all arrive as arguments from Java.
//
// Handles are small ints into the tables below, and 0 means "no object". Every function
// answers 0, ignores the call, or answers -1 (for a String) when its handle is bad or
// no context exists — Java checks the answers and reports, so the binding never throws.
//
// This file supplies exactly the import modules the wasm module declares:
//
//   webgl_env      — the 19 GL calls Triangle.java declares.
//   wasmcoffee_env — math_sin and math_cos, plus the console_* trio behind
//                    System.out.println: a String arrives as (address, byte
//                    length) and a line is flushed on console_nl.
//
// Two deliberate singletons: one canvas and one context. The binding is single-context
// by design — a second canvas would need its handle threaded through pushResize and
// gl_set_size, and the demo has exactly one. The shader objects are never deleted:
// the page builds one pipeline and keeps it for life.
'use strict';
(() => {
  // ---- tables and singletons -----------------------------------------------

  const canvases = [null];      // index 0 is permanently "no object"
  const shaders = [null];
  const programs = [null];
  const buffers = [null];
  const uniformLocs = [null];

  function stash(table, obj) {
    if (!obj) return 0;
    table.push(obj);
    return table.length - 1;
  }

  function get(table, h) {
    return table[h] || null;
  }

  let wasm = null;              // the wasm module's exports
  let canvas = null;            // the one canvas, bound by gl_context
  let gl = null;                // the one context, bound by gl_context
  let vao = null;               // the one VAO, built by gl_buffer
  let vbo = null;               // the one VBO, built by gl_buffer
  let currentProgram = null;    // bound by gl_use, drawn by gl_draw
  let frames = 0;
  let glErrors = 0;
  let vertexCount = 0;

  // ---- the string boundary ---------------------------------------------------

  const textDec = new TextDecoder();
  const textEnc = new TextEncoder();

  // Decoded DURING the call: the band is reused by the next crossing, so a
  // (ptr, len) pair retained past return reads somebody else's bytes.
  function readStr(ptr, len) {
    return textDec.decode(new Uint8Array(wasm.memory.buffer, ptr, len));
  }

  // A String answer: bytes into the fixed band, truncated to its capacity,
  // answering the count. -1 would mean null; the caller decides that.
  function writeStr(text, ptr, cap) {
    const bytes = textEnc.encode(text);
    const n = Math.min(bytes.length, cap);
    new Uint8Array(wasm.memory.buffer, ptr, cap).set(bytes.subarray(0, n));
    return n;
  }

  // System.out.println: fragments accumulate, console_nl flushes the line.
  let line = '';
  function consoleI32(v) { line += String(v); }
  function consoleStr(ptr, len) { line += readStr(ptr, len); }
  function consoleNl() { console.log(line); line = ''; }

  // WebGL fails silently: a mistyped call draws nothing and reports nothing.
  // getError() is the only place that turns up, so every GL call this file
  // makes is followed by a drain, and the count is published for the check.
  function drainGlErrors() {
    for (let e = gl.getError(); e !== gl.NO_ERROR; e = gl.getError()) glErrors++;
    return glErrors;
  }

  // ---- the 19 calls Java imports ----------------------------------------------

  function glCanvas(idPtr, idLen) {
    const el = document.getElementById(readStr(idPtr, idLen));
    return el instanceof HTMLCanvasElement ? stash(canvases, el) : 0;
  }

  function glContext(canvasH, kindPtr, kindLen) {
    const el = get(canvases, canvasH);
    if (!el) return 0;
    gl = el.getContext(readStr(kindPtr, kindLen), { antialias: true });
    if (!gl) return 0;
    canvas = el;
    drainGlErrors();
    return 1;
  }

  function glCompile(type, srcPtr, srcLen) {
    if (!gl) return 0;
    const sh = gl.createShader(type);
    if (!sh) return 0;
    gl.shaderSource(sh, readStr(srcPtr, srcLen));
    gl.compileShader(sh);
    drainGlErrors();
    return stash(shaders, sh);
  }

  function glCompiled(h) {
    const sh = get(shaders, h);
    if (!gl || !sh) return 0;
    const ok = gl.getShaderParameter(sh, gl.COMPILE_STATUS);
    drainGlErrors();
    return ok ? 1 : 0;
  }

  function glShaderLog(h, ptr, cap) {
    const sh = get(shaders, h);
    if (!gl || !sh) return -1;
    const log = gl.getShaderInfoLog(sh);
    drainGlErrors();
    return writeStr(log || '', ptr, cap);
  }

  function glLink(vsH, fsH) {
    if (!gl) return 0;
    const vs = get(shaders, vsH);
    const fs = get(shaders, fsH);
    if (!vs || !fs) return 0;
    const p = gl.createProgram();
    if (!p) return 0;
    gl.attachShader(p, vs);
    gl.attachShader(p, fs);
    gl.linkProgram(p);
    drainGlErrors();
    return stash(programs, p);
  }

  function glLinked(h) {
    const p = get(programs, h);
    if (!gl || !p) return 0;
    const ok = gl.getProgramParameter(p, gl.LINK_STATUS);
    drainGlErrors();
    return ok ? 1 : 0;
  }

  function glProgramLog(h, ptr, cap) {
    const p = get(programs, h);
    if (!gl || !p) return -1;
    const log = gl.getProgramInfoLog(p);
    drainGlErrors();
    return writeStr(log || '', ptr, cap);
  }

  function glUse(h) {
    const p = get(programs, h);
    if (!gl || !p) return;
    currentProgram = p;
    gl.useProgram(p);
    drainGlErrors();
  }

  function glBuffer(byteSize) {
    if (!gl) return 0;
    vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, byteSize, gl.DYNAMIC_DRAW);
    drainGlErrors();
    return stash(buffers, vbo);
  }

  function glAttrib(index, size, stride, offset) {
    if (!gl || !vao || !vbo) return;
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.enableVertexAttribArray(index);
    gl.vertexAttribPointer(index, size, gl.FLOAT, false, stride, offset);
    drainGlErrors();
  }

  function glUniformLoc(progH, namePtr, nameLen) {
    const p = get(programs, progH);
    if (!gl || !p) return 0;
    // A missing or optimised-out uniform is null, which stashes as 0 —
    // Java's cue to fail loudly rather than set into the void.
    return stash(uniformLocs, gl.getUniformLocation(p, readStr(namePtr, nameLen)));
  }

  function glUniform1f(progH, locH, v) {
    const p = get(programs, progH);
    const loc = get(uniformLocs, locH);
    if (!gl || !p || !loc) return;
    gl.useProgram(p);                 // bound here, so no ordering is assumed
    gl.uniform1f(loc, v);
    drainGlErrors();
  }

  function glClearColor(r, g, b, a) {
    if (!gl) return;
    gl.clearColor(r, g, b, a);
    drainGlErrors();
  }

  function glSetSize(w, h) {
    if (!canvas) return;
    canvas.width = w;
    canvas.height = h;
  }

  function glViewport(w, h) {
    if (!gl) return;
    gl.viewport(0, 0, w, h);
    drainGlErrors();
  }

  function glUpload(ptr, byteCount) {
    if (!gl || !vbo) return;
    // The ArrayBuffer is read fresh every frame, on purpose: if the module ever
    // grows its memory the old ArrayBuffer is detached, and a view captured at
    // boot would then throw instead of drawing.
    const data = new Float32Array(wasm.memory.buffer, ptr, byteCount / 4);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, data);
    drainGlErrors();
  }

  function glClear() {
    if (!gl) return;
    gl.clear(gl.COLOR_BUFFER_BIT);
    drainGlErrors();
  }

  function glDraw(count) {
    if (!gl || !vao || !currentProgram) return;
    vertexCount = count;
    gl.bindVertexArray(vao);
    gl.useProgram(currentProgram);
    gl.drawArrays(gl.TRIANGLES, 0, count);
    frames++;
    drainGlErrors();
  }

  // ---- boot ------------------------------------------------------------------

  const importObject = {
    webgl_env: {
      gl_canvas: glCanvas,
      gl_context: glContext,
      gl_compile: glCompile,
      gl_compiled: glCompiled,
      gl_shader_log: glShaderLog,
      gl_link: glLink,
      gl_linked: glLinked,
      gl_program_log: glProgramLog,
      gl_use: glUse,
      gl_buffer: glBuffer,
      gl_attrib: glAttrib,
      gl_uniform_loc: glUniformLoc,
      gl_uniform1f: glUniform1f,
      gl_clear_color: glClearColor,
      gl_set_size: glSetSize,
      gl_viewport: glViewport,
      gl_upload: glUpload,
      gl_clear: glClear,
      gl_draw: glDraw,
    },
    wasmcoffee_env: {
      math_sin: Math.sin,
      math_cos: Math.cos,
      // console_i32 is undeclared today — Java prints only Strings — but the
      // first println(int) needs it, so it is provided upfront.
      console_i32: consoleI32,
      console_str: consoleStr,
      console_nl: consoleNl,
    },
  };

  function fail(text) {
    const note = document.getElementById('note');
    if (note) note.textContent = text;
    console.error('triangle: ' + text);
  }

  // The DOM facts Java cannot see — CSS size and pixel ratio — pushed to the
  // export that owns the resize math. Registered after a successful main, so
  // the canvas and the program both exist by the first call.
  function pushResize() {
    if (!wasm || !canvas) return;
    wasm.triangle_resize(canvas.clientWidth, canvas.clientHeight, window.devicePixelRatio || 1);
  }

  async function boot() {
    const url = new URL('triangle.wasm', document.baseURI);
    const res = await fetch(url);
    // Report a bad fetch as itself: a 404 body fails instantiate with an error
    // that says nothing about the real problem.
    if (!res.ok) throw new Error('fetch ' + url + ': HTTP ' + res.status);
    const buf = await res.arrayBuffer();
    const { instance } = await WebAssembly.instantiate(buf, importObject);
    wasm = instance.exports;

    if (!wasm.triangle_main()) {
      fail('The GL pipeline did not build — see the console.');
      return;
    }
    pushResize();

    window.addEventListener('resize', pushResize);

    requestAnimationFrame(function frame(t) {
      try {
        wasm.triangle_frame(t);          // Java draws; the host drives below
      } catch (e) {
        fail('Frame failed: ' + e.message);   // report once and stop the loop
        return;                          // scheduling first would spam this forever
      }
      requestAnimationFrame(frame);
    });
  }

  // A tiny probe surface, so a headless check (or devtools) can tell "it is
  // drawing" apart from "it is a still image" without reading pixels.
  window.__triangle = {
    frames: () => frames,
    errors: () => glErrors,
    vertices: () => vertexCount,
  };

  boot().catch((e) => fail('Could not start: ' + e.message));
})();
