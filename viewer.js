/* =========================================================
   3D Lab — a small Blender-style viewport built on three.js
   ========================================================= */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

/* ---------- Scenes exported from the .blend files ---------- */
const SCENES = [
  {
    id: 'interior', file: 'models/interior.glb', name: 'Living Room',
    tag: 'Interior Visualization', title: 'Living Room Interior',
    desc: 'Modeled, dressed and lit in Blender. Hit Walk and explore it in first person.',
    useCamera: true, grid: false, shadows: false, env: 0.6, exposure: 0.85, walk: true,
  },
  {
    id: 'samurai', file: 'models/samurai.glb', name: 'Samurai',
    tag: 'Character · Animation', title: 'Samurai Warrior',
    desc: 'Rigged character with a karate fight action straight from the Blender timeline.',
    clip: 'Karate_Fight',
  },
  {
    id: 'spider', file: 'models/spider.glb', name: 'Spider Monster',
    tag: 'Creature Modeling', title: 'Alien Spider Monster',
    desc: 'A creature built from 18 separate parts: legs, fangs, pedipalps, ridges and armor.',
  },
  {
    id: 'hand', file: 'models/hand.glb', name: 'Hand Rig',
    tag: 'Rigging', title: 'Rigged Hand',
    desc: 'Hand model driven by an armature, with a keyed finger animation.',
  },
  {
    id: 'face', file: 'models/face.glb', name: 'Face Rig',
    tag: 'Facial Animation', title: 'Facial Rig',
    desc: 'Seven shape keys driven by an emotions animation. Drag the Shape Keys sliders to pose it yourself.',
  },
];

const FPS = 24;
const MODEL_VERSION = 7;     // bump after re-exporting models so browsers don't use stale copies
const isTouch = matchMedia('(pointer: coarse)').matches;

/* ---------- DOM ---------- */
const root = document.getElementById('viewer');
const q = s => root.querySelector(s);
const vp = q('.v-viewport'), canvas = q('.v-canvas'), gizmo = q('.v-gizmo');
const tabsEl = q('.v-tabs'), tree = q('.v-tree'), search = q('.v-search');
const statsEl = q('.v-stats'), modeEl = q('.v-mode'), crumbEl = q('.v-crumb');
const startEl = q('.v-start'), barEl = q('.v-bar i'), pctEl = q('.v-loading-pct');
const timeline = q('.v-timeline'), playBtn = q('.v-play'), clipSel = q('.v-clip'),
      scrub = q('.v-scrub'), frameEl = q('.v-frame');
const walkBtn = q('[data-toggle="walk"]');
const shapesWrap = q('.v-shapes-wrap'), shapesEl = q('.v-shapes');

tabsEl.innerHTML = SCENES.map((s, i) =>
  `<button class="v-tab" role="tab" data-scene="${s.id}"><small>0${i + 1}</small>${s.name}</button>`).join('');

/* ---------- file:// guard ---------- */
if (location.protocol === 'file:') {
  startEl.innerHTML = `<p class="v-error">The 3D scenes need a web server to load.<br>
    Start Apache in XAMPP and open <code>http://localhost/portfolio/</code> instead of the file directly.</p>`;
  throw new Error('3D Lab: open the site through http://localhost, not file://');
}

/* =========================================================
   Renderer, scene, camera, controls
   ========================================================= */
let renderer, scene, camera, controls, walk, pmrem, envTex;
let hemi, key, ground, grid;
let started = false, visible = false, dirty = true;

const state = {
  scene: null,          // current SCENES entry
  model: null,          // current gltf.scene root
  gltf: null,
  shading: 'material',
  grid: true,
  selected: null,
  mixer: null, action: null, playing: false,
  bounds: new THREE.Box3(), size: 1, center: new THREE.Vector3(),
  tween: null,
  view: 'User Perspective',
};
const cache = new Map();

