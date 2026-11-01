// Visionneuse Three.js : modèle importé + Kidas de référence (squelette).
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { TARGET_HEIGHT } from './geom.js';

export function buildGeometry({ pos, uv, index, normals }) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  if (normals) g.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  if (uv) g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(new THREE.BufferAttribute(index, 1));
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

export function createViewer(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0e1116);
  const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 100);
  camera.position.set(0, 1.2, 4.5);
  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, 0.9, 0);
  controls.enableDamping = true;

  scene.add(new THREE.HemisphereLight(0xffffff, 0x303848, 1.1));
  const sun = new THREE.DirectionalLight(0xffffff, 1.8);
  sun.position.set(2, 4, 3);
  scene.add(sun);
  scene.add(new THREE.GridHelper(8, 16, 0x2a3140, 0x1b212c));

  let mesh = null, kidas = null, skel = null, wire = false;

  function resize() {
    const r = canvas.parentElement.getBoundingClientRect();
    const w = Math.max(1, Math.floor(r.width)), h = Math.max(1, Math.floor(r.height));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(canvas.parentElement);
  resize();

  function frame() {
    const box = new THREE.Box3();
    if (mesh) box.expandByObject(mesh);
    if (kidas && kidas.visible) box.expandByObject(kidas);
    if (box.isEmpty()) return;
    const c = box.getCenter(new THREE.Vector3());
    const s = box.getSize(new THREE.Vector3());
    const half = Math.max(s.y, s.x / camera.aspect) / 2;
    const dist = half / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * 1.2 + s.z / 2;
    camera.position.set(c.x, c.y + 0.1, c.z + dist);
    controls.target.copy(c);
    controls.update();
  }

  renderer.setAnimationLoop(() => {
    controls.update();
    renderer.render(scene, camera);
  });

  return {
    setMesh(geometry, material) {
      const first = !mesh;
      if (mesh) { scene.remove(mesh); mesh.geometry.dispose(); }
      material.wireframe = wire;
      mesh = new THREE.Mesh(geometry, material);
      scene.add(mesh);
      if (first) frame();
    },
    setWireframe(v) {
      wire = v;
      if (mesh) mesh.material.wireframe = v;
    },
    frame,
    async showKidas(url) {
      if (kidas) { kidas.visible = true; skel.visible = true; frame(); return this.kidasInfo; }
      const fbx = await new Promise((ok, ko) =>
        new FBXLoader().load(url, ok, undefined, () => ko(new Error('Impossible de charger ' + url + ' (fichier absent du dépôt ?)'))));
      fbx.updateMatrixWorld(true);
      let box = new THREE.Box3().setFromObject(fbx);
      const h = box.max.y - box.min.y;
      if (isFinite(h) && h > 0) fbx.scale.multiplyScalar(TARGET_HEIGHT / h);
      fbx.updateMatrixWorld(true);
      box = new THREE.Box3().setFromObject(fbx);
      fbx.position.x += 2.0 - (box.min.x + box.max.x) / 2;
      fbx.position.y -= box.min.y;
      fbx.updateMatrixWorld(true);
      let bones = 0, hips = false;
      fbx.traverse(o => {
        if (o.isBone) { bones++; if (/hips/i.test(o.name)) hips = true; }
        if (o.isMesh) {
          for (const m of [].concat(o.material)) { m.transparent = true; m.opacity = 0.3; m.depthWrite = false; }
        }
      });
      skel = new THREE.SkeletonHelper(fbx);
      skel.material.depthTest = false;
      scene.add(fbx, skel);
      kidas = fbx;
      this.kidasInfo = { bones, hips };
      frame();
      return this.kidasInfo;
    },
    hideKidas() {
      if (kidas) { kidas.visible = false; skel.visible = false; frame(); }
    },
  };
}
