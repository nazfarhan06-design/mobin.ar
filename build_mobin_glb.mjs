/**
 * build_mobin_glb.mjs
 * ---------------------------------------------------------------------------
 * Builds the Solid Horizon 20FT MOBIN (detachable cabin) to real-world scale
 * in METRES and exports:
 *   ../mobin_20ft.glb   – glTF binary  (Android / WebXR / model-viewer)
 *   ../mobin_20ft.usdz  – USDZ         (iPhone / iPad AR Quick Look)
 *
 * Source drawing : SHSB_LKR_SLG_SD_DCA_ARC_01_001 (R1)
 * Run            : npm install three@0.160.0 && node build_mobin_glb.mjs
 *
 * Exported axes (glTF convention, Y up):
 *   origin = centre of the floor, at finished floor level (FFL)
 *   +Z     = front of cabin (door D1 / windows W1 side) – faces the viewer
 *   +X     = to the viewer's right when looking at the front
 *   footings extend 0.30 m below the origin (100 mm floor + 200 mm footing)
 * ---------------------------------------------------------------------------
 */
import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { USDZExporter } from 'three/addons/exporters/USDZExporter.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// GLTFExporter uses the browser FileReader; minimal Node stand-in
globalThis.FileReader ??= class {
  readAsArrayBuffer(blob) { blob.arrayBuffer().then(b => { this.result = b; this.onloadend?.(); }); }
  readAsDataURL(blob) {
    blob.arrayBuffer().then(b => {
      this.result = 'data:application/octet-stream;base64,' + Buffer.from(b).toString('base64');
      this.onloadend?.();
    });
  }
};

/* ============================ DIMENSIONS (m) ============================
   Build space: X = length 0→6.0 (left→right on front elevation),
                Z = width 0 (front face) → 3.0 (rear face), Y = up from ground */
const L = 6.0, W = 3.0;
const FOOT_H  = 0.20;                          // base footing
const BASE    = FOOT_H;                        // underside of cabin
const FLOOR_T = 0.10;                          // base frame + 18 mm MgO board
const ROOF_T  = 0.15;                          // roof slab / frame
const CAB_H   = 2.60;                          // cabin base → roof top
const FFL     = BASE + FLOOR_T;                // 0.30 above ground
const WALL_H  = CAB_H - FLOOR_T - ROOF_T;      // 2.35 clear
const T       = 0.05;                          // 50 mm sandwich panel
const POST    = 0.15;                          // corner post

// Openings (scaled from elevations; u = along wall from its left end, v = above FFL)
const D1  = { u0: 0.15, u1: 1.05, h: 2.00 };                 // 900 × 2000 steel door
const W1A = { u0: 2.05, u1: 2.95, v0: 0.80, v1: 2.00 };      // 900 × 1200 sliding
const W1B = { u0: 3.95, u1: 4.85, v0: 0.80, v1: 2.00 };      // 900 × 1200 sliding
const W2  = { u0: 5.25, u1: 5.55, v0: 1.60, v1: 2.05 };      // 300 × 450 top hung (rear wall)
const TOILET = { x0: L - 1.20, z0: W - 1.50 };               // 1200 × 1500 rear-right corner
const D2  = { z0: 2.00, z1: 2.90, h: 2.10 };                 // 900 × 2100 PVC toilet door

/* ============================== MATERIALS ============================== */
const mat = (name, color, o = {}) =>
  Object.assign(new THREE.MeshStandardMaterial({ color, roughness: 0.7, ...o }), { name });
const M = {
  panel:    mat('SandwichPanel_50mm', 0xf0f2f5, { roughness: 0.75 }),
  steel:    mat('Steel_Frame',        0x3d4554, { roughness: 0.55, metalness: 0.45 }),
  roof:     mat('Roof_Slab',          0xd3d9e1, { roughness: 0.5,  metalness: 0.3 }),
  floor:    mat('Floor_MgO_PVC',      0xb9c1cc, { roughness: 0.85 }),
  fibre:    mat('Toilet_Fibreglass',  0xfbfbf8, { roughness: 0.4 }),
  door:     mat('Steel_Door',         0x5f7090, { roughness: 0.45, metalness: 0.5 }),
  pvc:      mat('PVC_Door',           0xf3f1ea, { roughness: 0.6 }),
  alu:      mat('Aluminium',          0xc8cdd5, { roughness: 0.35, metalness: 0.7 }),
  grill:    mat('Window_Grill',       0x2e3440, { roughness: 0.6,  metalness: 0.4 }),
  concrete: mat('Concrete_Footing',   0x9c9b95, { roughness: 0.95 }),
  glass:    mat('Glass',              0x9cc6e8, { roughness: 0.05, transparent: true,
                                                    opacity: 0.35 }),
};

const cabin = new THREE.Group();
cabin.name = 'Cabin';

function box(w, h, d, material, x, y, z, parent = cabin, name) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z);
  if (name) m.name = name;
  parent.add(m);
  return m;
}

/* ================================ WALLS ================================
   Wall-local space: u along +X, v up from FFL, thickness along +Z.
   Doors = notches cut from the bottom edge; windows = holes.             */