function init() {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.toneMapping = THREE.AgXToneMapping;          // Blender's default view transform
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  scene = new THREE.Scene();
  pmrem = new THREE.PMREMGenerator(renderer);
  envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = envTex;

  camera = new THREE.PerspectiveCamera(50, 1, 0.01, 1000);

  hemi = new THREE.HemisphereLight(0xffffff, 0x444450, 0.5);
  key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.bias = -0.0005;
  key.shadow.normalBias = 0.02;
  scene.add(hemi, key, key.target);

  ground = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
    new THREE.ShadowMaterial({ opacity: 0.35 }));
  ground.receiveShadow = true;
  scene.add(ground);

  // Blender-like mouse mapping: LMB/MMB orbit, RMB or Shift+drag pan, wheel zoom
  controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.09;
  controls.screenSpacePanning = true;
  controls.zoomToCursor = true;
  controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.ROTATE, RIGHT: THREE.MOUSE.PAN };
  controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
  controls.autoRotateSpeed = 1.2;
  controls.addEventListener('start', () => { state.tween = null; setView('User Perspective'); });
  controls.addEventListener('change', () => { dirty = true; });

  walk = new PointerLockControls(camera, canvas);
  walk.addEventListener('lock', () => vp.classList.add('walking'));
  walk.addEventListener('unlock', exitWalk);
  if (isTouch) walkBtn.hidden = true;

  new ResizeObserver(resize).observe(vp);
  resize();
  bindUI();
  renderer.setAnimationLoop(loop);
}

function resize() {
  const w = vp.clientWidth, h = vp.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  dirty = true;
}

/* =========================================================
   Loading scenes
   ========================================================= */
const draco = new DRACOLoader().setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/libs/draco/gltf/');
const loader = new GLTFLoader().setDRACOLoader(draco);
let loadToken = 0;

function loadGLTF(def) {
  if (cache.has(def.id)) return Promise.resolve(cache.get(def.id));
  return new Promise((resolve, reject) => {
    loader.load(`${def.file}?v=${MODEL_VERSION}`, gltf => {
      prepare(gltf);
      cache.set(def.id, gltf);
      resolve(gltf);
    }, xhr => {
      if (xhr.total) {
        const p = Math.round(xhr.loaded / xhr.total * 100);
        barEl.style.width = p + '%';
        pctEl.textContent = `${p}%  ·  ${(xhr.total / 1048576).toFixed(1)} MB`;
      } else {
        pctEl.textContent = (xhr.loaded / 1048576).toFixed(1) + ' MB';
      }
    }, reject);
  });
}

function prepare(gltf) {
  let verts = 0, tris = 0, meshes = 0;
  gltf.scene.traverse(o => {
    if (o.isMesh) {
      meshes++;
      const g = o.geometry;
      verts += g.attributes.position.count;
      tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
      o.userData.mat = o.material;
      o.frustumCulled = !o.isSkinnedMesh;
    }
  });
  gltf.userData.stats = { verts, tris: Math.round(tris), meshes };
}

async function showScene(id) {
  const def = SCENES.find(s => s.id === id);
  if (!def || state.scene === def) return;
  if (walk.isLocked) walk.unlock();
  const token = ++loadToken;

  state.scene = def;
  tabsEl.querySelectorAll('.v-tab').forEach(t => t.classList.toggle('active', t.dataset.scene === id));
  q('.v-info-tag').textContent = def.tag;
  q('.v-info-title').textContent = def.title;
  q('.v-info-desc').textContent = def.desc;
  walkBtn.disabled = false;

  if (!cache.has(id)) {
    barEl.style.width = '0%';
    pctEl.textContent = '0%';
    vp.classList.add('loading');
  }
  let gltf;
  try {
    gltf = await loadGLTF(def);
  } catch (err) {
    console.error(err);
    if (token === loadToken) {
      vp.classList.remove('loading');
      startEl.classList.remove('gone');
      startEl.innerHTML = `<p class="v-error">Couldn't load <code>${def.file}</code>. Check that the file exists on the server.</p>`;
    }
    return;
  }
  if (token !== loadToken) return;      // user switched again while loading
  vp.classList.remove('loading');

  // swap model
  if (state.model) scene.remove(state.model);
  if (state.mixer) state.mixer.stopAllAction();
  state.gltf = gltf;
  state.model = gltf.scene;
  scene.add(state.model);
  select(null);

  // lighting per scene
  const shadows = def.shadows !== false;
  scene.environmentIntensity = def.env ?? 1;
  renderer.toneMappingExposure = def.exposure ?? 1;
  key.visible = shadows;
  ground.visible = shadows;
  state.model.traverse(o => { if (o.isMesh) { o.castShadow = shadows; o.receiveShadow = shadows; } });

  // bounds, grid, camera
  state.model.updateMatrixWorld(true);
  state.bounds.setFromObject(state.model);
  state.bounds.getCenter(state.center);
  state.size = state.bounds.getSize(new THREE.Vector3()).length() || 1;
  buildGrid(def);
  placeLights();

  camera.near = state.size / 1000;
  camera.far = state.size * 50;
  const cam = def.useCamera && gltf.cameras && gltf.cameras[0];
  if (cam) {
    cam.updateMatrixWorld(true);
    lookThrough(cam, false);
  } else {
    camera.fov = 40;
    frame(state.bounds, new THREE.Vector3(0.85, 0.55, 1.25), false);
  }
  camera.updateProjectionMatrix();
  controls.autoRotate = false;
  q('[data-toggle="spin"]').classList.remove('active');

  setupAnimation(gltf, def);
  applyShading();
  buildOutliner();
  updateStats();
  setView(cam ? 'Camera Perspective' : 'User Perspective');
  dirty = true;
}

