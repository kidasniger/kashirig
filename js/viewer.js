// Visionneuse Three.js : modèle importé + Kidas de référence (squelette).
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { TARGET_HEIGHT } from './geom.js?v=6';

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
  // Thème clair / sombre automatique (réglage du téléphone).
  const THEMES = {
    dark: { bg: 0x0e1116, ground: 0x303848, grid1: 0x2a3140, grid2: 0x1b212c, ink: 0xffffff, bone: 0x39d0ff },
    light: { bg: 0xe8ecf2, ground: 0x9aa4b5, grid1: 0xaab4c3, grid2: 0xcfd6e0, ink: 0x1b2330, bone: 0x0a7ea4 },
  };
  const mq = window.matchMedia('(prefers-color-scheme: light)');
  let theme = mq.matches ? THEMES.light : THEMES.dark;
  scene.background = new THREE.Color(theme.bg);
  const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 100);
  camera.position.set(0, 1.2, 4.5);
  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, 0.9, 0);
  controls.enableDamping = true;

  const hemi = new THREE.HemisphereLight(0xffffff, theme.ground, 1.1);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 1.8);
  sun.position.set(2, 4, 3);
  scene.add(sun);
  let grid = new THREE.GridHelper(8, 16, theme.grid1, theme.grid2);
  scene.add(grid);

  let mesh = null, kidas = null, skel = null, wire = false;
  const markers = new THREE.Group();
  scene.add(markers);
  const skelGroup = new THREE.Group();
  scene.add(skelGroup);

  function applyTheme() {
    theme = mq.matches ? THEMES.light : THEMES.dark;
    scene.background.set(theme.bg);
    hemi.groundColor.set(theme.ground);
    scene.remove(grid);
    grid.geometry.dispose(); grid.material.dispose();
    grid = new THREE.GridHelper(8, 16, theme.grid1, theme.grid2);
    scene.add(grid);
    for (const g of [markers, skelGroup]) {
      for (const c of g.children) {
        if (c.userData.ink) c.material.color.set(theme.ink);
        if (c.userData.bone) c.material.color.set(theme.bone);
      }
    }
  }
  if (mq.addEventListener) mq.addEventListener('change', applyTheme);
  else if (mq.addListener) mq.addListener(applyTheme);

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

  const clock = new THREE.Clock();
  let tickFn = null;
  renderer.setAnimationLoop(() => {
    const dt = clock.getDelta();
    if (tickFn) tickFn(dt);
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
    setTick(fn) { tickFn = fn; },
    // Remplace l'objet affiché (ex. un SkinnedMesh) sans le recréer.
    setObject(obj) {
      if (mesh) { scene.remove(mesh); if (mesh.geometry) mesh.geometry.dispose(); }
      mesh = obj;
      scene.add(obj);
    },
    setWireframe(v) {
      wire = v;
      if (mesh) mesh.material.wireframe = v;
    },
    frame,
    // items : [{ p:[x,y,z], color, ring }] ; line : suite de points reliés (axe du corps)
    setMarkers(items, line) {
      for (const c of [...markers.children]) {
        markers.remove(c);
        if (c.geometry) c.geometry.dispose();
        if (c.material) c.material.dispose();
      }
      const add = o => { o.renderOrder = 999; o.material.depthTest = false; o.material.transparent = true; markers.add(o); };
      for (const it of items) {
        if (!it.p) continue;
        const s = new THREE.Mesh(new THREE.SphereGeometry(0.022, 16, 12), new THREE.MeshBasicMaterial({ color: it.color }));
        s.position.set(it.p[0], it.p[1], it.p[2]);
        add(s);
        if (it.ring) {
          const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-0.3, it.p[1], it.p[2]), new THREE.Vector3(0.3, it.p[1], it.p[2])]);
          add(new THREE.Line(g, new THREE.LineBasicMaterial({ color: it.color, opacity: 0.8 })));
        }
      }
      if (line && line.length > 1) {
        const g = new THREE.BufferGeometry().setFromPoints(line.map(p => new THREE.Vector3(p[0], p[1], p[2])));
        const axis = new THREE.Line(g, new THREE.LineBasicMaterial({ color: theme.ink, opacity: 0.5 }));
        axis.userData.ink = true;
        add(axis);
      }
    },
    // Squelette recalé : rig.bones (parent p) + positions (Float32Array x,y,z par os).
    setSkeleton(rig, pos) {
      for (const c of [...skelGroup.children]) {
        skelGroup.remove(c); c.geometry.dispose(); c.material.dispose();
      }
      if (!rig || !pos) return;
      const seg = [];
      rig.bones.forEach((b, i) => {
        if (b.p < 0) return;
        seg.push(pos[b.p * 3], pos[b.p * 3 + 1], pos[b.p * 3 + 2], pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
      });
      const lg = new THREE.BufferGeometry();
      lg.setAttribute('position', new THREE.Float32BufferAttribute(seg, 3));
      const lines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: theme.bone, depthTest: false, transparent: true }));
      const pg = new THREE.BufferGeometry();
      pg.setAttribute('position', new THREE.Float32BufferAttribute(Array.from(pos), 3));
      const pts = new THREE.Points(pg, new THREE.PointsMaterial({ color: theme.ink, size: 4, sizeAttenuation: false, depthTest: false, transparent: true }));
      lines.userData.bone = true;
      pts.userData.ink = true;
      lines.renderOrder = pts.renderOrder = 998;
      skelGroup.add(lines, pts);
    },
    setSkeletonVisible(on) { skelGroup.visible = on; },
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