function wallGeometry(len, h, { doors = [], windows = [] } = {}) {
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  [...doors].sort((a, b) => a.u0 - b.u0).forEach(d => {
    s.lineTo(d.u0, 0); s.lineTo(d.u0, d.h); s.lineTo(d.u1, d.h); s.lineTo(d.u1, 0);
  });
  s.lineTo(len, 0); s.lineTo(len, h); s.lineTo(0, h); s.closePath();
  windows.forEach(w => {
    const p = new THREE.Path();
    p.moveTo(w.u0, w.v0); p.lineTo(w.u1, w.v0); p.lineTo(w.u1, w.v1); p.lineTo(w.u0, w.v1); p.closePath();
    s.holes.push(p);
  });
  return new THREE.ExtrudeGeometry(s, { depth: T, bevelEnabled: false });
}
function addWall(name, len, opts, x, z, rotY = 0) {
  const m = new THREE.Mesh(wallGeometry(len, WALL_H, opts), M.panel);
  m.name = name;
  m.position.set(x, FFL, z);
  m.rotation.y = rotY;
  cabin.add(m);
}
const SIDE = -Math.PI / 2;   // local +X → world +Z; thickness → world −X

addWall('Wall_Front', L, { doors: [D1], windows: [W1A, W1B] }, 0, 0);
addWall('Wall_Rear',  L, { windows: [W2] }, 0, W - T);
addWall('Wall_Left',  W - 2 * T, {}, T, T, SIDE);
addWall('Wall_Right', W - 2 * T, {}, L, T, SIDE);

// Toilet pod partitions
addWall('Toilet_Partition_Front', L - T - TOILET.x0, {}, TOILET.x0, TOILET.z0);
const sideLen = (W - T) - (TOILET.z0 + T);
const off = TOILET.z0 + T;
addWall('Toilet_Partition_Side', sideLen,
  { doors: [{ u0: D2.z0 - off, u1: D2.z1 - off, h: D2.h }] }, TOILET.x0 + T, TOILET.z0 + T, SIDE);

/* ===================== FLOOR, ROOF, FRAME, FOOTINGS ===================== */
box(L, FLOOR_T, W, M.floor, L / 2, BASE + FLOOR_T / 2, W / 2, cabin, 'Floor');
box(L - T - TOILET.x0 - T, 0.006, W - T - TOILET.z0 - T, M.fibre,
    (TOILET.x0 + T + L - T) / 2, FFL + 0.003, (TOILET.z0 + T + W - T) / 2, cabin, 'Toilet_Floor');
box(L, ROOF_T, W, M.roof, L / 2, FFL + WALL_H + ROOF_T / 2, W / 2, cabin, 'Roof_Slab');

const e = 0.004;   // tiny offsets stop coincident faces flickering
box(L + e, ROOF_T,  0.03, M.steel, L / 2, FFL + WALL_H + ROOF_T / 2, -e / 2,       cabin, 'Roof_Band_Front');
box(L + e, ROOF_T,  0.03, M.steel, L / 2, FFL + WALL_H + ROOF_T / 2, W + e / 2,    cabin, 'Roof_Band_Rear');
box(L + e, FLOOR_T, 0.03, M.steel, L / 2, BASE + FLOOR_T / 2, -0.015 + e,          cabin, 'Base_Frame_Front');
box(L + e, FLOOR_T, 0.03, M.steel, L / 2, BASE + FLOOR_T / 2, W + 0.015 - e,       cabin, 'Base_Frame_Rear');
box(0.03,  FLOOR_T, W,    M.steel, -0.015 + e, BASE + FLOOR_T / 2, W / 2,          cabin, 'Base_Frame_Left');
box(0.03,  FLOOR_T, W,    M.steel, L + 0.015 - e, BASE + FLOOR_T / 2, W / 2,       cabin, 'Base_Frame_Right');

let n = 1;
for (const [cx, cz] of [[0, 0], [L, 0], [0, W], [L, W]]) {
  const p = 0.002;
  const x = cx === 0 ? POST / 2 - p : L - POST / 2 + p;
  const z = cz === 0 ? POST / 2 - p : W - POST / 2 + p;
  box(POST + 2 * p, CAB_H - ROOF_T, POST + 2 * p, M.steel, x, BASE + (CAB_H - ROOF_T) / 2, z, cabin, `Corner_Post_${n++}`);
}

// 6 nos base footings, 200 mm high (corners + mid-length, per drawing schedule)
const footGeo = new THREE.CylinderGeometry(0.2 / Math.SQRT2, 0.3 / Math.SQRT2, FOOT_H, 4);
footGeo.rotateY(Math.PI / 4);   // square frustum 200 top / 300 base
n = 1;
for (const x of [0.15, L / 2, L - 0.15]) for (const z of [0.15, W - 0.15]) {
  const f = new THREE.Mesh(footGeo, M.concrete);
  f.name = `Footing_${n++}`;
  f.position.set(x, FOOT_H / 2, z);
  cabin.add(f);
}