function buildGrid(def) {
  if (grid) { scene.remove(grid); grid.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); }); }
  const span = Math.max(state.size, 0.5);
  const unit = Math.pow(10, Math.floor(Math.log10(span / 2)));
  const size = unit * 40;
  grid = new THREE.Group();
  const g = new THREE.GridHelper(size, 40, 0x5b5e66, 0x45474d);
  g.material.transparent = true; g.material.opacity = 0.55; g.material.depthWrite = false;
  grid.add(g);
  const axis = (color, a, b) => {
    const geo = new THREE.BufferGeometry().setFromPoints([a, b]);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.85 }));
    grid.add(line);
  };
  const h = size / 2;
  axis(0xff4d5e, new THREE.Vector3(-h, 0.0005, 0), new THREE.Vector3(h, 0.0005, 0));   // Blender X
  axis(0x8bd450, new THREE.Vector3(0, 0.0005, -h), new THREE.Vector3(0, 0.0005, h));   // Blender Y
  grid.position.y = Math.abs(state.bounds.min.y) < span * 0.05 ? 0 : state.bounds.min.y;
  scene.add(grid);
  ground.position.y = state.bounds.min.y - 0.0005;
  ground.scale.setScalar(size);
  state.grid = def.grid !== false;
  q('[data-toggle="grid"]').classList.toggle('active', state.grid);
  grid.visible = state.grid;
}

function placeLights() {
  const s = state.size, c = state.center;
  key.position.set(c.x + s * 0.6, c.y + s * 1.1, c.z + s * 0.8);
  key.target.position.copy(c);
  const cam = key.shadow.camera;
  cam.left = cam.bottom = -s * 0.8;
  cam.right = cam.top = s * 0.8;
  cam.near = s * 0.05; cam.far = s * 4;
  cam.updateProjectionMatrix();
}

/* =========================================================
   Camera helpers (frame, snap views, look through camera)
   ========================================================= */
function frame(box, dir, animate = true) {
  const center = box.getCenter(new THREE.Vector3());
  const radius = box.getSize(new THREE.Vector3()).length() / 2 || 1;
  const fov = THREE.MathUtils.degToRad(camera.fov);
  const fit = Math.min(fov, 2 * Math.atan(Math.tan(fov / 2) * camera.aspect));
  const dist = radius / Math.sin(fit / 2) * 1.05;
  const d = (dir || camera.position.clone().sub(controls.target)).normalize();
  moveCamera(center.clone().addScaledVector(d, dist), center, animate);
}

function snapView(axis, name) {
  // axis: a three.js direction (from target towards camera)
  const dist = camera.position.distanceTo(controls.target) || state.size;
  const dir = axis.clone().normalize();
  if (Math.abs(dir.y) > 0.999) dir.z += 1e-4;   // avoid gimbal flip on top/bottom
  moveCamera(controls.target.clone().addScaledVector(dir.normalize(), dist), controls.target.clone(), true);
  setView(name);
}

function moveCamera(pos, target, animate) {
  if (!animate) {
    camera.position.copy(pos);
    controls.target.copy(target);
    controls.update();
    dirty = true;
    return;
  }
  state.tween = {
    t0: performance.now(), dur: 450,
    p0: camera.position.clone(), p1: pos.clone(),
    c0: controls.target.clone(), c1: target.clone(),
  };
}

function stepTween(now) {
  const tw = state.tween;
  if (!tw) return false;
  const k = Math.min(1, (now - tw.t0) / tw.dur);
  const e = 1 - Math.pow(1 - k, 3);
  controls.target.lerpVectors(tw.c0, tw.c1, e);
  // orbit around the target rather than cutting through it
  const a = tw.p0.clone().sub(tw.c0), b = tw.p1.clone().sub(tw.c1);
  const la = a.length(), lb = b.length();
  a.normalize(); b.normalize();
  if (a.dot(b) < -0.999) a.add(new THREE.Vector3(0, 0.01, 0.01)).normalize();
  const qa = new THREE.Quaternion().setFromUnitVectors(a, b);
  const dir = a.clone().applyQuaternion(new THREE.Quaternion().slerp(qa, e));
  camera.position.copy(controls.target).addScaledVector(dir, THREE.MathUtils.lerp(la, lb, e));
  camera.lookAt(controls.target);
  if (k >= 1) { state.tween = null; controls.update(); }
  return true;
}

