# WebGL Triangle using WasmCoffee

In the world of WebGL, one demo stands out to me: The classic colour triangle that is slowly
spinning around. So naturally, when I wanted to create a WasmCoffee and WebGL demo, this
is what I built!

Being Web Assembly, there's more needed than just the Java-based binary, we also need some
JavaScript magic to tie things together. I ended up splitting things up like this:

- **JavaScript** (`host.js`): A thin, generic WebGL binding — one small function per GL call,
a handle table, and the boot/rAF plumbing. It knows nothing about this demo.
- **Java** (`Triangle.java`): Everything else: the shader sources, the pipeline orchestration, the
layout, the uniforms, the resize math and the per-frame geometry. Wasm has no direct access to
the DOM or browser API's, so every GL call crosses to the host — but every decision stays here.


## How to run

```sh
./serve.sh       # builds, then serves dist/ on :8080
                 # open http://localhost:8080/
```

`./build.sh` compiles `Triangle.java` to `dist/triangle.wasm` and populates `dist/` with `index.html`
and `host.js`. Since a `.wasm` binary cannot be fetched over `file://`, it needs a static server.
`serve.sh` uses `python3 -m http.server`, but just about any static server should do. I just
happen to use Python quite a lot!

The build needs the wasmcoffee compiler from the sibling checkout. If it lives somewhere else,
point at it explicitly:

```sh
WASMCOFFEE=/path/to/wasmcoffee ./build.sh
```

## So how does it work

The Java binary exports some functions for the host script to call:

- **`triangle_main()`**: Called once, after the page exists. Builds the whole pipeline — canvas,
  context, shaders, program, buffer, attributes — and writes the constant half of the vertex data
  (the colours). A return of 0 means a step failed, after saying which one on the console.

- **`triangle_resize(cssW, cssH, dpr)`**: Called on boot and on every window resize with the DOM
  facts Java cannot see. Turns CSS pixels into drawing-buffer pixels, re-fits the viewport and
  the aspect correction. A no-op until `triangle_main` has built the pipeline.

- **`triangle_frame(t_ms)`**: Called per animation frame, with the frame timestamp as an argument.
  It writes the rotated positions to the memory buffer, then uploads, clears and draws.

`main()` is never called by the host — it drives the three functions above directly — but the
compiler wants an entry point, so it stays, empty. That holds because nothing needs initialising:
the vertex block defaults to zeroes and the shaders are locals in `triangle_main`, not fields.
The `--export-all` flag is what publishes the three driver functions: it exports every static
method whose parameters are all numbers.

The JavaScript host provides one import per GL call, in `webgl_env`:

- Setup: `gl_canvas(id)` answers a canvas handle; `gl_context(canvas, kind)` binds the
  `"webgl2"` context and answers 1/0.
- Shaders: `gl_compile(type, source)` answers a shader handle; `gl_compiled(shader)` answers
  the status; `gl_shader_log(shader)` answers the info log, or null.
- Program: `gl_link(vs, fs)`, `gl_linked(program)`, `gl_program_log(program)`, then
  `gl_use(program)`.
- Vertices: `gl_buffer(byteSize)` builds the VAO + VBO; `gl_attrib(index, size, stride, offset)`
  binds one attribute; `gl_uniform_loc(program, name)` answers a uniform handle.
- Per resize and frame: `gl_set_size`, `gl_viewport`, `gl_uniform1f(program, loc, v)`,
  `gl_clear_color`, `gl_upload(ptr, byteCount)`, `gl_clear`, `gl_draw(count)`.

`ptr` is a byte offset into the wasm module's linear memory. This way, JavaScript reads whatever
Wasm writes. A `String` argument crosses as `(address, byte length)` of UTF-8 the module copied
into its boundary band; the host must decode it during the call. A `String` answer is written
into a fixed band the module lends the host, or `-1` for null — which is how a missing info log
reads as Java `null`. Handles are small ints and 0 means "no object".

- **`wasmcoffee_env`**: `math_sin` / `math_cos` for the rotation, and `console_str` / `console_nl`
  behind `System.out.println` — a line is assembled from fragments and flushed on the newline.

```js
const importObject = {
  webgl_env: { gl_canvas: glCanvas /* ... 19 in total, one per GL call */ },
  wasmcoffee_env: {
    math_sin: Math.sin, math_cos: Math.cos,
    console_str: consoleStr, console_nl: consoleNl,
  },
};
```

