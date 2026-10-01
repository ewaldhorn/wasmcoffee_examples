// WasmCoffee and WebGL
//
// Triangle.java — the Java side of the classic WebGL 2 demo.
//
// THE SIDES
//
// JavaScript (host.js) is a thin, generic WebGL binding: one small function per GL call,
// a handle table, and the boot/rAF plumbing. It knows nothing about this demo — no shader
// text, no layout, no colours, no geometry, no sequencing.
//
// Java (Triangle.java) owns everything else: the shader sources, the pipeline orchestration
// (compile, check, link, check), the attribute layout, the uniforms, the resize math, the
// geometry and the per-frame sequencing. A String crosses to the host as (address, byte
// length); a String answer comes back through a fixed band, or null.
//
// PUTTING IT TOGETHER:
//
//   Java exports      triangle_main                 build the GL pipeline, only needed once
//                     triangle_resize(cssW, cssH, dpr)
//                                                     resize the drawing buffer, on boot and
//                                                     on every window resize
//                     triangle_frame(t_ms)          fill the vertex array, draw, per frame
//
//   Java imports      webgl_env.gl_canvas(id)               canvas element -> handle, 0 if missing
//                     webgl_env.gl_context(canvas, kind)    "webgl2" context -> 1/0
//                     webgl_env.gl_compile(type, source)    shader object -> handle
//                     webgl_env.gl_compiled(shader)         COMPILE_STATUS -> 0/1
//                     webgl_env.gl_shader_log(shader)       info log, null if none
//                     webgl_env.gl_link(vs, fs)             program object -> handle
//                     webgl_env.gl_linked(program)          LINK_STATUS -> 0/1
//                     webgl_env.gl_program_log(program)     info log, null if none
//                     webgl_env.gl_use(program)             useProgram
//                     webgl_env.gl_buffer(byteSize)         VAO + VBO + DATA -> handle
//                     webgl_env.gl_attrib(index, size, stride, offset)
//                     webgl_env.gl_uniform_loc(program, name)
//                                                           uniform location -> handle
//                     webgl_env.gl_uniform1f(program, loc, v)
//                     webgl_env.gl_clear_color(r, g, b, a)
//                     webgl_env.gl_set_size(w, h)           canvas.width/height
//                     webgl_env.gl_viewport(w, h)
//                     webgl_env.gl_upload(ptr, byteCount)   vertex block -> GPU
//                     webgl_env.gl_clear()
//                     webgl_env.gl_draw(count)
//
//   Implicit imports  wasmcoffee_env.math_sin, wasmcoffee_env.math_cos
//                     wasmcoffee_env.console_str, wasmcoffee_env.console_nl
//
// A handle is a small int and 0 means "no object", so every creation is checked where it
// happens and failures are reported with the info log Java asked for — not with silence.
//
// THE VERTEX LAYOUT, written down once, here:
//
//     0 x   1 y   2 r   3 g   4 b     -- 5 floats = 20 bytes per vertex
//
// THE VERTEX BUFFER, and why it looks like this:
//
// Java has no address-of operator, so there is no `verts` array whose address can be handed to the
// host. Instead the 15 floats are 15 static fields, declared first: static primitives live in the
// module's data image from address 16 in declaration order, so this block is the contiguous 60 bytes
// at 16..75 that the host uploads to the GPU. VERT_BASE names that address. If a static field is
// ever declared above this block, VERT_BASE must move with it.
//
// Strings disturb none of this: literals live in GC globals and cross the boundary through a
// band past the end of the data image, so the shader sources cost the vertex block nothing — and
// they are locals in triangle_main rather than fields, because a field with an initialiser only
// runs in main(), which the host never calls.
//
// Compile it with the wasmcoffee compiler:
//
//     wasmcoffee --export-all Triangle.java -o triangle.wasm
//     ./build.sh        # does the above, then stages dist/

final class WebGL {
    @Import(module = "webgl_env", name = "gl_canvas")
    static native int canvas(String id);

    @Import(module = "webgl_env", name = "gl_context")
    static native int context(int canvas, String kind);

    @Import(module = "webgl_env", name = "gl_compile")
    static native int compile(int type, String source);

    @Import(module = "webgl_env", name = "gl_compiled")
    static native int compiled(int shader);

    @Import(module = "webgl_env", name = "gl_shader_log")
    static native String shaderLog(int shader);

    @Import(module = "webgl_env", name = "gl_link")
    static native int link(int vs, int fs);

    @Import(module = "webgl_env", name = "gl_linked")
    static native int linked(int program);

    @Import(module = "webgl_env", name = "gl_program_log")
    static native String programLog(int program);