function lookThrough(cam, animate = true) {
  const pos = cam.getWorldPosition(new THREE.Vector3());
  const dir = cam.getWorldDirection(new THREE.Vector3());
  if (cam.isPerspectiveCamera) {
    camera.fov = THREE.MathUtils.clamp(cam.fov, 35, 80);
    camera.updateProjectionMatrix();
  }
  const reach = Math.min(state.size * 0.15, 2.5);
  moveCamera(pos, pos.clone().addScaledVector(dir, reach), animate);
  setView('Camera Perspective');
}

function setView(name) {
  state.view = name;
  modeEl.textContent = name;
}

/* =========================================================
   Walk navigation (Blender: Shift + `)
   ========================================================= */
const keys = new Set();
function enterWalk() {
  if (isTouch || !state.model) return;
  state.tween = null;
  controls.enabled = false;
  controls.autoRotate = false;
  walkBtn.classList.add('active');
  setView('Walk Navigation');
  walk.lock();
}
function exitWalk() {
  vp.classList.remove('walking');
  walkBtn.classList.remove('active');
  keys.clear();
  if (controls.enabled) return;
  const dir = camera.getWorldDirection(new THREE.Vector3());
  controls.target.copy(camera.position).addScaledVector(dir, Math.min(state.size * 0.15, 2.5));
  controls.enabled = true;
  controls.update();
  setView('User Perspective');
}
function stepWalk(dt) {
  if (!walk.isLocked) return false;
  const base = Math.max(state.size * 0.12, 1.4);
  const speed = base * (keys.has('ShiftLeft') || keys.has('ShiftRight') ? 2.5 : 1) * dt;
  const fwd = camera.getWorldDirection(new THREE.Vector3());
  const right = new THREE.Vector3().crossVectors(fwd, camera.up).normalize();
  const move = new THREE.Vector3();
  if (keys.has('KeyW') || keys.has('ArrowUp')) move.add(fwd);
  if (keys.has('KeyS') || keys.has('ArrowDown')) move.sub(fwd);
  if (keys.has('KeyD') || keys.has('ArrowRight')) move.add(right);
  if (keys.has('KeyA') || keys.has('ArrowLeft')) move.sub(right);
  if (keys.has('KeyE')) move.y += 1;
  if (keys.has('KeyQ')) move.y -= 1;
  if (move.lengthSq()) camera.position.addScaledVector(move.normalize(), speed);
  return true;
}

/* =========================================================
   Shading modes
   ========================================================= */
const matcap = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(100, 90, 10, 128, 128, 128);
  grd.addColorStop(0, '#f4f4f4'); grd.addColorStop(0.45, '#bdbdbd');
  grd.addColorStop(0.85, '#6c6c6c'); grd.addColorStop(1, '#3a3a3a');
  g.fillStyle = grd; g.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
})();
const solidMat = new THREE.MeshMatcapMaterial({ matcap, color: 0xd8d8d8 });
const wireMat = new THREE.MeshBasicMaterial({ color: 0x0c0c0c, wireframe: true, transparent: true, opacity: 0.7 });

function applyShading() {
  if (!state.model) return;
  const m = state.shading;
  state.model.traverse(o => {
    if (!o.isMesh) return;
    const orig = o.userData.mat;
    const pick = m === 'solid' ? solidMat : m === 'wire' ? wireMat : null;
    o.material = !pick ? orig : Array.isArray(orig) ? orig.map(() => pick) : pick;
  });
  const lit = m === 'material';
  scene.environment = lit ? envTex : null;
  ground.material.opacity = lit ? 0.35 : 0.2;
  wireMat.color.set(state.scene?.id === 'interior' ? 0xd0d0d0 : 0x0c0c0c);
  root.querySelectorAll('[data-shading]').forEach(b => b.classList.toggle('active', b.dataset.shading === m));
  dirty = true;
}

/* =========================================================
   Outliner + selection
   ========================================================= */
