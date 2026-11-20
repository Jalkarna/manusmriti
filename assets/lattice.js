/* A lattice of syllables turning in the dark: ~1,500 points on a sphere,
   three orbits, additive light. Original geometry, no textures, one draw call. */
(function () {
  const canvas = document.getElementById('field');
  if (!canvas) return;
  const gl = canvas.getContext('webgl', { alpha: true, antialias: true, premultipliedAlpha: false });
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!gl) { canvas.dataset.fallback = '1'; return; }

  const vertex = `
    attribute vec3 aPos;
    attribute vec2 aExtra;          // seed, warmth
    uniform float uYaw, uPitch, uTime, uRad, uSize, uLevel, uGrow, uDpr;
    uniform vec2 uShift, uRes;
    varying float vAlpha, vWarm;
    mat3 rotY(float a){ float c=cos(a), s=sin(a); return mat3(c,0.,-s, 0.,1.,0., s,0.,c); }
    mat3 rotX(float a){ float c=cos(a), s=sin(a); return mat3(1.,0.,0., 0.,c,s, 0.,-s,c); }
    void main(){
      float t = clamp((uGrow - aExtra.x * 0.3) / 0.7, 0.0, 1.0);
      float grow = 1.0 - pow(1.0 - t, 3.0);
      vec3 p = rotX(uPitch) * rotY(uYaw) * aPos * mix(0.22, 1.0, grow);
      float f = 3.15;
      float persp = f / (f - p.z);
      vec2 ndc = p.xy * uRad * persp + uShift;
      float aspect = uRes.x / max(uRes.y, 1.0);
      gl_Position = vec4(ndc.x / aspect, ndc.y, 0.0, 1.0);
      vWarm = aExtra.y;
      float depth = smoothstep(-1.15, 1.15, p.z);
      vAlpha = (0.18 + depth * 0.82) * grow * (0.72 + 0.28 * sin(uTime * 0.8 + aExtra.x * 24.0));
      gl_PointSize = uSize * uDpr * persp * (0.65 + 0.7 * aExtra.x) * (1.0 + uLevel * 0.22);
    }`;
  const fragment = `
    precision highp float;
    varying float vAlpha, vWarm;
    uniform float uLevel;
    void main(){
      vec2 d = gl_PointCoord - 0.5;
      float r2 = dot(d, d);
      if (r2 > 0.25) discard;
      float a = smoothstep(0.25, 0.02, r2);
      vec3 gold = vec3(0.94, 0.78, 0.47);
      vec3 copper = vec3(0.72, 0.33, 0.22);
      vec3 c = mix(gold, copper, vWarm) * (1.0 + uLevel * 0.55);
      gl_FragColor = vec4(c, a * vAlpha * 0.85);
    }`;

  function compile(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }
  let program;
  try {
    program = gl.createProgram();
    gl.attachShader(program, compile(gl.VERTEX_SHADER, vertex));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragment));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
  } catch (e) { canvas.dataset.fallback = '1'; console.error('lattice:', e && e.message); return; }
  gl.useProgram(program);

  const pts = [];
  const GOLDEN = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < 1500; i++) {
    const y = 1 - (i / 1499) * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const a = GOLDEN * i;
    const band = 0.86 + 0.14 * Math.abs(Math.cos(y * 5.2));
    pts.push(Math.cos(a) * r * band, y * band, Math.sin(a) * r * band,
             Math.random(), Math.random() < 0.07 ? 1 : 0);
  }
  for (let orbit = 0; orbit < 3; orbit++) {
    const tilt = 0.35 + orbit * 0.72, spin = orbit * 2.1;
    for (let i = 0; i < 240; i++) {
      const a = (i / 240) * Math.PI * 2;
      const x = Math.cos(a), z = Math.sin(a);
      pts.push(x * 1.06,
               (z * Math.sin(tilt)) * 1.06 + spin * 0,
               z * Math.cos(tilt) * 1.06,
               0.5 + 0.5 * Math.sin(a), 0.35);
    }
  }
  const data = new Float32Array(pts);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(program, 'aPos');
  const aExtra = gl.getAttribLocation(program, 'aExtra');
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 20, 0);
  gl.enableVertexAttribArray(aExtra);
  gl.vertexAttribPointer(aExtra, 2, gl.FLOAT, false, 20, 12);

  const u = {};
  for (const name of ['uYaw', 'uPitch', 'uTime', 'uRad', 'uSize', 'uLevel', 'uGrow', 'uDpr', 'uShift', 'uRes'])
    u[name] = gl.getUniformLocation(program, name);

  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
  gl.clearColor(0, 0, 0, 0);

  let dpr = Math.min(window.devicePixelRatio || 1, 2);
  let width = 0, height = 0;
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = canvas.clientWidth; height = canvas.clientHeight;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    gl.viewport(0, 0, canvas.width, canvas.height);
  }
  resize();
  addEventListener('resize', resize, { passive: true });

  const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
  addEventListener('pointermove', (e) => {
    pointer.tx = (e.clientX / innerWidth - 0.5) * 2;
    pointer.ty = (e.clientY / innerHeight - 0.5) * 2;
  }, { passive: true });

  let level = 0, levelTarget = 0, playing = false;
  const start = performance.now();
  let yaw = 0.6;

  function frame(now) {
    const t = (now - start) / 1000;
    const grow = Math.min(1, t / 1.6);
    const small = width < 860;
    pointer.x += (pointer.tx - pointer.x) * 0.045;
    pointer.y += (pointer.ty - pointer.y) * 0.045;
    level += (levelTarget - level) * 0.08;
    if (playing) yaw += 0.0008;
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform1f(u.uYaw, yaw + t * (reduced ? 0 : 0.055) + pointer.x * 0.22);
    gl.uniform1f(u.uPitch, 0.2 + Math.sin(t * 0.11) * 0.1 + pointer.y * 0.12);
    gl.uniform1f(u.uTime, t);
    gl.uniform1f(u.uRad, small ? 0.62 : 0.66);
    gl.uniform1f(u.uSize, small ? 1.9 : 2.35);
    gl.uniform1f(u.uLevel, level);
    gl.uniform1f(u.uGrow, grow);
    gl.uniform1f(u.uDpr, dpr);
    gl.uniform2f(u.uShift, small ? 0.08 : 0.46, small ? 0.1 : 0.02);
    gl.uniform2f(u.uRes, width, height);
    gl.drawArrays(gl.POINTS, 0, data.length / 5);
    if (!reduced) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  if (reduced) requestAnimationFrame(() => requestAnimationFrame(frame));

  window.Lattice = {
    setLevel(v) { levelTarget = Math.max(0, Math.min(1, v)); },
    setPlaying(v) { playing = !!v; },
  };
})();
