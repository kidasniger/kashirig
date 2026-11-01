// Import FBX / OBJ(+MTL) / GLB / GLTF -> tableaux bruts (positions monde, UV, index) + un matériau.
import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const MODEL = /\.(glb|gltf|fbx|obj)$/i;
const MAX_BYTES = 200 * 1024 * 1024; // même limite que l'envoi (api/upload.js)

function toStandard(src) {
  const m = Array.isArray(src) ? src[0] : src;
  // Cas fréquent des GLB exportés : texture dans emissiveMap, baseColor noir -> on la met en couleur de base.
  const map = (m && (m.map || m.emissiveMap)) || null;
  let color = 0xcccccc;
  if (map) color = 0xffffff;
  else if (m && m.color && m.color.getHex() !== 0) color = m.color.getHex();
  if (map) map.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshStandardMaterial({ map, color, roughness: 0.85, metalness: 0, side: THREE.DoubleSide });
}

export async function importFiles(fileList) {
  const files = [...fileList];
  const main = files.find(f => MODEL.test(f.name));
  if (!main) throw new Error('Aucun fichier .fbx, .obj, .glb ou .gltf dans la sélection.');
  const total = files.reduce((n, f) => n + f.size, 0);
  if (total > MAX_BYTES) throw new Error('Fichier trop gros : ' + Math.round(total / 1048576) + ' Mo (200 Mo maximum).');

  const urls = new Map(files.map(f => [f.name.toLowerCase(), URL.createObjectURL(f)]));
  const manager = new THREE.LoadingManager();
  manager.setURLModifier(url => {
    if (/^(blob|data):/.test(url)) return url;
    const name = decodeURIComponent(url.split('?')[0].split(/[\\/]/).pop()).toLowerCase();
    return urls.get(name) || url;
  });

  const ext = main.name.split('.').pop().toLowerCase();
  let root;
  if (ext === 'fbx') {
    root = new FBXLoader(manager).parse(await main.arrayBuffer(), '');
  } else if (ext === 'glb' || ext === 'gltf') {
    const data = ext === 'glb' ? await main.arrayBuffer() : await main.text();
    const gltf = await new Promise((ok, ko) => new GLTFLoader(manager).parse(data, '', ok, ko));
    root = gltf.scene;
  } else {
    const loader = new OBJLoader(manager);
    const mtlFile = files.find(f => /\.mtl$/i.test(f.name));
    if (mtlFile) {
      const mtl = new MTLLoader(manager).parse(await mtlFile.text(), '');
      mtl.preload();
      loader.setMaterials(mtl);
    }
    root = loader.parse(await main.text());
  }

  root.updateMatrixWorld(true);
  const parts = [];
  root.traverse(o => { if (o.isMesh && o.geometry && o.geometry.attributes.position) parts.push(o); });
  if (!parts.length) throw new Error('Aucun maillage trouvé dans le fichier.');

  const posList = [], uvList = [], idxList = [];
  let offset = 0, hasUV = false, biggest = parts[0], biggestN = -1;
  const mats = new Set();
  for (const p of parts) {
    const g = p.geometry.clone();
    g.applyMatrix4(p.matrixWorld);
    const pa = g.attributes.position, n = pa.count;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { pos[3 * i] = pa.getX(i); pos[3 * i + 1] = pa.getY(i); pos[3 * i + 2] = pa.getZ(i); }
    const ua = g.attributes.uv;
    const uv = new Float32Array(n * 2);
    if (ua) { hasUV = true; for (let i = 0; i < n; i++) { uv[2 * i] = ua.getX(i); uv[2 * i + 1] = ua.getY(i); } }
    let idx;
    if (g.index) { idx = Uint32Array.from(g.index.array); }
    else { idx = new Uint32Array(n - (n % 3)); for (let i = 0; i < idx.length; i++) idx[i] = i; }
    for (let i = 0; i < idx.length; i++) idx[i] += offset;
    posList.push(pos); uvList.push(uv); idxList.push(idx);
    offset += n;
    mats.add(Array.isArray(p.material) ? p.material[0] : p.material);
    if (n > biggestN) { biggestN = n; biggest = p; }
    g.dispose();
  }

  const cat = (arrs, Type) => {
    const total = arrs.reduce((s, a) => s + a.length, 0);
    const out = new Type(total);
    let o = 0;
    for (const a of arrs) { out.set(a, o); o += a.length; }
    return out;
  };
  const index = cat(idxList, Uint32Array);
  return {
    name: main.name.replace(/\.[^.]+$/, ''),
    pos: cat(posList, Float32Array),
    uv: hasUV ? cat(uvList, Float32Array) : null,
    index,
    material: toStandard(biggest.material),
    info: { meshes: parts.length, materials: mats.size, triangles: index.length / 3 },
  };
}