const ICONS = {
  mesh: '<path d="M8 1.5l5.5 3.2v6.6L8 14.5 2.5 11.3V4.7z M2.5 4.7L8 8l5.5-3.3M8 8v6.5"/>',
  armature: '<path d="M3 13l5-5M8 8l5-5M6.5 3.5l6 6"/><circle cx="3" cy="13" r="1.3"/><circle cx="13" cy="3" r="1.3"/>',
  camera: '<path d="M2 5h8v6H2zM10 7l4-2v6l-4-2z"/>',
  empty: '<path d="M8 2v12M2 8h12"/>',
};
const EYE = '<svg viewBox="0 0 16 16"><path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z"/><circle cx="8" cy="8" r="2"/></svg>';
const EYE_OFF = '<svg viewBox="0 0 16 16"><path d="M2 2l12 12M6.5 4C7 3.7 7.5 3.5 8 3.5c4 0 6.5 4.5 6.5 4.5s-.8 1.4-2.2 2.7M4 5.6C2.4 6.8 1.5 8 1.5 8S4 12.5 8 12.5c1 0 1.9-.3 2.7-.7"/></svg>';

function kindOf(o) {
  if (o.isCamera) return 'camera';
  let k = 'empty';
  o.traverse(c => { if (c.isBone || c.isSkinnedMesh) k = 'armature'; else if (c.isMesh && k === 'empty') k = 'mesh'; });
  return k;
}
const pretty = n => (n || 'Object').replace(/_/g, ' ').replace(/\s+/g, ' ').trim();

const kidsOf = o => o.children.filter(c => !c.isBone && kindOf(c) !== 'empty' || c.isCamera)
  .sort((a, b) => pretty(a.name).localeCompare(pretty(b.name)));

function buildOutliner() {
  tree.innerHTML = '';
  const top = state.model.children.filter(o => !o.isBone);
  const expandAll = top.length === 1;
  const add = (o, depth, parentLi) => {
    const li = document.createElement('li');
    const k = kindOf(o);
    const kids = depth === 0 ? kidsOf(o) : [];
    li.style.paddingLeft = (6 + depth * 18) + 'px';
    li.innerHTML = `<button class="v-twist" aria-label="Expand" ${kids.length ? '' : 'disabled'}>${kids.length ? '▸' : ''}</button>
      <svg class="v-ico ${k}" viewBox="0 0 16 16">${ICONS[k]}</svg>
      <span class="name">${pretty(o.name)}</span>
      <button class="v-eye" aria-label="Toggle visibility">${EYE}</button>`;
    li.classList.toggle('off', !o.visible);
    li._obj = o;
    li._kids = [];
    if (parentLi) { parentLi._kids.push(li); li.hidden = !expandAll; li._parentLi = parentLi; }
    tree.appendChild(li);
    kids.forEach(c => add(c, depth + 1, li));
    if (expandAll && kids.length) li.classList.add('open');
  };
  top.sort((a, b) => pretty(a.name).localeCompare(pretty(b.name))).forEach(o => add(o, 0));
  search.value = '';
}

tree.addEventListener('click', e => {
  const li = e.target.closest('li');
  if (!li) return;
  const o = li._obj;
  if (e.target.closest('.v-twist')) {
    const open = li.classList.toggle('open');
    li._kids.forEach(k => { k.hidden = !open; });
    return;
  }
  if (e.target.closest('.v-eye')) {
    o.visible = !o.visible;
    li.classList.toggle('off', !o.visible);
    li.querySelector('.v-eye').innerHTML = o.visible ? EYE : EYE_OFF;
    if (!o.visible && state.selected === o) select(null);
    dirty = true;
    return;
  }
  if (o.isCamera) { lookThrough(o); select(o); return; }
  select(o);
  frameSelected();
});
tree.addEventListener('dblclick', e => { const li = e.target.closest('li'); if (li && !li._obj.isCamera) frameSelected(); });
search.addEventListener('input', () => {
  const s = search.value.toLowerCase();
  tree.querySelectorAll('li').forEach(li => {
    const match = li.querySelector('.name').textContent.toLowerCase().includes(s);
    li.hidden = s ? !match : !!(li._parentLi && !li._parentLi.classList.contains('open'));
  });
});

let selBox = null;
function select(o) {
  state.selected = o;
  if (selBox) { scene.remove(selBox); selBox.geometry.dispose(); selBox = null; }
  if (o && !o.isCamera) {
    selBox = new THREE.BoxHelper(o, 0xffa033);
    selBox.material.depthTest = false;
    selBox.material.transparent = true;
    selBox.renderOrder = 999;
    scene.add(selBox);
  }
  tree.querySelectorAll('li').forEach(li => li.classList.toggle('sel', li._obj === o));
  const li = [...tree.children].find(l => l._obj === o);
  li?.scrollIntoView({ block: 'nearest' });
  crumbEl.textContent = `(${currentFrame()}) ${state.scene?.title || 'Scene'}${o ? ' | ' + pretty(o.name) : ''}`;
  dirty = true;
}