The full import list lives above `Triangle.java`'s `WebGL` class, next to the code that calls it.

## The vertex layout

```
0 x   1 y   2 r   3 g   4 b      -- 5 floats, 20 bytes per vertex
```

The vertex layout is defined in `Triangle.java` as `VERT_FLOATS` and then gets handed to the host
piece by piece: `gl_buffer` takes the byte size, `gl_attrib` takes one attribute's (index, size,
stride, offset), and `gl_upload` takes the block's address. The host invents no layout of its own.

## The vertex buffer, and why it is 15 static fields

Java has no address-of operator, so there is no array whose address can be handed to the host the way
Pascal hands over `@verts`. Instead the vertex buffer is 15 static `float` fields. Static primitives
live in the module's data image from address 16 in declaration order, so the block at the top of
`Triangle.java` is the contiguous 60 bytes at 16..75, and `VERT_BASE` names that address for the
`gl_upload` call.

Two rules keep this honest, and both are load-bearing:

- The 15 fields must stay the **first** static fields declared. Anything declared above them shifts
  the block, and `VERT_BASE` must move with it.
- A static initialiser must be a **plain non-negative literal**. A negative one (`-0.5`) is silently
  written as zero in the data image, which is why the triangle's corners live in locals inside
  `triangle_frame` rather than in static fields.

String literals disturb none of this: they live in GC globals and cross the boundary through a
band past the end of the data image, so the two shader sources cost the vertex block nothing.
They are locals rather than fields for the reason below: a field with an initialiser only runs
in `main()`.

## Troubleshooting

During development of this example, I made quite a few mistakes. Here's where I messed up and how
to fix it.

- **A missing `wasmcoffee_env` entry.** Adding `Math.sin`, `Math.cos`, `Math.tan`, `Math.asin`,
  `Math.acos`, `Math.atan`, `Math.atan2`, `Math.exp`, `Math.log`, `Math.pow` or the hyperbolic
  variants to the Java side adds an import on the host's side, named `math_*` after the function
  (`math_atan2`, `math_pow`). A `System.out.println` likewise needs `console_str` and `console_nl`
  (`console_i32` for an `int`). Instantiation then fails with "module is not an object", which reads
  like a loader bug and is not one. `Math.sqrt`, `Math.abs`, `Math.floor`, `Math.ceil` and `Math.rint`
  are native instructions and import nothing.
- **A vertex block that moved.** If a static field is added above the 15 vertex floats, every vertex
  the host reads is garbage — usually a collapsed or invisible triangle. `VERT_BASE` must be the byte
  address of `vx0`: 16 plus the bytes of whatever is declared above it, alignment padding
  included — doubles start on 8-byte boundaries, which is the zero word at 84 ahead of `RADIUS`.
  When in doubt,
  `wasm-tools print dist/triangle.wasm` shows the data image and the store addresses.
- **A negative static initialiser.** `static final double y1 = -0.5;` compiles cleanly and reads back
  as `0.0` — the triangle renders lopsided with no error anywhere. Keep negative constants in locals.
- **A static field with an initialiser.** Static initialisers run in `main()` and nowhere else,
  and the host never calls `main()` — so a `static String VERT = ...` reads back null and the first
  crossing traps in `unreachable` with no message. The shaders are locals in `triangle_main` for
  exactly this reason. If an initialised static ever becomes unavoidable, the host must call `main()`
  once before `triangle_main`.
- **CSS size versus drawing buffer.** `canvas.clientWidth` is the CSS size;
  `canvas.width` is the drawing buffer. Set the buffer to the CSS size times
  `devicePixelRatio` (as `triangle_resize` does) or every edge is soft on a retina
  screen.
- **`bufferSubData` past the end of the buffer.** `gl.bufferData` at creation
  sizes the buffer, and `bufferSubData` never grows it. The host allocates
  the byte size `gl_buffer` received, and `gl_upload` never checks it.
- **WebGL's silence.** A mistyped attribute or a failed link draws nothing and
  reports nothing. `drainGlErrors()` runs `gl.getError()` after every setup and
  every frame, and the count is published on `window.__triangle.errors()`.

The host publishes a small number of useful probe functions:

```js
window.__triangle.frames()    // how many frames have been drawn
window.__triangle.errors()    // GL errors seen so far, we hope for 0
window.__triangle.vertices()  // the count Java handed to gl_draw, useful for debugging
```
