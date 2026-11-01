// Réduction de triangles avec meshoptimizer (WebAssembly).
import { MeshoptSimplifier } from 'meshoptimizer';
import { compact } from './geom.js?v=6';

// data = { pos: Float32Array, uv: Float32Array|null, index: Uint32Array }
export async function simplify(data, targetTris) {
  await MeshoptSimplifier.ready;
  if (MeshoptSimplifier.supported === false) throw new Error('WebAssembly non supporté par ce navigateur.');
  const before = data.index.length / 3;
  if (before <= targetTris) return { ...data, before, after: before, usedUV: !!data.uv };

  const target = Math.floor(targetTris) * 3;
  let res = null, usedUV = false;
  if (data.uv && typeof MeshoptSimplifier.simplifyWithAttributes === 'function') {
    try {
      // meshoptimizer 0.20.0 : pas de paramètre vertex_lock
      res = MeshoptSimplifier.simplifyWithAttributes(data.index, data.pos, 3, data.uv, 2, [1, 1], target, 0.2, []);
      usedUV = true;
    } catch (e) {
      console.warn('simplifyWithAttributes indisponible, repli sans UV :', e);
    }
  }
  if (!res) res = MeshoptSimplifier.simplify(data.index, data.pos, 3, target, 0.2, []);

  const out = compact(data.pos, data.uv, res[0]);
  return { ...out, before, after: out.index.length / 3, usedUV };
}