function frameSelected() {
  const o = state.selected;
  if (!o || o.isCamera) return frame(state.bounds);
  const box = new THREE.Box3().setFromObject(o);
  if (!box.isEmpty()) frame(box);
}

// click-to-select in the viewport (ignores drags)
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
let down = null;
canvas.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY, b: e.button }; vp.focus({ preventScroll: true }); });
canvas.addEventListener('pointerup', e => {
  if (!down || down.b !== 0 || walk.isLocked || !state.model) return;
  if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) return;
  const r = canvas.getBoundingClientRect();
  ndc.set((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const hit = ray.intersectObject(state.model, true).find(h => h.object.visible && isShown(h.object));
  if (!hit) return select(null);
  // pick the object as listed in the outliner (top level, or its direct child)
  let o = hit.object;
  while (o.parent && o.parent !== state.model && o.parent.parent !== state.model) o = o.parent;
  const li = [...tree.children].find(l => l._obj === o);
  if (!li) { while (o.parent && o.parent !== state.model) o = o.parent; }
  else if (li._parentLi && !li._parentLi.classList.contains('open')) {
    li._parentLi.classList.add('open'); li._parentLi._kids.forEach(k => { k.hidden = false; });
  }
  select(o);
});
canvas.addEventListener('contextmenu', e => e.preventDefault());
function isShown(o) { for (; o; o = o.parent) if (!o.visible) return false; return true; }

/* =========================================================
   Animation timeline
   ========================================================= */
function setupAnimation(gltf, def) {
  state.mixer = null; state.action = null; state.playing = false;
  const clips = state.clips = (gltf.animations || []).filter(c => c.tracks.length && c.duration > 0);
  timeline.hidden = !clips.length;
  buildShapeKeys(gltf);
  if (!clips.length) return;
  state.mixer = gltf.userData.mixer || (gltf.userData.mixer = new THREE.AnimationMixer(gltf.scene));
  clipSel.innerHTML = clips.map((c, i) => `<option value="${i}">${pretty(c.name)}</option>`).join('');
  let idx = clips.findIndex(c => c.name === def.clip);
  if (idx < 0) idx = clips.reduce((best, c, i) => c.duration > clips[best].duration ? i : best, 0);
  clipSel.value = idx;
  playClip(idx);
}

/* ---------- Shape keys panel (morph targets) ---------- */
function buildShapeKeys(gltf) {
  shapesEl.innerHTML = '';
  state.shapeMesh = null;
  gltf.scene.traverse(o => {
    if (!state.shapeMesh && o.isMesh && o.morphTargetDictionary && Object.keys(o.morphTargetDictionary).length) state.shapeMesh = o;
  });
  shapesWrap.hidden = !state.shapeMesh;
  if (!state.shapeMesh) return;
  const m = state.shapeMesh;
  Object.entries(m.morphTargetDictionary).forEach(([name, i]) => {
    const row = document.createElement('label');
    row.className = 'v-shape';
    row.innerHTML = `<span>${pretty(name)}</span><input type="range" min="0" max="1" step="0.01" value="${m.morphTargetInfluences[i]}"><output>${m.morphTargetInfluences[i].toFixed(2)}</output>`;
    const input = row.querySelector('input'), out = row.querySelector('output');
    input.addEventListener('input', () => {
      setPlaying(false);                       // sliders take over from the animation
      m.morphTargetInfluences[i] = +input.value;
      out.textContent = (+input.value).toFixed(2);
      dirty = true;
    });
    row._sync = () => {
      const v = m.morphTargetInfluences[i];
      if (document.activeElement !== input) input.value = v;
      out.textContent = v.toFixed(2);
    };
    shapesEl.appendChild(row);
  });
}
function syncShapeKeys() { shapesEl.querySelectorAll('.v-shape').forEach(r => r._sync()); }

function playClip(i) {
  const clip = state.clips[i];
  state.mixer.stopAllAction();
  state.action = state.mixer.clipAction(clip).reset().play();
  setPlaying(true);
}
function setPlaying(p) {
  state.playing = p;
  if (state.action) state.action.paused = !p;
  playBtn.classList.toggle('playing', p);
  dirty = true;
}
function currentFrame() {
  return state.action ? Math.round(state.action.time * FPS) + 1 : 1;
}
function syncTimeline() {
  if (!state.action) return;
  const d = state.action.getClip().duration || 1;
  if (document.activeElement !== scrub) scrub.value = Math.round((state.action.time % d) / d * 1000);
  frameEl.textContent = currentFrame();
  if (state.shapeMesh) syncShapeKeys();
}
playBtn.addEventListener('click', () => setPlaying(!state.playing));
clipSel.addEventListener('change', () => playClip(+clipSel.value));
scrub.addEventListener('input', () => {
  if (!state.action) return;
  setPlaying(false);
  state.action.time = scrub.value / 1000 * state.action.getClip().duration;
  state.mixer.update(0);
  frameEl.textContent = currentFrame();
  if (state.shapeMesh) syncShapeKeys();
  dirty = true;
});

/* =========================================================
   Navigation gizmo (like Blender's top-right axes)
   ========================================================= */
const AXES = [
  { l: 'X', v: new THREE.Vector3(1, 0, 0), c: '#ff4d5e', view: 'Right' },
  { l: 'Y', v: new THREE.Vector3(0, 0, -1), c: '#8bd450', view: 'Back' },
  { l: 'Z', v: new THREE.Vector3(0, 1, 0), c: '#4f9dff', view: 'Top' },
  { l: '', v: new THREE.Vector3(-1, 0, 0), c: '#ff4d5e', view: 'Left' },
  { l: '', v: new THREE.Vector3(0, 0, 1), c: '#8bd450', view: 'Front' },
  { l: '', v: new THREE.Vector3(0, -1, 0), c: '#4f9dff', view: 'Bottom' },
];
const gctx = gizmo.getContext('2d');
let gizmoHover = false, gizmoPts = [];
function drawGizmo() {
  const W = gizmo.width, c = W / 2, R = W * 0.36, br = W * 0.085;
  const inv = camera.quaternion.clone().invert();
  gctx.clearRect(0, 0, W, W);
  if (gizmoHover) { gctx.fillStyle = 'rgba(255,255,255,.08)'; gctx.beginPath(); gctx.arc(c, c, W / 2 - 2, 0, 7); gctx.fill(); }
  gizmoPts = AXES.map(a => {
    const v = a.v.clone().applyQuaternion(inv);
    return { ...a, x: c + v.x * R, y: c - v.y * R, z: v.z };
  }).sort((a, b) => a.z - b.z);
  gizmoPts.forEach(p => {
    if (p.l) {
      gctx.strokeStyle = p.c; gctx.lineWidth = W * 0.022;
      gctx.beginPath(); gctx.moveTo(c, c); gctx.lineTo(p.x, p.y); gctx.stroke();
    }
    gctx.beginPath(); gctx.arc(p.x, p.y, br, 0, 7);
    if (p.l) { gctx.fillStyle = p.c; gctx.fill(); }
    else { gctx.fillStyle = p.c + '55'; gctx.fill(); gctx.strokeStyle = p.c; gctx.lineWidth = W * 0.012; gctx.stroke(); }
    if (p.l) {
      gctx.fillStyle = '#111'; gctx.font = `700 ${W * 0.1}px Inter, sans-serif`;
      gctx.textAlign = 'center'; gctx.textBaseline = 'middle'; gctx.fillText(p.l, p.x, p.y + 1);
    }
  });
}
gizmo.addEventListener('pointerenter', () => { gizmoHover = true; dirty = true; });
gizmo.addEventListener('pointerleave', () => { gizmoHover = false; dirty = true; });
gizmo.addEventListener('click', e => {
  const r = gizmo.getBoundingClientRect(), s = gizmo.width / r.width;
  const x = (e.clientX - r.left) * s, y = (e.clientY - r.top) * s;
  const hit = [...gizmoPts].reverse().find(p => Math.hypot(p.x - x, p.y - y) < gizmo.width * 0.11);
  if (hit) snapView(hit.v, hit.view + ' Perspective');
});

/* =========================================================
   UI bindings + keyboard shortcuts
   ========================================================= */
function bindUI() {
  tabsEl.addEventListener('click', e => { const t = e.target.closest('.v-tab'); if (t) showScene(t.dataset.scene); });
  root.querySelectorAll('[data-shading]').forEach(b => b.addEventListener('click', () => { state.shading = b.dataset.shading; applyShading(); }));
  q('[data-toggle="grid"]').addEventListener('click', e => {
    state.grid = !state.grid; grid.visible = state.grid;
    e.currentTarget.classList.toggle('active', state.grid); dirty = true;
  });
  q('[data-toggle="spin"]').addEventListener('click', e => {
    controls.autoRotate = !controls.autoRotate;
    e.currentTarget.classList.toggle('active', controls.autoRotate);
  });
  walkBtn.addEventListener('click', () => walk.isLocked ? walk.unlock() : enterWalk());
  q('[data-action="home"]').addEventListener('click', () => { select(null); frame(state.bounds); });
  q('[data-action="fullscreen"]').addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else root.requestFullscreen?.();
  });
  q('.v-outliner-open').addEventListener('click', () => root.classList.add('outliner-open'));
  q('.v-panel-close').addEventListener('click', () => root.classList.remove('outliner-open'));
}

