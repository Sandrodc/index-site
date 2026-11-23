// Index stone: the granite tablet from proto/stone, packaged so the site can mount it twice.
//   createStone(canvas, { mode: 'hero' })   runic inscription that decodes to INDEX, tap by tap
//   createStone(canvas, { mode: 'carve' })  an empty face; stone.engrave(name) carves a name into it
// Rendering, material and carving are the prototype's; page-specific chrome (panel, picker, wheel) is gone.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const REDUCE = matchMedia('(prefers-reduced-motion: reduce)').matches;
const BASE = new URL('.', import.meta.url);

// stone canvas space (mm, from masks.json)
const MM_W = 1888, MM_H = 2360;
const W = MM_W / 1000, H = MM_H / 1000;

// ------------------------------------------------------------------ shared: fonts, geometry, sound
let shared;
function loadShared() {
  if (shared) return shared;
  shared = (async () => {
    const faces = [
      new FontFace('IxCinzel', `url(${new URL('fonts/Cinzel.woff2', BASE)})`, { weight: '400 900' }),
      new FontFace('IxRunic', `url(${new URL('fonts/NotoSansRunic-Regular.woff2', BASE)})`),
    ];
    await Promise.all(faces.map((f) => f.load().then((ff) => document.fonts.add(ff))));
    const gltf = await new GLTFLoader().loadAsync(new URL('models/granite.glb', BASE).href);
    let src; gltf.scene.traverse((o) => { if (o.isMesh && !src) src = o; });
    const geo = src.geometry;
    geo.setAttribute('cuv', geo.getAttribute('uv'));
    const col = geo.getAttribute('color');
    const fr = new Float32Array(geo.getAttribute('position').count);
    if (col) for (let i = 0; i < fr.length; i++) fr[i] = col.getX(i);
    geo.setAttribute('front', new THREE.BufferAttribute(fr, 1));
    if (col) geo.deleteAttribute('color');
    const pos = geo.getAttribute('position'); const zs = [];
    for (let i = 0; i < pos.count; i++) if (fr[i] > 0.5) zs.push(pos.getZ(i));
    zs.sort((a, b) => a - b);
    const faceZ = zs.length ? zs[Math.floor(zs.length * 0.5)] : 0.21;
    const off = new THREE.Vector3();
    geo.computeBoundingBox(); geo.boundingBox.getCenter(off);
    geo.translate(-off.x, -off.y, -off.z);
    // Outline of the front face (convex hull of its vertices in XY), for picking: testing the pointer against
    // the full 160k-triangle mesh cost 13–27 ms per move and made the hero judder while the mouse moved.
    const pts = [];
    for (let i = 0; i < pos.count; i++) if (fr[i] > 0.5) pts.push([pos.getX(i), pos.getY(i)]);
    const hull = convexHull(pts);
    return { geo, faceZ, off, hull };
  })();
  return shared;
}

// Andrew's monotone chain; returns the hull counter-clockwise
function convexHull(p) {
  p.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const q of p) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}
function inConvex(h, x, y) {
  for (let i = 0, n = h.length; i < n; i++) {
    const a = h[i], b = h[(i + 1) % n];
    if ((b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]) < 0) return false;
  }
  return true;
}

const sound = { on: true, ctx: null, master: null, noise: null };
export function setSound(on) { sound.on = on; }
function ac() {
  if (!sound.ctx) {
    const C = window.AudioContext || window.webkitAudioContext; if (!C) return null;
    sound.ctx = new C(); sound.master = sound.ctx.createGain(); sound.master.gain.value = 0.4; sound.master.connect(sound.ctx.destination);
    const b = sound.ctx.createBuffer(1, sound.ctx.sampleRate, sound.ctx.sampleRate); const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; sound.noise = b;
  }
  if (sound.ctx.state === 'suspended') sound.ctx.resume();
  return sound.ctx;
}
function env(g, t, a, peak, dec) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + dec); }
function noiseSrc(a) { const s = a.createBufferSource(); s.buffer = sound.noise; s.loop = true; return s; }
const sfx = {
  knock(pitch = 1, vol = 1) {
    if (!sound.on) return; const a = ac(); if (!a) return; const t = a.currentTime;
    const n = noiseSrc(a), bp = a.createBiquadFilter(), g = a.createGain();
    bp.type = 'bandpass'; bp.frequency.value = 2600 * pitch; bp.Q.value = 1.4;
    n.connect(bp).connect(g).connect(sound.master); env(g, t, 0.002, 0.5 * vol, 0.07); n.start(t, Math.random()); n.stop(t + 0.12);
    const o = a.createOscillator(), og = a.createGain(); o.type = 'sine';
    o.frequency.setValueAtTime(170 * pitch, t); o.frequency.exponentialRampToValueAtTime(70, t + 0.12);
    o.connect(og).connect(sound.master); env(og, t, 0.003, 0.35 * vol, 0.14); o.start(t); o.stop(t + 0.2);
  },
  crumble() {
    if (!sound.on) return; const a = ac(); if (!a) return; const t = a.currentTime;
    const n = noiseSrc(a), f = a.createBiquadFilter(), g = a.createGain(); f.type = 'lowpass'; f.frequency.value = 1400;
    n.connect(f).connect(g).connect(sound.master); env(g, t, 0.02, 0.12, 0.35); n.start(t, Math.random()); n.stop(t + 0.45);
  },
  sizzle(dur) {
    if (!sound.on) return; const a = ac(); if (!a) return; const t = a.currentTime;
    const n = noiseSrc(a), hp = a.createBiquadFilter(), g = a.createGain(); hp.type = 'highpass'; hp.frequency.value = 3800;
    n.connect(hp).connect(g).connect(sound.master);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.09, t + 0.04);
    g.gain.setValueAtTime(0.09, t + Math.max(0.05, dur - 0.1)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.15);
    n.start(t, Math.random()); n.stop(t + dur + 0.2);
  },
  thud() {
    if (!sound.on) return; const a = ac(); if (!a) return; const t = a.currentTime;
    const o = a.createOscillator(), g = a.createGain(); o.type = 'sine';
    o.frequency.setValueAtTime(120, t); o.frequency.exponentialRampToValueAtTime(55, t + 0.2);
    o.connect(g).connect(sound.master); env(g, t, 0.004, 0.4, 0.22); o.start(t); o.stop(t + 0.3);
  },
  chime(i = 0) {
    if (!sound.on) return; const a = ac(); if (!a) return; const t = a.currentTime;
    const scale = [523.25, 587.33, 659.25, 783.99, 880, 1046.5];
    const f0 = scale[((i % scale.length) + scale.length) % scale.length];
    for (const [m, v] of [[1, 0.12], [2.01, 0.04], [3.02, 0.015]]) {
      const o = a.createOscillator(), g = a.createGain(); o.type = 'sine'; o.frequency.value = f0 * m;
      o.connect(g).connect(sound.master); env(g, t, 0.005, v, 1.6); o.start(t); o.stop(t + 1.8);
    }
  },
};

const E = {
  out: (t) => 1 - Math.pow(1 - t, 3), outQuint: (t) => 1 - Math.pow(1 - t, 5),
  inOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  in: (t) => t * t * t, lin: (t) => t,
};