    @Import(module = "webgl_env", name = "gl_use")
    static native void use(int program);

    @Import(module = "webgl_env", name = "gl_buffer")
    static native int buffer(int byteSize);

    @Import(module = "webgl_env", name = "gl_attrib")
    static native void attrib(int index, int size, int stride, int offset);

    @Import(module = "webgl_env", name = "gl_uniform_loc")
    static native int uniformLoc(int program, String name);

    @Import(module = "webgl_env", name = "gl_uniform1f")
    static native void uniform1f(int program, int loc, double v);

    @Import(module = "webgl_env", name = "gl_clear_color")
    static native void clearColor(double r, double g, double b, double a);

    @Import(module = "webgl_env", name = "gl_set_size")
    static native void setSize(int w, int h);

    @Import(module = "webgl_env", name = "gl_viewport")
    static native void viewport(int w, int h);

    @Import(module = "webgl_env", name = "gl_upload")
    static native void upload(int ptr, int byteCount);

    @Import(module = "webgl_env", name = "gl_clear")
    static native void clear();

    @Import(module = "webgl_env", name = "gl_draw")
    static native void draw(int count);
}

public class Triangle {
    // The vertex array itself, as 15 static fields. The host does not copy it — `ptr` below is the
    // address of this block inside the wasm module's linear memory, so what gets uploaded to the GPU
    // is these variables, as they stand at the end of triangle_frame. Read-only from JS: the layout
    // and the values are entirely Java's. This block MUST stay the first static fields declared.
    static float vx0;
    static float vy0;
    static float r0;
    static float g0;
    static float b0;
    static float vx1;
    static float vy1;
    static float r1;
    static float g1;
    static float b1;
    static float vx2;
    static float vy2;
    static float r2;
    static float g2;
    static float b2;

    static final int VERT_COUNT = 3;
    static final int VERT_FLOATS = 5;         // x, y, r, g, b
    static final double RADIUS = 0.75;        // how much of the clip-space square the triangle fills
    static final double SPIN_RATE = 1.0;      // radians per second

    static final int VERT_BASE = 16;          // byte address of vx0 in linear memory, see above

    static final int VERTEX_SHADER = 35633;   // GL enums, Java's now that the host is generic
    static final int FRAGMENT_SHADER = 35632;

    static int program;                       // the linked pipeline, once triangle_main builds it
    static int aspectLoc;                     // uniform location of u_aspect within it

    // Called once by the host, after the page exists. Builds the whole pipeline — canvas, context,
    // shaders, program, buffer, attributes — and writes the constant half of the vertex data (the
    // colours); the positions are rewritten every frame. Returns 0 if any step failed, after saying
    // which one on the console.
    public static int triangle_main() {
        r0 = 1.0f;
        g0 = 0.0f;
        b0 = 0.0f;
        r1 = 0.0f;
        g1 = 1.0f;
        b1 = 0.0f;
        r2 = 0.0f;
        g2 = 0.0f;
        b2 = 1.0f;

        // The two shaders. The classic tutorial pair, minus the uniforms a tutorial usually has:
        // Java sends final clip-space positions, so the only thing left to correct for is the
        // window's aspect ratio. Text blocks, so what you read is what the host compiles.
        //
        // Locals, not static fields, on purpose: static initialisers run in main() and nowhere
        // else, so constants in fields would force the host to call main() before anything works.
        // Literals in locals need no initialiser, which keeps boot to a single triangle_main call.
        String vert = """
            #version 300 es
            layout(location = 0) in vec2 a_pos;      // clip space, computed in Java
            layout(location = 1) in vec3 a_color;    // per-vertex colour, from Java
            uniform float u_aspect;                  // canvas width / height
            out vec3 v_color;
            void main() {
              // Squeeze x so a triangle drawn on the unit circle stays equilateral in a
              // window that is not square.
              gl_Position = vec4(a_pos.x / u_aspect, a_pos.y, 0.0, 1.0);
              v_color = a_color;
            }
            """;

        String frag = """
            #version 300 es
            precision highp float;
            in vec3 v_color;
            out vec4 frag;
            void main() { frag = vec4(v_color, 1.0); }
            """;

        int canvas = WebGL.canvas("gl");
        if (canvas == 0) {
            System.out.println("triangle: no canvas #gl on the page");
            return 0;
        }
        int ctx = WebGL.context(canvas, "webgl2");
        if (ctx == 0) {
            System.out.println("triangle: this browser has no WebGL 2");
            return 0;
        }
        int vs = WebGL.compile(VERTEX_SHADER, vert);
        if (vs == 0 || WebGL.compiled(vs) == 0) {
            System.out.println("triangle: vertex shader did not compile");
            String log = WebGL.shaderLog(vs);
            System.out.println(log == null ? "(no info log)" : log);
            return 0;
        }
        int fs = WebGL.compile(FRAGMENT_SHADER, frag);
        if (fs == 0 || WebGL.compiled(fs) == 0) {
            System.out.println("triangle: fragment shader did not compile");
            String log = WebGL.shaderLog(fs);
            System.out.println(log == null ? "(no info log)" : log);
            return 0;
        }
        int prog = WebGL.link(vs, fs);
        if (prog == 0 || WebGL.linked(prog) == 0) {
            System.out.println("triangle: program did not link");
            String log = WebGL.programLog(prog);
            System.out.println(log == null ? "(no info log)" : log);
            return 0;
        }
        WebGL.use(prog);
        program = prog;
        aspectLoc = WebGL.uniformLoc(prog, "u_aspect");
        if (aspectLoc == 0) {
            System.out.println("triangle: program has no u_aspect uniform");
            return 0;
        }
        WebGL.clearColor(0.06, 0.07, 0.10, 1.0);   // the page's dark backdrop
        int buf = WebGL.buffer(VERT_COUNT * VERT_FLOATS * 4);
        if (buf == 0) {
            System.out.println("triangle: vertex buffer did not build");
            return 0;
        }
        WebGL.attrib(0, 2, VERT_FLOATS * 4, 0);     // x, y
        WebGL.attrib(1, 3, VERT_FLOATS * 4, 8);     // r, g, b
        return 1;
    }