let hovered = false;
vp.addEventListener('pointerenter', () => { hovered = true; });
vp.addEventListener('pointerleave', () => { hovered = false; });

window.addEventListener('keydown', e => {
  if (walk?.isLocked) {
    keys.add(e.code);
    if (e.code === 'Space') e.preventDefault();
    return;
  }
  const active = started && (hovered || root.contains(document.activeElement));
  if (!active || e.target.matches('input, select, textarea')) return;
  const ctrl = e.ctrlKey || e.metaKey;
  const map = {
    Numpad1: [new THREE.Vector3(0, 0, ctrl ? -1 : 1), ctrl ? 'Back' : 'Front'],
    Digit1: [new THREE.Vector3(0, 0, ctrl ? -1 : 1), ctrl ? 'Back' : 'Front'],
    Numpad3: [new THREE.Vector3(ctrl ? -1 : 1, 0, 0), ctrl ? 'Left' : 'Right'],
    Digit3: [new THREE.Vector3(ctrl ? -1 : 1, 0, 0), ctrl ? 'Left' : 'Right'],
    Numpad7: [new THREE.Vector3(0, ctrl ? -1 : 1, 0), ctrl ? 'Bottom' : 'Top'],
    Digit7: [new THREE.Vector3(0, ctrl ? -1 : 1, 0), ctrl ? 'Bottom' : 'Top'],
  };
  if (map[e.code]) { e.preventDefault(); snapView(map[e.code][0], map[e.code][1] + ' Perspective'); return; }
  switch (e.code) {
    case 'KeyF': case 'NumpadDecimal': e.preventDefault(); frameSelected(); break;
    case 'Home': e.preventDefault(); frame(state.bounds); break;
    case 'KeyZ': {
      const order = ['wire', 'solid', 'material'];
      state.shading = order[(order.indexOf(state.shading) + 1) % 3]; applyShading(); break;
    }
    case 'Numpad0': if (state.gltf?.cameras?.[0]) lookThrough(state.gltf.cameras[0]); break;
    case 'Space': if (state.action) { e.preventDefault(); setPlaying(!state.playing); } break;
    case 'Backquote': if (e.shiftKey) { e.preventDefault(); enterWalk(); } break;
    case 'Escape': select(null); break;
  }
});
window.addEventListener('keyup', e => keys.delete(e.code));