// ------------------------------------------------------------------ one stone
export function createStone(canvas, opts = {}) {
  const mode = opts.mode || 'hero';
  // carve texture resolution: res 2 doubles the depth map, so engraved edges stay crisp up close
  const RES = opts.res ?? 1;
  const CW = Math.round(1536 * RES), CH = Math.round(1920 * RES), S = CW / MM_W;
  const GW = Math.round(CW / 4), GH = Math.round(CH / 4);
  // look: 'cinematic' rakes a narrow warm key across the face, a cool rim on the edge, deep shadows
  const CINE = opts.look === 'cinematic';
  const P = { tilt: opts.tilt ?? 12, follow: 90, graze: opts.graze ?? 30, light: opts.light ?? 1, depth: 8, recoil: 1, speed: 1 };
  const shift = opts.shift || (() => 0);   // fraction of the canvas width to push the stone right
  const fit = opts.fit || (() => 0.64);    // fraction of the canvas height the stone fills
  const lift = opts.lift || (() => 0);     // fraction of the half-height to push the stone up
  // frame(w, h) → { x, y, scale }: the stone's centre in canvas px and px per metre. Overrides fit/shift/lift,
  // so a canvas can cover only what's on screen instead of the whole (cropped) stone.
  const frameFn = opts.frame || null;
  let curSh = 0, curLf = 0;
  const hooks = { onStep: opts.onStep || (() => {}), onReady: opts.onReady || (() => {}), onLight: opts.onLight || null };
  // transparent: render straight to an alpha canvas (no bloom pass, which would flatten alpha) so the page's lit backdrop shows behind the stone
  const transparent = !!opts.transparent;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: transparent, powerPreference: 'high-performance' });
  if (transparent) renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  const PX_BUDGET = opts.pixelBudget ?? 5.5e6;   // device pixels per frame; 1440×940 at 2× is 5.4M
  let quality = 1;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = opts.exposure ?? 1;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  if (!transparent) scene.background = new THREE.Color(opts.background ?? 0x000000); // pure black: that canvas uses mix-blend-mode: lighten, so black drops out into the page
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = CINE ? 0.18 : 0.6;   // cinematic: let the shadows go properly dark

  const camera = new THREE.PerspectiveCamera(26, 1, 0.1, 60);
  const camRest = new THREE.Vector3();
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.2, 0.35, 0.9);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  // Bloom costs more than half the frame and only shows on glowing things (taps, carving), so it runs only then:
  // bloomK eases in when something glows and out after; at 0 the scene renders straight to the canvas (same look).
  let bloomK = 0;
  const draw = () => (transparent || bloomK < 0.005 ? renderer.render(scene, camera) : composer.render());

  const key = new THREE.SpotLight(0xfff1e2, 100, 0, CINE ? 0.19 : 0.34, CINE ? 0.8 : 0.9, 2);
  key.castShadow = true; key.shadow.mapSize.set(CINE ? 4096 : 2048, CINE ? 4096 : 2048);
  key.shadow.bias = -0.0004; key.shadow.normalBias = 0.02;
  key.shadow.camera.near = 2; key.shadow.camera.far = 12;
  scene.add(key, key.target);
  const rim = new THREE.DirectionalLight(0x9fb4ff, 0.35); rim.position.set(CINE ? 3.2 : 2.5, CINE ? 1.4 : 2.2, -3); scene.add(rim);
  const hemi = new THREE.HemisphereLight(0x9aa4b8, 0x080808, 0.05); scene.add(hemi);
  const lantern = new THREE.PointLight(0xffcf9a, 0, 0, 2);
  lantern.castShadow = true; lantern.shadow.mapSize.set(1024, 1024); lantern.shadow.bias = -0.002; scene.add(lantern);
  const laser = new THREE.PointLight(0xff8a3d, 0, 0, 2); scene.add(laser);

  // carve + glow canvases
  const depthCanvas = Object.assign(document.createElement('canvas'), { width: CW, height: CH });
  const dctx = depthCanvas.getContext('2d');
  const glowRaw = Object.assign(document.createElement('canvas'), { width: GW, height: GH });
  const grctx = glowRaw.getContext('2d');
  const glowCanvas = Object.assign(document.createElement('canvas'), { width: GW, height: GH });
  const gctx = glowCanvas.getContext('2d');
  const measure = document.createElement('canvas').getContext('2d');
  const carveTex = new THREE.CanvasTexture(depthCanvas);
  const glowTex = new THREE.CanvasTexture(glowCanvas);
  for (const t of [carveTex, glowTex]) {
    t.flipY = false; t.generateMipmaps = false;
    t.minFilter = THREE.LinearFilter; t.magFilter = THREE.LinearFilter;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  }

  // granite material (verbatim from the prototype)
  const U = {
    uCarve: { value: carveTex }, uGlow: { value: glowTex },
    uTexel: { value: new THREE.Vector2(1 / CW, 1 / CH) }, uSize: { value: new THREE.Vector2(W, H) },
    uDepth: { value: P.depth / 1000 }, uLight: { value: new THREE.Vector3(0, 0, 5) },
    uGlowMode: { value: 0 }, uGlowGain: { value: 1 },
    uAlbedo: { value: opts.albedo ?? 1 }, uSpeck: { value: opts.speck ?? 160 },
  };
  const stoneMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7, metalness: 0, envMapIntensity: 0.15 });
  stoneMat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec2 cuv; attribute float front;
        varying vec2 vCuv; varying float vFront; varying vec3 vObj; varying vec3 vTv; varying vec3 vBv;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vCuv = cuv; vFront = front; vObj = position;
        vTv = normalize(normalMatrix * vec3(1.0, 0.0, 0.0));
        vBv = normalize(normalMatrix * vec3(0.0, 1.0, 0.0));`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D uCarve; uniform sampler2D uGlow; uniform vec2 uTexel; uniform vec2 uSize;
        uniform float uDepth; uniform vec3 uLight; uniform float uGlowMode; uniform float uGlowGain; uniform float uAlbedo; uniform float uSpeck;
        varying vec2 vCuv; varying float vFront; varying vec3 vObj; varying vec3 vTv; varying vec3 vBv;
        float hsh(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
        float vn(vec3 x){ vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(mix(hsh(i), hsh(i + vec3(1,0,0)), f.x), mix(hsh(i + vec3(0,1,0)), hsh(i + vec3(1,1,0)), f.x), f.y),
                     mix(mix(hsh(i + vec3(0,0,1)), hsh(i + vec3(1,0,1)), f.x), mix(hsh(i + vec3(0,1,1)), hsh(i + vec3(1,1,1)), f.x), f.y), f.z); }
        float carveAt(vec2 uv){ return texture2D(uCarve, uv).r; }
        vec3 engine(float t){ t = clamp(t, 0.0, 1.0);
          vec3 a = vec3(0.949, 0.820, 0.420), b = vec3(0.404, 0.780, 0.890), c = vec3(0.455, 0.878, 0.561);
          return t < 0.55 ? mix(a, b, t / 0.55) : mix(b, c, (t - 0.55) / 0.45); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float fw = smoothstep(0.5, 0.9, vFront);
        vec3 P3 = vObj;
        float m = vn(P3 * 6.0) * 0.5 + vn(P3 * 21.0) * 0.32 + vn(P3 * 57.0) * 0.18;
        float filt = clamp(length(fwidth(P3)) * uSpeck, 0.0, 1.0);
        float wf = mix(smoothstep(0.83, 0.9, vn(P3 * 170.0)), 0.04, filt);
        float kf = mix(smoothstep(0.72, 0.80, vn(P3 * 120.0 + 11.0)), 0.12, filt * 0.8);
        vec3 gran = vec3(mix(0.03, 0.075, m)) * vec3(0.98, 0.99, 1.03) * uAlbedo;   // albedo lifts the body, not the flecks
        gran *= 1.0 - 0.55 * kf;
        gran += vec3(0.2, 0.195, 0.19) * wf;
        gran = mix(gran * 0.7, gran, fw);
        float hC = fw > 0.01 ? carveAt(vCuv) : 0.0;
        gran = mix(gran, gran * 1.45 + 0.03, smoothstep(0.04, 0.35, hC) * fw);
        gran *= 1.0 - 0.3 * hC * fw;
        diffuseColor.rgb = gran;`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(0.92, 0.58, fw);
        roughnessFactor = mix(roughnessFactor, 0.95, smoothstep(0.05, 0.3, hC) * fw);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        if (fw > 0.01) {
          float hl = carveAt(vCuv - vec2(uTexel.x, 0.0)), hr = carveAt(vCuv + vec2(uTexel.x, 0.0));
          float hu = carveAt(vCuv - vec2(0.0, uTexel.y)), hd = carveAt(vCuv + vec2(0.0, uTexel.y));
          float gx = (hr - hl) * uDepth / (2.0 * uTexel.x * uSize.x);
          float gy = (hu - hd) * uDepth / (2.0 * uTexel.y * uSize.y);
          vec3 pn = normalize(normal + vTv * gx + vBv * gy);
          normal = normalize(mix(normal, pn, fw));
        }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        if (uGlowMode > 0.5) {
          float g = texture2D(uGlow, vCuv).r * fw;
          float boost = 0.35 + 1.4 * smoothstep(0.03, 0.3, hC);
          vec3 gc;
          if (uGlowMode < 1.5) gc = vec3(1.0, 0.25, 0.04) * smoothstep(0.0, 0.45, g) + vec3(1.0, 0.6, 0.2) * smoothstep(0.35, 0.8, g) + vec3(0.5, 0.45, 0.35) * smoothstep(0.75, 1.0, g);
          else if (uGlowMode < 2.5) gc = engine(vCuv.x * 1.6 - 0.3) * 1.4;
          else gc = vec3(1.0, 0.86, 0.66) * smoothstep(0.0, 0.5, g) + vec3(0.6, 0.62, 0.7) * smoothstep(0.5, 1.0, g);
          totalEmissiveRadiance += gc * g * boost * uGlowGain;
        }`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        if (fw > 0.01 && hC > 0.01) {
          vec3 L = normalize(uLight - vObj);
          float lxy = length(L.xy);
          float sh = 1.0;
          if (lxy > 1e-3) {
            vec2 d = L.xy / lxy; float tanE = L.z / lxy;
            if (tanE <= 0.0) sh = 0.0;
            else {
              float maxS = min(hC * uDepth / tanE, 0.05);
              float occ = 0.0;
              for (int i = 1; i <= 10; i++) {
                float s = maxS * float(i) / 10.0;
                float hs = carveAt(vCuv + vec2(d.x / uSize.x, -d.y / uSize.y) * s);
                occ = max(occ, smoothstep(0.0, 0.0012, (hC * uDepth - s * tanE) - hs * uDepth));
              }
              sh = 1.0 - 0.9 * occ;
            }
          }
          sh = mix(1.0, sh, fw);
          reflectedLight.directDiffuse *= sh; reflectedLight.directSpecular *= sh;
        }`);
  };

  // particles
  const NP = 1400;
  const pPos = new Float32Array(NP * 3), pVel = new Float32Array(NP * 3), pCol = new Float32Array(NP * 3);
  const pA = new Float32Array(NP), pSize = new Float32Array(NP), pLife = new Float32Array(NP), pMax = new Float32Array(NP), pG = new Float32Array(NP), pDrag = new Float32Array(NP), pA0 = new Float32Array(NP);
  let pHead = 0, pHeadSeen = 0;
  const pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3).setUsage(THREE.DynamicDrawUsage));
  pGeo.setAttribute('aColor', new THREE.BufferAttribute(pCol, 3).setUsage(THREE.DynamicDrawUsage));
  pGeo.setAttribute('aAlpha', new THREE.BufferAttribute(pA, 1).setUsage(THREE.DynamicDrawUsage));
  pGeo.setAttribute('aSize', new THREE.BufferAttribute(pSize, 1).setUsage(THREE.DynamicDrawUsage));
  const pUni = { uScale: { value: 500 } };
  const points = new THREE.Points(pGeo, new THREE.ShaderMaterial({
    uniforms: pUni, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `uniform float uScale; attribute vec3 aColor; attribute float aAlpha; attribute float aSize;
      varying vec3 vC; varying float vA;
      void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv;
        gl_PointSize = aSize * uScale / -mv.z; vC = aColor; vA = aAlpha; }`,
    fragmentShader: `varying vec3 vC; varying float vA;
      void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.05, d) * vA; if (a < 0.003) discard; gl_FragColor = vec4(vC, a); }`,
  }));
  points.frustumCulled = false; scene.add(points);

  const KINDS = {
    dust:  { n: [0.25, 0.9], spread: 0.55, g: -1.1, drag: 2.2, life: [0.9, 1.7], size: [0.012, 0.03], col: [0.5, 0.48, 0.45], a: 0.32 },
    chip:  { n: [0.6, 1.5],  spread: 0.9,  g: -6.0, drag: 0.6, life: [0.35, 0.7], size: [0.006, 0.012], col: [0.7, 0.68, 0.64], a: 0.5 },
    spark: { n: [1.0, 2.6],  spread: 1.3,  g: -5.5, drag: 0.9, life: [0.25, 0.7], size: [0.004, 0.009], col: [1.5, 0.62, 0.16], a: 0.7 },
    mote:  { n: [0.05, 0.25], spread: 0.25, g: 0.18, drag: 1.4, life: [1.4, 2.6], size: [0.008, 0.02], col: [0.9, 1.0, 1.15], a: 0.7 },
  };
  const _v = new THREE.Vector3(), _n = new THREE.Vector3();
  function emit(local, count, kind) {
    if (REDUCE) count = Math.ceil(count / 3);
    const K = KINDS[kind];
    stone.updateMatrixWorld();
    _v.copy(local).applyMatrix4(stone.matrixWorld);
    _n.set(0, 0, 1).applyQuaternion(stone.quaternion);
    for (let c = 0; c < count; c++) {
      const i = pHead; pHead = (pHead + 1) % NP;
      const r = (a, b) => a + Math.random() * (b - a);
      pPos[i * 3] = _v.x + r(-0.02, 0.02); pPos[i * 3 + 1] = _v.y + r(-0.02, 0.02); pPos[i * 3 + 2] = _v.z + 0.004;
      const sp = r(K.n[0], K.n[1]);
      pVel[i * 3] = _n.x * sp + r(-1, 1) * K.spread;
      pVel[i * 3 + 1] = _n.y * sp + r(-0.4, 1) * K.spread;
      pVel[i * 3 + 2] = _n.z * sp + r(-0.2, 0.6) * K.spread * 0.5;
      const tint = r(0.75, 1.15);
      pCol[i * 3] = K.col[0] * tint; pCol[i * 3 + 1] = K.col[1] * tint; pCol[i * 3 + 2] = K.col[2] * tint;
      pMax[i] = pLife[i] = r(K.life[0], K.life[1]);
      pSize[i] = r(K.size[0], K.size[1]);
      pG[i] = K.g; pDrag[i] = K.drag; pA0[i] = K.a * r(0.5, 1);
    }
  }
  let alive = 0;   // particles still in flight (keeps the loop at full rate while they move)
  function stepParticles(dt) {
    if (!alive && pHeadSeen === pHead) return;   // nothing in flight and nothing new: skip the loop and the uploads
    pHeadSeen = pHead; alive = 0;
    for (let i = 0; i < NP; i++) {
      if (pLife[i] <= 0) { pA[i] = 0; continue; }
      alive++;
      pLife[i] -= dt;
      const d = Math.exp(-pDrag[i] * dt);
      pVel[i * 3] *= d; pVel[i * 3 + 1] = pVel[i * 3 + 1] * d + pG[i] * dt; pVel[i * 3 + 2] *= d;
      pPos[i * 3] += pVel[i * 3] * dt; pPos[i * 3 + 1] += pVel[i * 3 + 1] * dt; pPos[i * 3 + 2] += pVel[i * 3 + 2] * dt;
      const k = Math.max(0, pLife[i] / pMax[i]);
      pA[i] = pA0[i] * Math.min(1, k * 2.5) * Math.min(1, (1 - k) * 12 + 0.2);
    }
    for (const n of ['position', 'aAlpha', 'aColor', 'aSize']) pGeo.attributes[n].needsUpdate = true;
  }

  // ambient motes in the beam
  const NM = 90;
  const mPos = new Float32Array(NM * 3), mSeed = new Float32Array(NM);
  for (let i = 0; i < NM; i++) {
    mPos[i * 3] = (Math.random() - 0.5) * 4; mPos[i * 3 + 1] = (Math.random() - 0.5) * 3.4; mPos[i * 3 + 2] = Math.random() * 2.2 - 0.3;
    mSeed[i] = Math.random();
  }
  const mGeo = new THREE.BufferGeometry();
  mGeo.setAttribute('position', new THREE.BufferAttribute(mPos, 3));
  mGeo.setAttribute('seed', new THREE.BufferAttribute(mSeed, 1));
  const mUni = { uScale: pUni.uScale, uT: { value: 0 }, uLP: { value: new THREE.Vector3() }, uLD: { value: new THREE.Vector3() }, uMode: { value: 0 }, uGain: { value: 1 } };
  const motes = new THREE.Points(mGeo, new THREE.ShaderMaterial({
    uniforms: mUni, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `uniform float uScale, uT, uMode, uGain; uniform vec3 uLP, uLD; attribute float seed; varying float vA;
      void main(){ vec3 p = position;
        p.x += sin(uT * 0.11 + seed * 40.0) * 0.18; p.y += mod(uT * 0.025 * (0.5 + seed) + seed * 3.4, 3.4) - 1.7; p.z += cos(uT * 0.09 + seed * 21.0) * 0.12;
        vec3 toP = normalize(p - uLP); float beam;
        if (uMode < 0.5) beam = smoothstep(0.985, 0.998, dot(toP, uLD)) * step(0.15, p.z); else beam = smoothstep(1.1, 0.2, distance(p, uLP));
        vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * mv;
        gl_PointSize = (0.006 + seed * 0.008) * uScale / -mv.z;
        vA = beam * (0.25 + 0.75 * fract(seed * 7.13)) * 0.35 * uGain; }`,
    fragmentShader: `varying float vA; void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, d) * vA; if (a < 0.003) discard; gl_FragColor = vec4(vec3(1.0, 0.96, 0.9), a); }`,
  }));
  motes.frustumCulled = false; scene.add(motes);

  // stone object
  const stone = new THREE.Group();
  stone.rotation.order = 'YXZ'; scene.add(stone);
  let mesh, OFF = new THREE.Vector3(), FACE_Z = 0.21;
  const REST = opts.rest || { x: -0.04, y: -0.14, z: 0.05 };
  function mmToLocal(mx, my, out = new THREE.Vector3()) {
    return out.set(mx / 1000 - W / 2 - OFF.x, H / 2 - my / 1000 - OFF.y, FACE_Z - OFF.z);
  }

  // glyphs
  const glyphs = [];
  let dirty = true, dirtyGlow = true;   // dirty: the carve depth map (3072×3840 at res 2, costly to upload); dirtyGlow: the small glow map
  const hot = [];
  const fontStr = (f, sizeMM) => `${f.weight || 400} ${(sizeMM * S).toFixed(2)}px ${f.family}`;
  function advanceMM(ch, f, sizeMM) { measure.font = fontStr(f, sizeMM); return measure.measureText(ch).width / S; }
  function runWidthMM(chars, f, sizeMM, track) { return chars.reduce((a, c) => a + advanceMM(c, f, sizeMM), 0) + track * Math.max(0, chars.length - 1); }

  function makeGlyph(ch, f, sizeMM, xMM, baseMM, extra = {}) {
    const px = sizeMM * S;
    measure.font = fontStr(f, sizeMM);
    const m = measure.measureText(ch);
    const l = Math.ceil(m.actualBoundingBoxLeft), r = Math.ceil(m.actualBoundingBoxRight);
    const asc = Math.ceil(m.actualBoundingBoxAscent), desc = Math.ceil(m.actualBoundingBoxDescent);
    const blur = Math.max(1.1, px * (f.bevel || 0.016));
    const pad = Math.ceil(blur * 3 + 2);
    const w = l + r + pad * 2, h = asc + desc + pad * 2;
    const sharp = Object.assign(document.createElement('canvas'), { width: w, height: h });
    const sc = sharp.getContext('2d');
    sc.font = measure.font; sc.fillStyle = '#fff'; sc.fillText(ch, pad + l, pad + asc);
    const stamp = Object.assign(document.createElement('canvas'), { width: w, height: h });
    const st = stamp.getContext('2d', { willReadFrequently: true });
    st.filter = `blur(${blur}px)`; st.drawImage(sharp, 0, 0); st.filter = 'none';
    st.drawImage(sharp, 0, 0);
    st.globalCompositeOperation = 'destination-in'; st.drawImage(sharp, 0, 0);
    const id = st.getImageData(0, 0, w, h); const d = id.data; let mx = 1;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 0) mx = Math.max(mx, d[i - 3] * d[i] / 255);
    for (let i = 0; i < d.length; i += 4) { const v = Math.min(255, (d[i] * d[i + 3] / 255) * 255 / mx * 1.1); d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255; }
    st.putImageData(id, 0, 0);
    const x0 = xMM * S - l - pad, y0 = baseMM * S - asc - pad;
    const cxMM = (x0 + w / 2) / S, cyMM = (y0 + h / 2) / S;
    const g = { ch, stamp, x0, y0, w, h, depth: 0, heat: 0, clip: 1, cxMM, cyMM, wMM: w / S, leftMM: x0 / S, local: mmToLocal(cxMM, cyMM), ...extra };
    if (!extra.detached) glyphs.push(g);   // detached: prepared ahead, added when the carving starts
    return g;
  }

  function compose(doCarve, doGlow) {
    if (doCarve) {
      dctx.globalCompositeOperation = 'source-over'; dctx.globalAlpha = 1;
      dctx.fillStyle = '#000'; dctx.fillRect(0, 0, CW, CH);
      dctx.globalCompositeOperation = 'lighter';
      for (const g of glyphs) {
        if (g.depth <= 0.002) continue;
        const clipped = g.clip < 0.999;
        dctx.globalAlpha = Math.min(1, g.depth);
        if (clipped) { dctx.save(); dctx.beginPath(); dctx.rect(g.x0, g.y0, g.w * g.clip, g.h); dctx.clip(); }
        dctx.drawImage(g.stamp, g.x0, g.y0);
        if (clipped) dctx.restore();
      }
      carveTex.needsUpdate = true;
    }
    if (!doGlow) return;
    grctx.globalCompositeOperation = 'source-over'; grctx.globalAlpha = 1;
    grctx.fillStyle = '#000'; grctx.fillRect(0, 0, GW, GH);
    grctx.globalCompositeOperation = 'lighter';
    for (const g of glyphs) {
      const clipped = g.clip < 0.999;
      if (g.heat > 0.002) {
        grctx.globalAlpha = Math.min(1, g.heat);
        if (clipped) { grctx.save(); grctx.beginPath(); grctx.rect(g.x0 / 4, g.y0 / 4, g.w * g.clip / 4, g.h / 4); grctx.clip(); }
        grctx.drawImage(g.stamp, g.x0 / 4, g.y0 / 4, g.w / 4, g.h / 4);
        if (clipped) grctx.restore();
      }
    }
    for (const s of hot) {
      if (s.heat <= 0.002) continue;
      const x = s.u * GW, y = s.v * GH, r = 26 * RES * (s.r || 1);
      const gr = grctx.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, `rgba(255,255,255,${s.heat})`); gr.addColorStop(1, 'rgba(255,255,255,0)');
      grctx.globalAlpha = 1; grctx.fillStyle = gr; grctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    gctx.globalCompositeOperation = 'source-over'; gctx.globalAlpha = 1; gctx.filter = 'blur(3px)';
    gctx.drawImage(glowRaw, 0, 0); gctx.filter = 'none';
    gctx.globalCompositeOperation = 'lighter'; gctx.globalAlpha = 0.7; gctx.drawImage(glowRaw, 0, 0);
    glowTex.needsUpdate = true;
  }

  // inscription (hero)
  const RUNE = { family: 'IxRunic', weight: 400, bevel: 0.02 };
  const CINZEL = (w) => ({ family: 'IxCinzel', weight: w, bevel: 0.014 });
  let STEPS = [];
  function layoutLine(units, rf, rs, rt, lf, ls, lt, gap, base) {
    const meas = units.map(([r, l]) => {
      const rc = [...r], lc = [...l];
      const rw = runWidthMM(rc, rf, rs, rt), lw = runWidthMM(lc, lf, ls, lt);
      return { rc, lc, rw, lw, slot: Math.max(rw, lw) };
    });
    const total = meas.reduce((a, m) => a + m.slot, 0) + gap * (units.length - 1);
    let x = (MM_W - total) / 2;
    return meas.map((m) => {
      const u = { runes: [], latin: [] };
      let rx = x + (m.slot - m.rw) / 2;
      for (const c of m.rc) { u.runes.push(makeGlyph(c, rf, rs, rx, base)); rx += advanceMM(c, rf, rs) + rt; }
      let lx = x + (m.slot - m.lw) / 2;
      for (const c of m.lc) { u.latin.push(makeGlyph(c, lf, ls, lx, base)); lx += advanceMM(c, lf, ls) + lt; }
      x += m.slot + gap;
      return u;
    });
  }
  function buildInscription() {
    glyphs.length = 0;
    // ᛁᚾᛞᛖᚲᛋ -> INDEX, one slot per tap; ᚲᛋ (k+s) collapses into X
    const line1 = layoutLine([['ᛁ', 'I'], ['ᚾ', 'N'], ['ᛞ', 'D'], ['ᛖ', 'E'], ['ᚲᛋ', 'X']], RUNE, 210, 14, CINZEL(800), 196, 28, 34, 1130);
    const line2 = layoutLine([['ᚲᛖᛖᛈ', 'KEEP'], ['ᚹᚺᚨᛏ', 'WHAT'], ['ᛃᛟᚢ', 'YOU'], ['ᚱᛖᚨᛞ', 'READ']], RUNE, 84, 8, CINZEL(800), 60, 10, 46, 1340);
    for (const u of [...line1, ...line2]) u.runes.forEach((g) => (g.depth = 1));
    STEPS = [...line1.map((u) => [u]), line2];
  }

  // the name, fitted to the face and centred on it: shrink first, then break onto two lines
  // a generator: yields after each glyph, so prepare() can spread the (costly) stamp drawing over idle time
  function* layoutNameSteps(name, out) {
    // sizes in mm on a 1888 mm wide face. nameSize = the largest a short name gets; a long name shrinks
    // only to 60% of that before it breaks onto two lines, so names stay big rather than turning into a thin strip
    const f = CINZEL(700), maxW = opts.nameWidth ?? 900, big = opts.nameSize ?? 110;
    const tr = (sz) => sz * 0.07;
    const text = name.trim().replace(/\s+/g, ' ').toUpperCase();
    let size = big, lines = [text];
    const floor1 = text.includes(' ') ? big * 0.6 : 54;   // a single word can't break, so it may shrink further
    while (size > floor1 && runWidthMM([...text], f, size, tr(size)) > maxW) size -= 2;
    if (runWidthMM([...text], f, size, tr(size)) > maxW) {
      const mid = text.length / 2; let cut = -1, best = 1e9;
      for (let i = 0; i < text.length; i++) if (text[i] === ' ' && Math.abs(i - mid) < best) { best = Math.abs(i - mid); cut = i; }
      lines = cut > 0 ? [text.slice(0, cut), text.slice(cut + 1)] : [text.slice(0, Math.ceil(mid)), text.slice(Math.ceil(mid))];
      size = Math.round(big * 0.82);
      while (size > 40 && Math.max(...lines.map((l) => runWidthMM([...l], f, size, tr(size)))) > maxW) size -= 2;
    }
    const track = tr(size), ds = Math.round(Math.max(36, size * 0.3)), lineH = size * 1.18;
    const blockH = lines.length * lineH + 10 + ds;
    let base = 1220 - blockH / 2 + size * 0.85;
    for (const l of lines) {
      const chars = [...l]; let x = (MM_W - runWidthMM(chars, f, size, track)) / 2;
      for (const c of chars) { if (c !== ' ') { out.push(makeGlyph(c, f, size, x, base, { name: true, detached: true })); yield; } x += advanceMM(c, f, size) + track; }
      base += lineH;
    }
    const date = [...'· MMXXVI ·'], df = CINZEL(600), dt = 14;
    let x = (MM_W - runWidthMM(date, df, ds, dt)) / 2; base += Math.max(34, size * 0.26) + ds - lineH;
    for (const c of date) { if (c !== ' ') { out.push(makeGlyph(c, df, ds, x, base, { small: true, detached: true })); yield; } x += advanceMM(c, df, ds) + dt; }
  }
  const idle = window.requestIdleCallback || ((fn) => setTimeout(() => fn({ timeRemaining: () => 8 }), 16));
  let prepared = null;
  function prepare(name) {
    if (!name || prepared?.name === name) return;
    const p = (prepared = { name, out: [], steps: null, done: false });
    ready.then(() => {
      if (prepared !== p) return;
      p.steps = layoutNameSteps(name, p.out);
      const pump = (dl) => {
        if (prepared !== p) return;
        while (dl.timeRemaining() > 4) if (p.steps.next().done) { p.done = true; return; }
        idle(pump);
      };
      idle(pump);
    });
  }

  // tweens
  const tweens = [];
  function tw(obj, k, to, dur, o = {}) {
    const t = { obj, key: k, to, dur: Math.max(dur, 1e-4), delay: o.delay || 0, ease: o.ease || E.out, from: o.from, onStart: o.onStart, onUpdate: o.onUpdate, onDone: o.onDone, t: 0, started: false };
    tweens.push(t); return t;
  }
  function after(delay, fn) { tweens.push({ delay, timer: true, fn }); }
  function stepTweens(dt) {
    for (let i = 0; i < tweens.length; i++) {
      const t = tweens[i];
      if (t.done) continue;
      let local = dt;
      if (t.delay > 0) { t.delay -= dt; if (t.delay > 0) continue; local = -t.delay; t.delay = 0; }
      if (t.timer) { t.done = true; t.fn(); continue; }
      if (!t.started) { t.started = true; if (t.from === undefined) t.from = t.obj[t.key]; else t.obj[t.key] = t.from; t.onStart && t.onStart(); }
      t.t += local;
      const p = Math.min(1, t.t / t.dur);
      t.obj[t.key] = t.from + (t.to - t.from) * t.ease(p);
      t.onUpdate && t.onUpdate(p);
      if (t.key === 'depth' || t.key === 'clip') dirty = true;
      if (t.key === 'heat' || t.key === 'clip') dirtyGlow = true;
      if (p >= 1) { t.done = true; t.onDone && t.onDone(); }
    }
    for (let i = tweens.length - 1; i >= 0; i--) if (tweens[i].done) tweens.splice(i, 1);
  }

  // springs + motion state
  const mk = () => ({ x: 0, v: 0 });
  const fx = mk(), fy = mk(), kX = mk(), kY = mk(), kZ = mk(), spin = mk();
  function spring(s, target, k, ratio, dt) { const c = 2 * Math.sqrt(k) * ratio; s.v += (k * (target - s.x) - c * s.v) * dt; s.x += s.v * dt; }
  const FX = { intro: 0, grazeOff: 0, flare: 0, shake: 0, lock: 0, lanternOverride: 0, lx: 0, ly: 0 };
  function impulse(local, mag) { if (REDUCE) return; const m = mag * P.recoil; kY.v += local.x * m * 2.4; kX.v += -local.y * m * 2.0; kZ.v -= m * 0.35; }
  function shake(a) { if (!REDUCE) FX.shake = Math.max(FX.shake, a * P.recoil); }
  function laserAt(g, p) {
    const lp = mmToLocal(g.leftMM + g.wMM * p, g.cyMM).add(new THREE.Vector3(0, 0, 0.3));
    laser.position.copy(stone.localToWorld(lp)); laser.intensity = 0.015 * P.light * (0.85 + Math.random() * 0.3);
  }

  // variants (the prototype's three treatments)
  const VARIANTS = {
    chisel: {
      keyColor: 0xfff1e2, keyGain: 1, rim: 0.35, hemi: 0.05, env: 0.15, bloom: 0.12, glow: 0, tilt: 1, lantern: false, motes: 1,
      knock(p) { sfx.knock(0.9 + Math.random() * 0.25, 1); impulse(p, 1); emit(p, 16, 'dust'); emit(p, 8, 'chip'); shake(0.004); },
      swap(out, inn, d) {
        out.forEach((g, j) => tw(g, 'depth', 0, 0.42, { delay: d + j * 0.05, ease: E.inOut, onStart: () => { emit(g.local, 20, 'dust'); sfx.crumble(); } }));
        inn.forEach((g, j) => {
          for (let k = 1; k <= 3; k++) after(d + 0.5 + j * 0.3 + (k - 1) * 0.13, () => {
            tw(g, 'depth', k / 3, 0.06); emit(g.local, 8, 'chip'); emit(g.local, 5, 'dust');
            sfx.knock(1.1 + Math.random() * 0.2, 0.7); impulse(g.local, 0.3); shake(0.0022);
          });
        });
      },
      engrave(list, done) {
        let t = 0.2;
        list.forEach((g) => {
          const n = g.small ? 1 : 3;
          for (let k = 1; k <= n; k++) after(t + (k - 1) * 0.075, () => {
            tw(g, 'depth', k / n, 0.05); emit(g.local, g.small ? 4 : 7, 'chip'); emit(g.local, 4, 'dust');
            sfx.knock(1.05 + Math.random() * 0.3, g.small ? 0.4 : 0.6); impulse(g.local, 0.18); shake(0.0015);
          });
          t += g.small ? 0.09 : 0.22;
        });
        after(t + 0.3, done);
      },
    },
    ember: {
      keyColor: 0xffa66b, keyGain: 0.55, rim: 0.18, hemi: 0.03, env: 0.06, bloom: 0.55, glow: 1, tilt: 1, lantern: false, motes: 0.4,
      knock(p, uv) {
        sfx.thud(); impulse(p, 0.6); emit(p, 16, 'spark');
        if (uv) { const s = { u: uv.x, v: uv.y, heat: 1 }; hot.push(s); tw(s, 'heat', 0, 1.4, { onDone: () => hot.splice(hot.indexOf(s), 1) }); }
      },
      swap(out, inn, d) {
        out.forEach((g) => {
          tw(g, 'heat', 0.65, 0.25, { delay: d, onStart: () => emit(g.local, 10, 'spark') });
          tw(g, 'depth', 0, 0.55, { delay: d + 0.2, ease: E.in });
          tw(g, 'heat', 0, 0.8, { delay: d + 0.65 });
        });
        inn.forEach((g, j) => {
          tw(g, 'clip', 1, 0.45, { delay: d + 0.8 + j * 0.42, from: 0, ease: E.lin,
            onStart: () => { g.depth = 1; g.heat = 1; sfx.sizzle(0.45); },
            onUpdate: (p) => { laserAt(g, p); if (Math.random() < 0.35) emit(mmToLocal(g.leftMM + g.wMM * p, g.cyMM), 1, 'spark'); },
            onDone: () => { laser.intensity = 0; tw(g, 'heat', 0, 1.8, { ease: E.out }); } });
        });
      },
      engrave(list, done) {
        let t = 0.2, total = 0;
        list.forEach((g) => {
          const dur = g.wMM / 560 + 0.03; total += dur;
          tw(g, 'clip', 1, dur, { delay: t, from: 0, ease: E.lin,
            onStart: () => { g.depth = 1; g.heat = 1; },
            onUpdate: (p) => { laserAt(g, p); if (Math.random() < 0.35) emit(mmToLocal(g.leftMM + g.wMM * p, g.cyMM), 1, 'spark'); },
            onDone: () => tw(g, 'heat', 0, 2.0, { ease: E.out }) });
          t += dur + 0.025;
        });
        after(0.2, () => sfx.sizzle(total));
        after(t, () => { laser.intensity = 0; });
        after(t + 0.6, done);
      },
    },
    light: {
      keyColor: 0xffe6c7, keyGain: 1.15, rim: 0.9, hemi: 0.012, env: 0.08, bloom: 0.42, glow: 3, tilt: 1, lantern: false, motes: 1.4,
      knock(p, uv) {
        sfx.chime(Math.floor(Math.random() * 6)); impulse(p, 0.18);
        tw(FX, 'flare', 0, 1.1, { from: 1, ease: E.out }); emit(p, 18, 'mote');
        if (uv) { const s = { u: uv.x, v: uv.y, heat: 1, r: 1.6 }; hot.push(s); tw(s, 'heat', 0, 1.3, { ease: E.out, onDone: () => hot.splice(hot.indexOf(s), 1) }); }
      },
      swap(out, inn, d) { VARIANTS.lantern.swap(out, inn, d); },
      engrave(list, done) {
        let t = 0.2;
        list.forEach((g, i) => {
          tw(g, 'depth', 1, 0.9, { delay: t, ease: E.outQuint, onStart: () => { g.heat = 1; emit(g.local, 5, 'mote'); if (i % 3 === 0) sfx.chime(i / 3); } });
          tw(g, 'heat', 0, 2.2, { delay: t + 0.7, ease: E.inOut });
          t += g.small ? 0.05 : 0.11;
        });
        after(0.15, () => tw(FX, 'flare', 0, t + 0.8, { from: 0.7, ease: E.inOut }));
        after(t + 1.2, done);
      },
    },
    lantern: {
      keyColor: 0xffffff, keyGain: 0, rim: 0.08, hemi: 0.012, env: 0.02, bloom: 0.45, glow: 2, tilt: 0.55, lantern: true, motes: 1,
      knock(p) { sfx.chime(Math.floor(Math.random() * 6)); tw(FX, 'flare', 0, 0.9, { from: 1 }); emit(p, 14, 'mote'); impulse(p, 0.25); },
      swap(out, inn, d) {
        out.forEach((g) => {
          tw(g, 'heat', 0.8, 0.3, { delay: d, onStart: () => emit(g.local, 10, 'mote') });
          tw(g, 'depth', 0, 0.9, { delay: d + 0.1, ease: E.inOut });
          tw(g, 'heat', 0, 0.6, { delay: d + 0.8 });
        });
        inn.forEach((g, j) => {
          tw(g, 'depth', 1, 1.1, { delay: d + 0.6 + j * 0.08, ease: E.outQuint, onStart: () => { g.heat = 1; emit(g.local, 6, 'mote'); if (j === 0) sfx.chime(3); } });
          tw(g, 'heat', 0, 2.4, { delay: d + 1.2 + j * 0.08, ease: E.inOut });
        });
      },
      engrave(list, done) {
        const first = list[0], last = list.filter((g) => !g.small).at(-1) || first;
        const T = 0.09 * list.length + 1.2;
        FX.lanternOverride = 1; FX.lx = first.leftMM; FX.ly = first.cyMM;
        tw(FX, 'lx', last.leftMM + last.wMM, T, { ease: E.inOut, onUpdate: (p) => { FX.ly = first.cyMM + (last.cyMM - first.cyMM) * p; } });
        list.forEach((g, i) => {
          tw(g, 'depth', 1, 1.0, { delay: 0.15 + i * 0.09, ease: E.outQuint, onStart: () => { g.heat = 1; emit(g.local, 4, 'mote'); if (i % 4 === 0) sfx.chime(i / 4); } });
          tw(g, 'heat', 0, 2.6, { delay: 0.9 + i * 0.09, ease: E.inOut });
        });
        after(T + 0.2, () => { FX.lanternOverride = 0; });
        after(T + 0.8, done);
      },
    },
  };
  let V = VARIANTS[opts.variant] || VARIANTS.chisel;
  function applyVariant() {
    key.visible = !V.lantern; lantern.visible = V.lantern;
    key.color.set(V.keyColor);
    rim.intensity = V.rim; hemi.intensity = V.hemi;
    stoneMat.envMapIntensity = V.env; bloom.strength = V.bloom;
    U.uGlowMode.value = V.glow;
    mUni.uMode.value = V.lantern ? 1 : 0; mUni.uGain.value = V.motes;
  }

  // decode (hero) + engrave (carve)
  let step = 0, busy = false, nameGlyphs = [];
  function tap(local, uv) {
    V.knock(local, uv);
    if (mode !== 'hero' || step >= STEPS.length) return;
    const s = STEPS[step++];
    s.forEach((u, i) => V.swap(u.runes, u.latin, i * 0.22));
    hooks.onStep(step, STEPS.length);
    if (step === STEPS.length) after(2.4, glint);
  }
  function glint() {
    tw(FX, 'grazeOff', -22, 0.6, { ease: E.inOut });
    tw(FX, 'grazeOff', 20, 0.9, { delay: 0.6, ease: E.inOut });
    tw(FX, 'grazeOff', 0, 0.7, { delay: 1.5, ease: E.inOut });
    if (V.lantern) tw(FX, 'flare', 0, 1.6, { from: 1.2 });
  }
  function tapNext() {
    const target = STEPS[step]?.[0]?.runes[0];
    tap(target ? target.local.clone() : mmToLocal(944, 1220), target ? new THREE.Vector2(target.cxMM / MM_W, target.cyMM / MM_H) : null);
  }
  function engrave(name) {
    return new Promise((resolve) => {
      if (busy) return resolve(false);
      busy = true; ac();
      for (const g of nameGlyphs) glyphs.splice(glyphs.indexOf(g), 1);
      // use the glyphs prepared while the email was typed; finish (or do) whatever is left now
      let p = prepared?.name === name && prepared.steps ? prepared : null;
      if (!p) { const out = []; p = { out, steps: layoutNameSteps(name, out) }; }
      while (!p.steps.next().done);
      nameGlyphs = p.out; prepared = null;
      glyphs.push(...nameGlyphs); dirty = dirtyGlow = true;
      FX.lock = 1; wake();
      V.engrave(nameGlyphs, () => { FX.lock = 0; busy = false; after(0.6, glint); resolve(true); });
    });
  }

  // pointer: tilt toward the cursor (relative to this canvas), tap, horizontal drag to spin
  const ptr = { nx: 0, ny: 0, last: -10, down: null, dragging: false, lastX: 0, lastT: 0 };
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  let rect = canvas.getBoundingClientRect();
  // pointer → the front face: ray into stone space, meet the face plane, check the face outline. Microseconds.
  let HULL = null;
  const _inv = new THREE.Matrix4(), _ray = new THREE.Ray(), _hp = new THREE.Vector3(), _facePlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  function hitTest(cx, cy) {
    if (!mesh || !HULL) return null;
    rect = canvas.getBoundingClientRect();
    ndc.set((cx - rect.left) / rect.width * 2 - 1, -((cy - rect.top) / rect.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    stone.updateMatrixWorld();
    _ray.copy(ray.ray).applyMatrix4(_inv.copy(stone.matrixWorld).invert());
    _facePlane.constant = -(FACE_Z - OFF.z);
    if (!_ray.intersectPlane(_facePlane, _hp) || !inConvex(HULL, _hp.x, _hp.y)) return null;
    const mx = (_hp.x + OFF.x + W / 2) * 1000, my = (H / 2 - _hp.y - OFF.y) * 1000;
    return { local: _hp.clone(), uv: new THREE.Vector2(mx / MM_W, my / MM_H) };
  }

  let hoverT = 0;
  const onMove = (e) => {
    if (!running) return;
    rect = canvas.getBoundingClientRect();
    const sx = rect.left + rect.width * (0.5 + curSh / 2);   // the stone's centre, not the canvas's
    const sy = rect.top + rect.height * (0.5 - curLf / 2);
    ptr.nx = Math.max(-1, Math.min(1, (e.clientX - sx) / (rect.width * 0.45)));
    ptr.ny = Math.max(-1, Math.min(1, -(e.clientY - sy) / (rect.height * 0.5)));
    ptr.last = performance.now() / 1000;
    if (ptr.down) {
      const dx = e.clientX - ptr.down.x, dy = e.clientY - ptr.down.y;
      if (!ptr.dragging && Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)) { ptr.dragging = true; canvas.style.cursor = 'grabbing'; }
      if (ptr.dragging) {
        const t = performance.now() / 1000, ddx = e.clientX - ptr.lastX;
        spin.x += ddx * 0.008; spin.v = (ddx * 0.008) / Math.max(1 / 120, t - ptr.lastT);
        ptr.lastX = e.clientX; ptr.lastT = t;
      }
    } else if (e.target === canvas && performance.now() - hoverT > 90) {
      hoverT = performance.now();
      canvas.style.cursor = hitTest(e.clientX, e.clientY) ? 'pointer' : '';
    }
  };
  addEventListener('pointermove', onMove, { passive: true });
  canvas.addEventListener('pointerdown', (e) => {
    ptr.down = { x: e.clientX, y: e.clientY }; ptr.dragging = false; ptr.lastX = e.clientX; ptr.lastT = performance.now() / 1000;
    ac();
  });
  canvas.addEventListener('pointerup', (e) => {
    const wasDrag = ptr.dragging; ptr.down = null; ptr.dragging = false;
    canvas.style.cursor = '';
    if (wasDrag || busy) return;
    const h = hitTest(e.clientX, e.clientY);
    if (h) tap(h.local, h.uv);
  });
  canvas.addEventListener('pointercancel', () => { ptr.down = null; ptr.dragging = false; });
  canvas.addEventListener('keydown', (e) => {
    if ((e.key === ' ' || e.key === 'Enter') && mode === 'hero') { e.preventDefault(); tapNext(); }
  });

  let cssW = 1, cssH = 1;
  // resize: fit the stone to `fit` of the height, offset by `shift`
  function resize() {
    const w = Math.max(1, canvas.clientWidth), h = Math.max(1, canvas.clientHeight);
    cssW = w; cssH = h;
    // Resolution: Retina (2×) at most, within a pixel budget so a wide window doesn't multiply the GPU work,
    // times `quality`, which steps down on its own if frames run slow on this machine (see frame()).
    const dpr = Math.max(1, Math.min(devicePixelRatio, 2, Math.sqrt(PX_BUDGET / (w * h))) * quality);
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false); composer.setSize(w, h);
    camera.aspect = w / h;
    const t = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    let sh, lf, dist;
    if (frameFn) {
      const fr = frameFn(w, h);
      sh = (2 * fr.x) / w - 1; lf = 1 - (2 * fr.y) / h; dist = h / (2 * t * fr.scale);
    } else {
      const f = fit(w, h); sh = shift(w, h); lf = lift(w, h);
      const visW = 0.84 * (1 - Math.abs(sh));
      dist = Math.max((H * 0.5) / (t * f), (W * 0.5) / (t * camera.aspect * visW));
    }
    curSh = sh; curLf = lf;
    camRest.set(0, -0.02, dist);
    camera.position.copy(camRest); camera.lookAt(0, -0.02, 0);
    if (sh || lf) camera.setViewOffset(w, h, -sh * w / 2, lf * h / 2, w, h); else camera.clearViewOffset();
    camera.updateProjectionMatrix();
    pUni.uScale.value = (h * renderer.getPixelRatio()) / (2 * t);
  }
  new ResizeObserver(() => { resize(); if (!running && mesh) draw(); }).observe(canvas);

  // frame loop: runs only while the canvas is on screen (and rAF pauses itself in hidden tabs)
  const clock = new THREE.Clock(false);
  const _lp = new THREE.Vector3(), _dir = new THREE.Vector3(), _plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -0.62);
  let running = false, inView = false, raf = 0;
  let lastDraw = 0;
  // adaptive resolution: watch full-rate frames; if over a fifth run long, render 15% fewer pixels per side
  const perf = { minGap: 1e9, n: 0, slow: 0, prevBusy: 0, from: 0 };
  function watch(ts, busyNow) {
    perf.from ||= ts + 2000;                             // skip the first 2 s: shader builds and uploads aren't the steady state
    const gap = ts - perf.prevBusy; perf.prevBusy = busyNow ? ts : 0;
    if (ts < perf.from) return;
    if (!busyNow || !gap || gap > 600) return;          // only consecutive full-rate frames; skip resumes (tab switches)
    perf.minGap = Math.max(6, Math.min(perf.minGap, gap, 1000 / 60));   // a display refreshes at least at 60 Hz
    perf.n++; if (gap > perf.minGap * 1.6) perf.slow++;
    if (perf.n < 90) return;
    if (perf.slow / perf.n > 0.2 && quality > 0.5) { quality = Math.max(0.5, quality * 0.85); resize(); }
    perf.n = perf.slow = 0;
  }
  function frame(ts) {
    // Idle (just the slow sway) looks the same at 60 fps, so on 120 Hz screens every other frame is skipped.
    const busyNow = tweens.length > 0 || alive > 0 || hot.length > 0 || bloomK > 0 || ptr.down || ptr.dragging
      || performance.now() / 1000 - ptr.last < 1.2 || Math.abs(spin.v) > 0.01;
    if (!busyNow && ts - lastDraw < 1000 / 60 - 2) { raf = requestAnimationFrame(frame); return; }
    lastDraw = ts; watch(ts, busyNow);
    const dt = Math.min(clock.getDelta(), 1 / 30), now = clock.elapsedTime, dtA = dt * P.speed;
    stepTweens(dtA); stepParticles(dtA);

    const idle = performance.now() / 1000 - ptr.last > 3.5;
    const tx = idle ? Math.sin(now * 0.31) * 0.35 : ptr.nx, ty = idle ? Math.sin(now * 0.23) * 0.25 : ptr.ny;
    for (let i = 0; i < 2; i++) { spring(fx, tx, P.follow, 0.85, dt / 2); spring(fy, ty, P.follow, 0.85, dt / 2); }
    for (const s of [kX, kY, kZ]) spring(s, 0, 160, 0.28, dtA);
    if (!ptr.dragging) { const target = Math.round(spin.x / (Math.PI * 2)) * Math.PI * 2; spring(spin, target, 9, 0.62, dtA); }

    const lockK = 1 - FX.lock * 0.75;
    const tiltR = THREE.MathUtils.degToRad(P.tilt) * V.tilt * lockK * (REDUCE ? 0.3 : 1);
    stone.rotation.set(REST.x * lockK - fy.x * tiltR * 0.8 + kX.x, REST.y * lockK + fx.x * tiltR + spin.x + kY.x, REST.z * lockK, 'YXZ');
    stone.position.set(0, (1 - FX.intro) * -0.12, kZ.x);

    const g = THREE.MathUtils.degToRad(Math.min(80, Math.max(3, P.graze + FX.grazeOff)));
    let lx = fx.x - 0.55, ly = fy.x + 0.45; const ll = Math.hypot(lx, ly) || 1; lx /= ll; ly /= ll;
    _dir.set(lx * Math.cos(g), ly * Math.cos(g), Math.sin(g));
    key.position.copy(_dir).multiplyScalar(5.5);
    key.target.position.set(-lx * (CINE ? 0.2 : 0.45), -ly * (CINE ? 0.2 : 0.45) + (CINE ? 0.25 : 0), 0);
    key.intensity = 52 * P.light * V.keyGain * FX.intro * (1 + (V.lantern ? 0 : FX.flare * 0.9));

    if (V.lantern) {
      if (FX.lanternOverride) lantern.position.copy(stone.localToWorld(mmToLocal(FX.lx, FX.ly).add(new THREE.Vector3(0, 0, 0.4))));
      else { ndc.set(fx.x, fy.x); ray.setFromCamera(ndc, camera); if (ray.ray.intersectPlane(_plane, _lp)) lantern.position.copy(_lp); }
      const flick = 1 + (REDUCE ? 0 : 0.05 * Math.sin(now * 13.1) + 0.035 * Math.sin(now * 7.3 + 1.7) + 0.02 * Math.sin(now * 23.7));
      lantern.intensity = 1.5 * P.light * flick * FX.intro * (1 + FX.flare * 2.2);
      U.uLight.value.copy(stone.worldToLocal(lantern.position.clone()));
      mUni.uLP.value.copy(lantern.position);
    } else {
      U.uLight.value.copy(stone.worldToLocal(key.position.clone()));
      mUni.uLP.value.copy(key.position); mUni.uLD.value.copy(key.target.position).sub(key.position).normalize();
    }
    mUni.uT.value = now;
    U.uDepth.value = P.depth / 1000;
    U.uGlowGain.value = V.glow === 1 ? 2.0 : V.glow === 3 ? 2.4 : 1.6;

    FX.shake *= Math.exp(-dt * 14);
    camera.position.set(camRest.x + (Math.random() - 0.5) * FX.shake, camRest.y + (Math.random() - 0.5) * FX.shake, camRest.z);

    if (dirty || dirtyGlow || hot.length) { compose(dirty, dirtyGlow || hot.length > 0); dirty = dirtyGlow = false; }
    const glowing = FX.flare > 0.01 || hot.length > 0 || glyphs.some((g) => g.heat > 0.002);
    bloomK += ((glowing ? 1 : 0) - bloomK) * (1 - Math.exp(-dt * (glowing ? 20 : 4)));
    if (!glowing && bloomK < 0.005) bloomK = 0;
    bloom.strength = V.bloom * bloomK;
    draw();

    // where the key light sits on screen: a point along the light direction, projected to canvas px
    if (hooks.onLight) {
      _lp.copy(_dir).multiplyScalar(1.15).project(camera);
      hooks.onLight((_lp.x * 0.5 + 0.5) * cssW, (-_lp.y * 0.5 + 0.5) * cssH, fx.x);
    }
    raf = requestAnimationFrame(frame);
  }
  function wake() {
    const should = mesh && inView; // rAF already pauses in hidden tabs
    if (should && !running) { running = true; clock.start(); clock.getDelta(); raf = requestAnimationFrame(frame); }
    else if (!should && running) { running = false; cancelAnimationFrame(raf); clock.stop(); }
  }
  new IntersectionObserver(([e]) => { inView = e.isIntersecting; wake(); }, { rootMargin: '120px' }).observe(canvas);

  // boot
  const ready = loadShared().then(({ geo, faceZ, off, hull }) => {
    FACE_Z = faceZ; OFF = off; HULL = hull;
    mesh = new THREE.Mesh(geo, stoneMat);
    mesh.castShadow = mesh.receiveShadow = true;
    stone.add(mesh);
    if (mode === 'hero') buildInscription();
    applyVariant();
    resize();
    // bloom is off until something glows; render it once now so its shaders and targets exist before the first glow
    if (!transparent) { bloom.strength = 0; composer.render(); }
    tw(FX, 'intro', 1, REDUCE ? 0.01 : 1.6, { ease: E.out });
    hooks.onReady();
    wake();
  });

  return {
    ready, engrave, tapNext, prepare,
    get steps() { return STEPS.length; },
    get busy() { return busy; },
    resize,
  };
}
