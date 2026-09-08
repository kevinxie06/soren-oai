import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

export function surfaceTexture(kind: "cloth" | "skin" | "floor") {
  const size = 256, data = new Uint8Array(size * size * 4);
  let seed = 9147;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const noise = (seed / 4294967296 - .5);
    const value = kind === "cloth" ? 175 + 24 * Math.sin(x * Math.PI / 2) * Math.cos(y * Math.PI / 2) + noise * 15
      : kind === "skin" ? 180 + noise * 48 + 10 * Math.sin(x * .13) * Math.cos(y * .17)
        : 175 + noise * 30;
    const i = (y * size + x) * 4;
    data[i] = data[i + 1] = data[i + 2] = value; data[i + 3] = 255;
  }
  const texture = new THREE.DataTexture(data, size, size);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter; texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true; texture.needsUpdate = true;
  texture.repeat.setScalar(kind === "cloth" ? 14 : kind === "floor" ? 12 : 3);
  texture.anisotropy = 8;
  return texture;
}

export function tube(points: number[][], radius: number, material: THREE.Material, segments = 64) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3().fromArray(p)));
  const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, segments, radius, 10, false), material);
  mesh.castShadow = true; mesh.receiveShadow = true; return mesh;
}

// A continuous covered body surface. The exposed face is loaded from a scan.
export function patientBody() {
  const patient = new THREE.Group(); patient.name = "adult_patient";
  const pores = surfaceTexture("skin");
  const skin = new THREE.MeshPhysicalMaterial({ color: "#c28d77", roughness: .58,
    bumpMap: pores, bumpScale: .00018, clearcoat: .12, clearcoatRoughness: .65 });
  const sections = [
    [-.59, .105, .065], [-.43, .165, .09], [-.27, .145, .085], [-.08, .18, .105],
    [.12, .195, .11], [.28, .205, .09], [.37, .125, .066], [.44, .053, .052], [.48, .047, .048],
  ];
  const positions: number[] = [], uvs: number[] = [], indices: number[] = [];
  const rows = 96, sides = 64;
  for (let row = 0; row <= rows; row++) {
    const t = row / rows * (sections.length - 1), a = Math.min(Math.floor(t), sections.length - 2), f = t - a;
    const smooth = f * f * (3 - 2 * f);
    const y = THREE.MathUtils.lerp(sections[a][0], sections[a + 1][0], f);
    const width = THREE.MathUtils.lerp(sections[a][1], sections[a + 1][1], smooth);
    const depth = THREE.MathUtils.lerp(sections[a][2], sections[a + 1][2], smooth);
    for (let col = 0; col <= sides; col++) {
      const angle = col / sides * Math.PI * 2;
      positions.push(width * Math.cos(angle), y, -.085 + depth * Math.sin(angle));
      uvs.push(col / sides, row / rows);
      if (row < rows && col < sides) {
        const i = row * (sides + 1) + col;
        indices.push(i, i + sides + 1, i + 1, i + 1, i + sides + 1, i + sides + 2);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  const openBody: number[] = [];
  for (let i = 0; i < indices.length; i += 3) {
    const ids = indices.slice(i, i + 3);
    const center = [0, 1, 2].map((axis) => ids.reduce((sum, j) => sum + positions[j * 3 + axis], 0) / 3);
    if (Math.abs(center[0]) >= .095 || Math.abs(center[1]) >= .105 || center[2] < -.05) openBody.push(...ids);
  }
  geometry.setIndex(openBody); geometry.computeVertexNormals();
  const body = new THREE.Mesh(geometry, skin); body.castShadow = true; body.receiveShadow = true; patient.add(body);
  // Limbs are tucked at the sides and below the sterile drape.
  for (const side of [-1, 1]) {
    patient.add(tube([[side * .18, .27, -.085], [side * .245, .02, -.1], [side * .22, -.29, -.1]], .044, skin));
    patient.add(tube([[side * .085, -.43, -.085], [side * .09, -.76, -.09], [side * .095, -1.13, -.11]], .065, skin));
  }
  const pillow = new THREE.Mesh(new RoundedBoxGeometry(.38, .32, .065, 5, .025),
    new THREE.MeshStandardMaterial({ color: "#d9e5e0", roughness: .95, bumpMap: surfaceTexture("cloth"), bumpScale: .0008 }));
  pillow.position.set(0, .585, -.13); pillow.receiveShadow = true; patient.add(pillow);
  return patient;
}

export function operativeDetails(trayPosition: number[]) {
  const group = new THREE.Group(); group.name = "operative_details";
  const metal = new THREE.MeshPhysicalMaterial({ color: "#c7d0d1", metalness: .96, roughness: .22, clearcoat: .2 });
  const tissue = new THREE.MeshPhysicalMaterial({ color: "#8d3d3b", roughness: .42, clearcoat: .45,
    clearcoatRoughness: .25, bumpMap: surfaceTexture("skin"), bumpScale: .0004, side: THREE.DoubleSide });
  // Open field lining replaces the box walls but keeps the recorded opening dimensions.
  const lining = new THREE.BufferGeometry(); const vertices: number[] = [], indices: number[] = [];
  for (let row = 0; row < 2; row++) for (let i = 0; i <= 96; i++) {
    const a = i / 96 * Math.PI * 2;
    const x = Math.sign(Math.cos(a)) * Math.abs(Math.cos(a)) ** .75;
    const y = Math.sign(Math.sin(a)) * Math.abs(Math.sin(a)) ** .75;
    vertices.push(x * (row ? .073 : .093), y * (row ? .076 : .098), row ? -.025 : .044 + .002 * Math.sin(a * 9));
    if (!row && i < 96) indices.push(i, i + 1, i + 97, i + 1, i + 98, i + 97);
  }
  lining.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3)); lining.setIndex(indices); lining.computeVertexNormals();
  group.add(new THREE.Mesh(lining, tissue));
  const base = new THREE.Mesh(new THREE.CircleGeometry(.112, 64), tissue); base.position.z = -.027; group.add(base);
  for (const side of [-1, 1]) {
    group.add(tube([[side * .081, -.065, .054], [side * .087, 0, .057], [side * .081, .065, .054]], .003, metal));
    group.add(tube([[side * .086, 0, .057], [side * .13, 0, .066], [side * .145, -.05, .066]], .003, metal));
  }
  const tray = new THREE.Mesh(new RoundedBoxGeometry(.195, .195, .012, 5, .009), metal);
  tray.position.set(trayPosition[0], trayPosition[1], -.006); tray.receiveShadow = true; group.add(tray);
  const rim = [[-.093, -.093], [.093, -.093], [.093, .093], [-.093, .093], [-.093, -.093]];
  group.add(tube(rim.map(([x, y]) => [x + trayPosition[0], y + trayPosition[1], .016]), .005, metal));
  const gauze = new THREE.Mesh(new RoundedBoxGeometry(.075, .055, .006, 3, .003),
    new THREE.MeshStandardMaterial({ color: "#dddcc7", roughness: 1, bumpMap: surfaceTexture("cloth"), bumpScale: .0009 }));
  gauze.position.set(-.16, -.16, .038); gauze.rotation.z = .2; group.add(gauze);
  // Ancillary tubing has its own path and does not animate the patient's physiology.
  const hose = new THREE.MeshPhysicalMaterial({ color: "#9bbdb6", roughness: .35, transmission: .15, thickness: .002 });
  group.add(tube([[.19, .13, .045], [.3, .25, .015], [.41, .2, -.12], [.48, .4, -.6], [.82, .65, -.75]], .007, hose));
  return group;
}

export function presentationHeart() {
  const group = new THREE.Group();
  const geometry = new THREE.SphereGeometry(1, 64, 48);
  const pos = geometry.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const taper = .73 + .27 * (y + 1) / 2;
    pos.setXYZ(i, x * .028 * taper + .005 * (1 - y), y * .032,
      z * .023 * (1 + .1 * Math.sin(x * 5 + y * 3)));
  }
  geometry.computeVertexNormals();
  const flesh = new THREE.MeshPhysicalMaterial({ color: "#863d3b", roughness: .36, clearcoat: .65,
    clearcoatRoughness: .22, bumpMap: surfaceTexture("skin"), bumpScale: .0003 });
  const heart = new THREE.Mesh(geometry, flesh); heart.castShadow = true; heart.receiveShadow = true; group.add(heart);
  const vessel = new THREE.MeshPhysicalMaterial({ color: "#ab6960", roughness: .38, clearcoat: .5 });
  for (const side of [-1, 1]) {
    group.add(tube([[side * .005, .025, .018], [side * .011, .008, .023], [side * .016, -.007, .021], [.009, -.025, .011]], .0012, vessel));
    group.add(tube([[side * .011, .008, .023], [side * .019, .004, .018], [side * .023, -.003, .014]], .0007, vessel));
  }
  group.add(tube([[.003, .015, 0], [.005, .035, .003], [-.005, .039, .005], [-.012, .03, .008]], .004, vessel));
  return group;
}