/* =========================================================
   Render loop — only draws when something changed
   ========================================================= */
const clock = new THREE.Clock();
function loop() {
  const dt = Math.min(clock.getDelta(), 0.1);
  if (!visible) return;
  const now = performance.now();
  let active = stepTween(now);
  active = stepWalk(dt) || active;
  if (controls.enabled && !state.tween && controls.update(dt)) active = true;
  if (state.mixer && state.playing) { state.mixer.update(dt); active = true; syncTimeline(); }
  if (selBox && (active || dirty)) selBox.update();
  if (!active && !dirty) return;
  renderer.render(scene, camera);
  drawGizmo();
  dirty = false;
}

function updateStats() {
  const s = state.gltf.userData.stats, fmt = n => n.toLocaleString();
  statsEl.innerHTML = `
    <b>Objects</b><span>${state.model.children.length}</span>
    <b>Vertices</b><span>${fmt(s.verts)}</span>
    <b>Triangles</b><span>${fmt(s.tris)}</span>`;
}

/* =========================================================
   Boot: start when the viewer scrolls into view
   ========================================================= */
function start() {
  if (started) return;
  started = true;
  startEl.classList.add('gone');
  try {
    init();
  } catch (err) {
    console.error(err);
    startEl.classList.remove('gone');
    startEl.innerHTML = '<p class="v-error">WebGL isn\'t available in this browser, so the 3D scenes can\'t be shown.</p>';
    return;
  }
  showScene(SCENES[0].id);
}

q('.v-start-btn').addEventListener('click', start);
new IntersectionObserver(([en]) => {
  visible = en.isIntersecting;
  if (visible) { dirty = true; clock.getDelta(); }
  if (visible && !isTouch) start();     // desktop: auto-load; touch: wait for the button
}, { rootMargin: '200px' }).observe(root);
