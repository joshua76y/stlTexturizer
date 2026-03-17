/**
 * Edge-based adaptive mesh subdivision.
 *
 * Subdivides until every edge is ≤ maxEdgeLength.  A hard safety cap of
 * SAFETY_CAP triangles prevents OOM on very fine settings; the caller
 * (export pipeline) hands the result to the QEM decimator which then trims
 * it to the user-requested budget.
 *
 * @param {THREE.BufferGeometry} geometry   – non-indexed input from STLLoader
 * @param {number} maxEdgeLength            – maximum allowed edge length (same unit as STL)
 * @param {function} [onProgress]           – optional callback(fraction 0–1)
 * @returns {{ geometry: THREE.BufferGeometry, safetyCapHit: boolean }}
 */

import * as THREE from 'three';

const QUANTISE   = 1e4;
const SAFETY_CAP = 5_000_000; // absolute OOM guard

// ── Public entry point ───────────────────────────────────────────────────────

export function subdivide(geometry, maxEdgeLength, onProgress) {
  const { positions, normals, indices } = toIndexed(geometry);

  const maxIterations = 12;
  let currentIndices = indices;
  let safetyCapHit = false;

  for (let iter = 0; iter < maxIterations; iter++) {
    const triCount = currentIndices.length / 3;
    if (triCount >= SAFETY_CAP) {
      safetyCapHit = true;
      break;
    }

    const { newIndices, changed } = subdividePass(
      positions, normals, currentIndices, maxEdgeLength, SAFETY_CAP
    );
    currentIndices = newIndices;

    if (newIndices.length / 3 >= SAFETY_CAP) safetyCapHit = true;

    if (onProgress) onProgress(Math.min(0.95, (iter + 1) / maxIterations));
    if (!changed || safetyCapHit) break;
  }

  return { geometry: toNonIndexed(positions, normals, currentIndices), safetyCapHit };
}

// ── One subdivision pass ──────────────────────────────────────────────────────

function subdividePass(positions, normals, indices, maxEdgeLength, safetyCap) {
  const maxSq = maxEdgeLength * maxEdgeLength;
  const midCache = new Map();
  const nextIndices = [];
  let changed = false;

  for (let t = 0; t < indices.length; t += 3) {
    // Safety cap: stop splitting, carry remaining triangles as-is
    if (nextIndices.length / 3 >= safetyCap) {
      for (let r = t; r < indices.length; r++) nextIndices.push(indices[r]);
      break;
    }

    const a = indices[t];
    const b = indices[t + 1];
    const c = indices[t + 2];

    const ab = edgeLenSq(positions, a, b);
    const bc = edgeLenSq(positions, b, c);
    const ca = edgeLenSq(positions, c, a);

    const longest = Math.max(ab, bc, ca);
    if (longest <= maxSq) {
      // Triangle is fine – keep as is
      nextIndices.push(a, b, c);
      continue;
    }

    changed = true;

    // Split the longest edge
    if (longest === ab) {
      const m = getMidpoint(positions, normals, midCache, a, b);
      nextIndices.push(a, m, c,  m, b, c);
    } else if (longest === bc) {
      const m = getMidpoint(positions, normals, midCache, b, c);
      nextIndices.push(a, b, m,  a, m, c);
    } else {
      const m = getMidpoint(positions, normals, midCache, c, a);
      nextIndices.push(a, b, m,  m, b, c);
    }
  }

  return { newIndices: nextIndices, changed };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function edgeLenSq(pos, a, b) {
  const dx = pos[a*3]   - pos[b*3];
  const dy = pos[a*3+1] - pos[b*3+1];
  const dz = pos[a*3+2] - pos[b*3+2];
  return dx*dx + dy*dy + dz*dz;
}

function getMidpoint(positions, normals, cache, a, b) {
  const key = a < b ? `${a}:${b}` : `${b}:${a}`;
  if (cache.has(key)) return cache.get(key);

  // Midpoint position
  const mx = (positions[a*3]   + positions[b*3])   / 2;
  const my = (positions[a*3+1] + positions[b*3+1]) / 2;
  const mz = (positions[a*3+2] + positions[b*3+2]) / 2;

  // Midpoint normal (average + normalise)
  const nx = normals[a*3]   + normals[b*3];
  const ny = normals[a*3+1] + normals[b*3+1];
  const nz = normals[a*3+2] + normals[b*3+2];
  const nl = Math.sqrt(nx*nx + ny*ny + nz*nz) || 1;

  const idx = (positions.length / 3) | 0;
  positions.push(mx, my, mz);
  normals.push(nx / nl, ny / nl, nz / nl);
  cache.set(key, idx);
  return idx;
}

// ── Non-indexed → indexed conversion ────────────────────────────────────────

function toIndexed(geometry) {
  const posAttr = geometry.attributes.position;
  const nrmAttr = geometry.attributes.normal;

  const positions = [];
  const normals   = [];
  const indices   = [];
  const vertMap   = new Map();

  const n = posAttr.count;
  for (let i = 0; i < n; i++) {
    const px = posAttr.getX(i);
    const py = posAttr.getY(i);
    const pz = posAttr.getZ(i);
    const nx_ = nrmAttr ? nrmAttr.getX(i) : 0;
    const ny_ = nrmAttr ? nrmAttr.getY(i) : 0;
    const nz_ = nrmAttr ? nrmAttr.getZ(i) : 1;

    const key = `${Math.round(px * QUANTISE)}_${Math.round(py * QUANTISE)}_${Math.round(pz * QUANTISE)}`;
    let idx = vertMap.get(key);
    if (idx === undefined) {
      idx = positions.length / 3;
      positions.push(px, py, pz);
      normals.push(nx_, ny_, nz_);
      vertMap.set(key, idx);
    }
    indices.push(idx);
  }

  return { positions, normals, indices };
}

// ── Indexed → non-indexed ────────────────────────────────────────────────────

function toNonIndexed(positions, normals, indices) {
  const triCount  = indices.length / 3;
  const posArray  = new Float32Array(triCount * 9);
  const nrmArray  = new Float32Array(triCount * 9);

  for (let t = 0; t < triCount; t++) {
    for (let v = 0; v < 3; v++) {
      const vidx = indices[t * 3 + v];
      posArray[t * 9 + v * 3]     = positions[vidx * 3];
      posArray[t * 9 + v * 3 + 1] = positions[vidx * 3 + 1];
      posArray[t * 9 + v * 3 + 2] = positions[vidx * 3 + 2];

      nrmArray[t * 9 + v * 3]     = normals[vidx * 3];
      nrmArray[t * 9 + v * 3 + 1] = normals[vidx * 3 + 1];
      nrmArray[t * 9 + v * 3 + 2] = normals[vidx * 3 + 2];
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(posArray, 3));
  geo.setAttribute('normal',   new THREE.BufferAttribute(nrmArray, 3));
  return geo;
}