    // Called by the host on boot and on every window resize, with the DOM facts Java cannot see:
    // the canvas's CSS size and the device pixel ratio. Java turns them into drawing-buffer pixels
    // — `canvas.width` is the buffer, `clientWidth` the CSS size, and confusing them is the usual
    // reason a WebGL demo looks blurry — and re-fits the viewport and the aspect correction.
    public static void triangle_resize(double cssW, double cssH, double dpr) {
        if (program == 0) {
            return;
        }
        int bufW = (int) (cssW * dpr + 0.5);
        int bufH = (int) (cssH * dpr + 0.5);
        if (bufW < 1) {
            bufW = 1;
        }
        if (bufH < 1) {
            bufH = 1;
        }
        WebGL.setSize(bufW, bufH);
        WebGL.viewport(bufW, bufH);
        WebGL.uniform1f(program, aspectLoc, (double) bufW / (double) bufH);
    }

    // Called by the host once per animation frame with the frame timestamp.
    //
    // `t_ms`, not a per-frame delta, on purpose: the angle is a function of the page clock, so the
    // spin runs at the same speed on a 60 Hz and a 120 Hz display and a late frame does not slow it.
    public static void triangle_frame(double t_ms) {
        double angle = t_ms / 1000.0 * SPIN_RATE;
        double c = Math.cos(angle);           // wasmcoffee_env.math_cos on the host side
        double s = Math.sin(angle);           // wasmcoffee_env.math_sin on the host side

        // The three corners of an equilateral triangle on the unit circle, pointing up: 90, 210 and
        // 330 degrees. Rotating these drives the animation. Locals, not static fields: a static
        // initialiser must be a plain non-negative literal, and these corners are not all positive.
        double x0 = 0.0;
        double y0 = 1.0;
        double x1 = -0.8660254;
        double y1 = -0.5;
        double x2 = 0.8660254;
        double y2 = -0.5;

        vx0 = (float) ((x0 * c - y0 * s) * RADIUS);
        vy0 = (float) ((x0 * s + y0 * c) * RADIUS);
        vx1 = (float) ((x1 * c - y1 * s) * RADIUS);
        vy1 = (float) ((x1 * s + y1 * c) * RADIUS);
        vx2 = (float) ((x2 * c - y2 * s) * RADIUS);
        vy2 = (float) ((x2 * s + y2 * c) * RADIUS);

        WebGL.upload(VERT_BASE, VERT_COUNT * VERT_FLOATS * 4);
        WebGL.clear();
        WebGL.draw(VERT_COUNT);
    }

    // The module's entry point. The host never calls it — it drives triangle_main,
    // triangle_resize and triangle_frame directly — but the compiler wants one, so it stays, empty.
    // That is only true because nothing needs initialising: the vertex block defaults to zeroes,
    // the numbers are plain literals, and the shaders are locals (see above), so main() would run
    // nothing. A static field with an initialiser would change that — see the README.
    public static void main() {
    }
}
