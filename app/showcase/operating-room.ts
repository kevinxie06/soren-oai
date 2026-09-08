import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { patientBody, surfaceTexture, tube } from "./surgical-detail";
import type { Motion } from "./types";

// Presentation coordinates: metres, Z up, operative field at the origin.
export function operatingRoom(motion: Motion | { sample_hz: number; duration_s: number; toolPath: number[][] }) {
  const room = new THREE.Group();
  const steel = new THREE.MeshStandardMaterial({ color: "#abb9bc", metalness: .88, roughness: .26 });
  const enamel = new THREE.MeshStandardMaterial({ color: "#dde5e1", roughness: .32, metalness: .12 });
  const rubber = new THREE.MeshStandardMaterial({ color: "#263436", roughness: .86 });
  const wall = new THREE.MeshStandardMaterial({ color: "#b4c9c5", roughness: .83 });
  const fabric = new THREE.MeshPhysicalMaterial({ color: "#246f7b", roughness: .94, side: THREE.DoubleSide,
    bumpMap: surfaceTexture("cloth"), bumpScale: .00025, sheen: .35, sheenColor: new THREE.Color("#79afad"), sheenRoughness: .9 });
  const glow = new THREE.MeshStandardMaterial({ color: "#f3fff9", emissive: "#e4fff4", emissiveIntensity: 2 });
  function box(size: number[], p: number[], material: THREE.Material, radius = .015) {
    const m = new THREE.Mesh(new RoundedBoxGeometry(size[0], size[1], size[2], 3, radius), material);
    m.position.fromArray(p); m.castShadow = true; m.receiveShadow = true; room.add(m); return m;
  }
  function rod(a: number[], b: number[], radius: number, material = steel) {
    const start = new THREE.Vector3().fromArray(a), end = new THREE.Vector3().fromArray(b);
    const d = end.clone().sub(start);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, d.length(), 20), material);
    m.position.copy(start).add(end).multiplyScalar(.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
    m.castShadow = true; room.add(m);
  }
  box([6, 6, .08], [0, 0, -.99], new THREE.MeshStandardMaterial({ color: "#7e9696", roughness: .48,
    bumpMap: surfaceTexture("floor"), bumpScale: .001 }));
  box([6, .08, 3.1], [0, 2.3, .55], wall);
  box([.08, 5.3, 3.1], [-2.7, -.3, .55], wall);
  for (let x = -2; x <= 2; x++) {
    box([.008, .012, 2.85], [x, 2.25, .55], steel, .002);
    box([.75, .6, .045], [x, 1.5, 2.05], glow);
  }
  box([1.1, .045, 2.2], [-1.65, 2.23, .15], enamel);
  box([.58, .02, .6], [-1.65, 2.195, .59], new THREE.MeshStandardMaterial({ color: "#29474b", metalness: .3, roughness: .17 }));
  rod([-1.22, 2.15, -.15], [-1.22, 2.15, .2], .015);
  // Articulated table, mattress sections, side rails and pedestal.
  box([.7, 2.16, .075], [0, -.23, -.235], steel);
  for (const [y, length] of [[.55, .47], [-.02, .64], [-.83, .94]]) {
    box([.62, length, .075], [0, y, -.17], rubber, .025);
  }
  box([.28, .48, .5], [0, -.18, -.54], enamel);
  box([.68, 1.05, .12], [0, -.18, -.85], steel, .04);
  for (const x of [-.37, .37]) rod([x, -.95, -.26], [x, .7, -.26], .014);
  room.add(patientBody());
  // Floor-mounted robot pedestal aligned to the Panda base in the IK export.
  box([.33, .33, .075], [.65, -.28, -.16], steel);
  box([.22, .22, .71], [.65, -.28, -.55], enamel);
  box([.48, .48, .055], [.65, -.28, -.923], steel);
  for (const x of [.49, .81]) for (const y of [-.44, -.12]) {
    rod([x, y, -.9], [x, y, -.882], .012, rubber);
  }
  room.add(tube([[.71, -.3, -.18], [.82, -.3, -.4], [.83, -.38, -.89], [1.05, -.9, -.935], [1.8, -.7, -.935]], .012, rubber));
  // Continuous drape with an open operative field. Fold geometry follows a covered body.
  const cloth = new THREE.PlaneGeometry(1.18, 1.75, 120, 160);
  const pos = cloth.attributes.position;
  const coordinate = (index: number, points: number[], counts: number[]) => {
    for (let j = 0; j < counts.length; j++) {
      if (index <= counts[j]) return THREE.MathUtils.lerp(points[j], points[j + 1], index / counts[j]);
      index -= counts[j];
    }
    return points[points.length - 1];
  };
  for (let i = 0; i < pos.count; i++) {
    // Align mesh rows exactly to the opening so its hem has no sawtooth edges.
    const x = coordinate(i % 121, [-.59, -.098, .098, .59], [50, 20, 50]);
    const y = coordinate(Math.floor(i / 121), [.47, .103, -.103, -1.28], [42, 28, 90]);
    const shoulder = .27 + .02 * Math.exp(-(((y - .25) / .22) ** 2));
    const overhang = Math.max(0, Math.abs(x) - shoulder);
    const bodyHeight = .048 - .045 * THREE.MathUtils.smoothstep(-y, .3, 1.1);
    const crease = Math.sin(y * 19 + x * 12) * .012 * Math.min(1, Math.abs(x) / .24);
    const z = bodyHeight - .07 * (Math.min(Math.abs(x), shoulder) / shoulder) ** 2 - overhang * 1.6
      + crease + .003 * Math.sin(y * 41 + Math.abs(x) * 27);
    pos.setXYZ(i, x, y, z);
  }
  const source = cloth.index!; const indices: number[] = [];
  for (let i = 0; i < source.count; i += 3) {
    const ids = [source.getX(i), source.getX(i + 1), source.getX(i + 2)];
    const x = ids.reduce((s, j) => s + pos.getX(j), 0) / 3;
    const y = ids.reduce((s, j) => s + pos.getY(j), 0) / 3;
    if (Math.abs(x) > .098 || Math.abs(y) > .103) indices.push(...ids);
  }
  cloth.setIndex(indices); cloth.computeVertexNormals();
  const drape = new THREE.Mesh(cloth, fabric); drape.castShadow = true; drape.receiveShadow = true; room.add(drape);
  // Equipment trolley, storage and a powered-off monitor (no invented patient data).
  for (const x of [.95, 1.45]) for (const y of [.4, .95]) {
    rod([x, y, -.88], [x, y, .05], .017);
    box([.08, .08, .09], [x, y, -.9], rubber);
  }
  for (const z of [-.72, -.38, .04]) box([.6, .65, .035], [1.2, .675, z], steel);
  box([.48, .38, .22], [1.2, .68, .17], enamel);
  rod([1.2, .8, .25], [1.2, .8, .6], .027);
  box([.55, .08, .36], [1.2, .77, .62], rubber);
  const display = document.createElement("canvas"); display.width = 1024; display.height = 640;
  const ctx = display.getContext("2d")!;
  ctx.fillStyle = "#08171b"; ctx.fillRect(0, 0, 1024, 640);
  ctx.fillStyle = "#9edbd3"; ctx.font = "32px sans-serif"; ctx.fillText("ROBOT TOOL PATH", 42, 65);
  ctx.fillStyle = "#789a9e"; ctx.font = "20px monospace"; ctx.fillText("RECORDED SIMULATION / X-Z", 42, 108);
  ctx.strokeStyle = "#173236"; ctx.lineWidth = 2;
  for (let x = 50; x < 700; x += 65) { ctx.beginPath(); ctx.moveTo(x, 150); ctx.lineTo(x, 550); ctx.stroke(); }
  for (let y = 150; y < 560; y += 50) { ctx.beginPath(); ctx.moveTo(50, y); ctx.lineTo(700, y); ctx.stroke(); }
  const palm = "geometry" in motion ? motion.geometry.findIndex((g) => g.name === "palm") : -1;
  const toolPath = "toolPath" in motion ? motion.toolPath : palm >= 0 ? motion.frames.map(f=>f.poses[palm].position_m) : [];
  if (toolPath.length) {
    ctx.strokeStyle = "#80d9c1"; ctx.lineWidth = 5; ctx.beginPath();
    toolPath.forEach((p, i) => {
      const x = 100 + p[0] * 1800, y = 570 - p[2] * 1300;
      if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    });
    ctx.stroke();
  }
  ctx.fillStyle = "#d9ede8"; ctx.font = "38px monospace"; ctx.fillText(`${motion.sample_hz} Hz`, 752, 225);
  ctx.fillText(`${motion.duration_s.toFixed(2)} s`, 752, 355);
  ctx.fillStyle = "#789a9e"; ctx.font = "18px monospace"; ctx.fillText("POSE SAMPLING", 752, 263); ctx.fillText("EPISODE", 752, 393);
  ctx.fillText("SOURCE POLICY REPLAY", 42, 600);
  const screenTexture = new THREE.CanvasTexture(display); screenTexture.colorSpace = THREE.SRGBColorSpace;
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(.49, .29), new THREE.MeshBasicMaterial({ map: screenTexture, toneMapped: false }));
  screen.rotation.x = Math.PI / 2; screen.position.set(1.2, .722, .62); room.add(screen);
  for (let i = 0; i < 3; i++) {
    box([.46, .34, .075], [1.2, .675, -.65 + i * .085], enamel);
    rod([1.05, .485, -.65 + i * .085], [1.35, .485, -.65 + i * .085], .009);
  }
  for (let i = 0; i < 12; i++) box([.24, .004, .003], [1.2, .481, .12 + i * .008], rubber, .001);
  // IV pole and transparent fluid bag, with a hanging line.
  rod([-.58, .75, -.9], [-.58, .75, 1.1], .012);
  rod([-.73, .75, 1.05], [-.43, .75, 1.05], .009);
  for (let i = 0; i < 5; i++) {
    const a = i / 5 * Math.PI * 2;
    rod([-.58, .75, -.85], [-.58 + .23 * Math.cos(a), .75 + .23 * Math.sin(a), -.91], .014);
  }
  const bag = new THREE.MeshPhysicalMaterial({ color: "#d3e1d7", roughness: .25, transmission: .65, thickness: .025, transparent: true, opacity: .8 });
  box([.1, .035, .18], [-.69, .75, .9], bag);
  room.add(tube([[-.69, .75, .8], [-.7, .73, .5], [-.65, .55, .1], [-.3, .2, -.02]], .002, enamel));
  // Ceiling booms and two multi-lens surgical light heads.
  for (const x of [-.6, .65]) {
    rod([x, .65, 2.05], [x, .65, 1.55], .035, enamel);
    rod([x, .65, 1.55], [x, .05, 1.55], .04, enamel);
    box([.5, .4, .065], [x, .05, 1.48], enamel, .08);
    for (const dx of [-.15, 0, .15]) for (const dy of [-.1, .1]) {
      const lens = new THREE.Mesh(new THREE.CylinderGeometry(.05, .05, .015, 24), glow);
      lens.rotation.x = Math.PI / 2; lens.position.set(x + dx, .05 + dy, 1.44); room.add(lens);
    }
    const light = new THREE.SpotLight(0xf2fff7, 4, 4, .65, .7, 2);
    light.position.set(x, .05, 1.42); light.target.position.set(0, 0, 0);
    room.add(light, light.target);
  }
  return room;
}