/* =============================== WINDOWS =============================== */
function makeWindow(name, w, h, { sliding = false, grill = false, transoms = 0 } = {}) {
  const g = new THREE.Group(); g.name = name;
  const f = 0.04, d = T, iw = w - 2 * f, ih = h - 2 * f;
  box(w, f, d, M.alu, 0,  h / 2 - f / 2, 0, g);
  box(w, f, d, M.alu, 0, -h / 2 + f / 2, 0, g);
  box(f, ih, d, M.alu, -w / 2 + f / 2, 0, 0, g);
  box(f, ih, d, M.alu,  w / 2 - f / 2, 0, 0, g);
  if (sliding) {
    const sw = iw / 2 + 0.02;
    for (const [x, z, side] of [[-iw / 2 + sw / 2, 0.009, 1], [iw / 2 - sw / 2, -0.009, -1]]) {
      box(sw, ih, 0.004, M.glass, x, 0, z, g);   // thin solid pane (USDZ has no double-sided)
      box(0.03, ih, 0.014, M.alu, x + side * (sw / 2 - 0.015), 0, z, g);
    }
  } else {
    box(iw, ih, 0.004, M.glass, 0, 0, 0, g);
    for (let k = 1; k <= transoms; k++) box(iw, 0.02, 0.02, M.alu, 0, -ih / 2 + (ih / (transoms + 1)) * k, 0, g);
  }
  if (grill) {
    for (let k = 1; k < 6; k++) box(0.012, ih, 0.012, M.grill, -iw / 2 + (iw / 6) * k, 0, d / 2 - 0.006, g);
    box(iw, 0.012, 0.012, M.grill, 0, 0, d / 2 - 0.006, g);
  }
  return g;
}
function place(win, s, z, rotY = 0) {
  win.position.set((s.u0 + s.u1) / 2, FFL + (s.v0 + s.v1) / 2, z);
  win.rotation.y = rotY;
  cabin.add(win);
}
place(makeWindow('W1_Sliding_Window_A', 0.9, 1.2, { sliding: true, grill: true }), W1A, T / 2);
place(makeWindow('W1_Sliding_Window_B', 0.9, 1.2, { sliding: true, grill: true }), W1B, T / 2);
place(makeWindow('W2_TopHung_Window', 0.3, 0.45, { transoms: 2 }), W2, W - T / 2, Math.PI);

/* ================================ DOORS ================================ */
{
  const g = new THREE.Group(); g.name = 'D1_Steel_Door';
  g.position.set(D1.u0, FFL, T / 2);
  const w = D1.u1 - D1.u0 - 0.01;
  box(w, D1.h - 0.01, 0.04, M.door, w / 2, D1.h / 2, 0, g);
  box(0.12, 0.025, 0.03, M.alu, w - 0.1, 1.0, -0.035, g);
  box(0.12, 0.025, 0.03, M.alu, w - 0.1, 1.0,  0.035, g);
  cabin.add(g);
}
{
  const g = new THREE.Group(); g.name = 'D2_PVC_Door';
  g.position.set(TOILET.x0 + T / 2, FFL, D2.z1);
  const w = D2.z1 - D2.z0 - 0.01;
  box(0.04, D2.h - 0.01, w, M.pvc, 0, D2.h / 2, -w / 2, g);
  box(0.03, 0.025, 0.12, M.alu, -0.035, 1.0, -w + 0.1, g);
  box(0.03, 0.025, 0.12, M.alu,  0.035, 1.0, -w + 0.1, g);
  cabin.add(g);
}

/* ===================== RE-ORIGIN: FLOOR CENTRE, FRONT → +Z ===================== */
cabin.rotation.y = Math.PI;                 // front (z = 0 face) now faces +Z
cabin.position.set(L / 2, -FFL, W / 2);     // floor centre at FFL → (0, 0, 0)

const root = new THREE.Group();
root.name = 'SHSB_20FT_MOBIN_Detachable_Cabin';
root.add(cabin);
root.updateMatrixWorld(true);

const bb = new THREE.Box3().setFromObject(root);
const sz = bb.getSize(new THREE.Vector3());
console.log(`Bounding box (m): ${sz.x.toFixed(3)} × ${sz.y.toFixed(3)} × ${sz.z.toFixed(3)}`);
console.log(`Y range: ${bb.min.y.toFixed(3)} → ${bb.max.y.toFixed(3)}  (0 = FFL)`);

/* ================================ EXPORT ================================ */
const glb = await new GLTFExporter().parseAsync(root, { binary: true });
fs.writeFileSync(path.join(OUT_DIR, 'mobin_20ft.glb'), Buffer.from(glb));
console.log(`mobin_20ft.glb   ${(glb.byteLength / 1024).toFixed(0)} KB`);

const usdz = await new USDZExporter().parse(root);
fs.writeFileSync(path.join(OUT_DIR, 'mobin_20ft.usdz'), Buffer.from(usdz));
console.log(`mobin_20ft.usdz  ${(usdz.byteLength / 1024).toFixed(0)} KB`);
