/**
 * QEM (Quadric Error Metric) mesh decimation.
 *
 * Algorithm: Garland & Heckbert 1997, with the three safety guards from
 * PrusaSlicer's QuadricEdgeCollapse.cpp that eliminate holes, spikes and
 * non-manifold edges:
 *
 *   Guard 1 – Boundary edge protection
 *     Never collapse an edge shared by < 2 active faces.
 *     The primary cause of holes in open STL meshes.
 *
 *   Guard 2 – Link-condition (non-manifold / pinch prevention)
 *     Common neighbours of v1/v2 must equal exactly the apex vertices of
 *     their shared triangles.  Extra common neighbours mean collapsing would
 *     fuse disconnected surface regions → non-manifold edge.
 *
 *   Guard 3 – Normal-flip rejection
 *     Recompute every affected face normal after the hypothetical collapse.
 *     dot(original, new) < 0.2 (~78°) → reject.  Eliminates spikes / pits.
 *
 * @param {THREE.BufferGeometry} geometry        non-indexed input
 * @param {number}               targetTriangles desired output face count
 * @param {function}             [onProgress]    callback(0–1)
 * @returns {THREE.BufferGeometry}
 */

import * as THREE from 'three';

const QUANT    = 1e4;
const FLIP_DOT = 0.2; // cos ~78° — reject collapse if new normal deviates more

// ── Public API ───────────────────────────────────────────────────────────────

export function decimate(geometry, targetTriangles, onProgress) {
  const { positions, faces, vertCount, faceCount } = buildIndexed(geometry);

  if (faceCount <= targetTriangles) return buildOutput(positions, faces, faceCount);

  // Per-vertex error quadrics (10 doubles = upper triangle of symmetric 4×4)
  const quadrics = new Float64Array(vertCount * 10);
  initQuadrics(quadrics, positions, faces, faceCount);

  // Vertex → set of incident face indices
  const vertFaces  = buildAdjacency(faces, faceCount, vertCount);
  const active     = new Uint8Array(vertCount).fill(1);
  let   activeFaces = faceCount;

  // Seed min-heap with one entry per unique edge
  const heap     = new MinHeap();
  const seedSeen = new Set();
  for (let f = 0; f < faceCount; f++) {
    if (faces[f * 3] < 0) continue;
    for (let e = 0; e < 3; e++) {
      const v1 = faces[f * 3 + e];
      const v2 = faces[f * 3 + ((e + 1) % 3)];
      const ek = v1 < v2 ? `${v1}:${v2}` : `${v2}:${v1}`;
      if (!seedSeen.has(ek)) { seedSeen.add(ek); pushEdge(heap, quadrics, positions, v1, v2); }
    }
  }
  seedSeen.clear();

  const initFaces = activeFaces;
  let   lastProg  = 0;

  while (activeFaces > targetTriangles && heap.size() > 0) {
    const { v1, v2, px, py, pz } = heap.pop();

    // Stale-entry checks (lazy deletion)
    if (!active[v1] || !active[v2]) continue;
    if (!shareActiveFace(faces, vertFaces, v1, v2)) continue;

    // ── Three safety guards ───────────────────────────────────────────────────
    if (isBoundaryEdge(faces, vertFaces, v1, v2))   continue;  // Guard 1
    if (hasLinkViolation(faces, vertFaces, v1, v2)) continue;  // Guard 2
    const np = [px, py, pz];
    if (checkFlipped(positions, vertFaces, faces, v1, v2, np)) continue; // Guard 3 v1-side
    if (checkFlipped(positions, vertFaces, faces, v2, v1, np)) continue; // Guard 3 v2-side

    // ── Collapse: keep v1 at new position, remove v2 ─────────────────────────
    positions[v1 * 3]     = px;
    positions[v1 * 3 + 1] = py;
    positions[v1 * 3 + 2] = pz;
    mergeQuadric(quadrics, v1, v2);

    for (const f of vertFaces[v2]) {
      if (faces[f * 3] < 0) continue;
      for (let k = 0; k < 3; k++) {
        if (faces[f * 3 + k] === v2) faces[f * 3 + k] = v1;
      }
      const fa = faces[f * 3], fb = faces[f * 3 + 1], fc = faces[f * 3 + 2];
      if (fa === fb || fb === fc || fa === fc) {
        vertFaces[fa]?.delete(f);
        vertFaces[fb]?.delete(f);
        vertFaces[fc]?.delete(f);
        faces[f * 3] = faces[f * 3 + 1] = faces[f * 3 + 2] = -1;
        activeFaces--;
      } else {
        vertFaces[v1].add(f);
      }
    }
    vertFaces[v2].clear();
    active[v2] = 0;

    // Re-push edges for v1's updated neighbourhood
    const neighbors = new Set();
    for (const f of vertFaces[v1]) {
      if (faces[f * 3] < 0) continue;
      for (let k = 0; k < 3; k++) {
        const nb = faces[f * 3 + k];
        if (nb !== v1) neighbors.add(nb);
      }
    }
    for (const nb of neighbors) {
      if (active[nb]) pushEdge(heap, quadrics, positions, v1, nb);
    }

    if (onProgress) {
      const p = Math.min(1, (initFaces - activeFaces) / (initFaces - targetTriangles));
      if (p - lastProg > 0.02) { onProgress(p); lastProg = p; }
    }
  }

  if (onProgress) onProgress(1);
  return buildOutput(positions, faces, faceCount);
}

// ── Guard 1: Boundary edge protection ───────────────────────────────────────
// An edge is a boundary if fewer than 2 active faces share it.
// Collapsing boundary edges is the primary cause of holes in open meshes.

function isBoundaryEdge(faces, vertFaces, v1, v2) {
  let shared = 0;
  for (const f of vertFaces[v1]) {
    if (faces[f * 3] < 0) continue;
    const fa = faces[f * 3], fb = faces[f * 3 + 1], fc = faces[f * 3 + 2];
    if (fa === v2 || fb === v2 || fc === v2) { shared++; if (shared >= 2) return false; }
  }
  return shared < 2;
}

// ── Guard 2: Link condition (non-manifold / pinch prevention) ────────────────
// The set of common neighbours of v1 and v2 must equal exactly the apex
// vertices of their shared faces.  Extra common neighbours mean collapsing
// would fuse disconnected regions → non-manifold edge.

function hasLinkViolation(faces, vertFaces, v1, v2) {
  // Collect apex vertices of the shared faces
  const apices = new Set();
  for (const f of vertFaces[v1]) {
    if (faces[f * 3] < 0) continue;
    const fa = faces[f * 3], fb = faces[f * 3 + 1], fc = faces[f * 3 + 2];
    if (fa === v2 || fb === v2 || fc === v2) {
      if (fa !== v1 && fa !== v2) apices.add(fa);
      if (fb !== v1 && fb !== v2) apices.add(fb);
      if (fc !== v1 && fc !== v2) apices.add(fc);
    }
  }

  // Build neighbour sets for v1 and v2 from active faces
  const nb1 = new Set(), nb2 = new Set();
  for (const f of vertFaces[v1]) {
    if (faces[f * 3] < 0) continue;
    for (let k = 0; k < 3; k++) { const nb = faces[f * 3 + k]; if (nb !== v1) nb1.add(nb); }
  }
  for (const f of vertFaces[v2]) {
    if (faces[f * 3] < 0) continue;
    for (let k = 0; k < 3; k++) { const nb = faces[f * 3 + k]; if (nb !== v2) nb2.add(nb); }
  }

  // Check common neighbours match apices exactly
  for (const nb of nb1) {
    if (nb !== v2 && nb2.has(nb) && !apices.has(nb)) return true;
  }
  return false;
}

// ── Guard 3: Normal-flip rejection ──────────────────────────────────────────
// After hypothetical collapse of v_collapse → newPos, recompute normals of
// all affected faces.  If any flip by more than ~78° (dot < FLIP_DOT) reject.

function checkFlipped(positions, vertFaces, faces, v_collapse, v_other, newPos) {
  for (const f of vertFaces[v_collapse]) {
    if (faces[f * 3] < 0) continue;
    const fa = faces[f * 3], fb = faces[f * 3 + 1], fc = faces[f * 3 + 2];
    // Skip faces shared with v_other; they will be deleted on collapse
    if (fa === v_other || fb === v_other || fc === v_other) continue;

    // Original normal
    const [onx, ony, onz] = faceNormal(
      positions[fa*3], positions[fa*3+1], positions[fa*3+2],
      positions[fb*3], positions[fb*3+1], positions[fb*3+2],
      positions[fc*3], positions[fc*3+1], positions[fc*3+2]
    );

    // New normal with v_collapse replaced by newPos
    const ax = fa === v_collapse ? newPos[0] : positions[fa*3];
    const ay = fa === v_collapse ? newPos[1] : positions[fa*3+1];
    const az = fa === v_collapse ? newPos[2] : positions[fa*3+2];
    const bx = fb === v_collapse ? newPos[0] : positions[fb*3];
    const by = fb === v_collapse ? newPos[1] : positions[fb*3+1];
    const bz = fb === v_collapse ? newPos[2] : positions[fb*3+2];
    const cx = fc === v_collapse ? newPos[0] : positions[fc*3];
    const cy = fc === v_collapse ? newPos[1] : positions[fc*3+1];
    const cz = fc === v_collapse ? newPos[2] : positions[fc*3+2];
    const [nnx, nny, nnz] = faceNormal(ax, ay, az, bx, by, bz, cx, cy, cz);

    const dot = onx * nnx + ony * nny + onz * nnz;
    if (dot < FLIP_DOT) return true;
  }
  return false;
}

function faceNormal(ax, ay, az, bx, by, bz, cx, cy, cz) {
  const ux = bx - ax, uy = by - ay, uz = bz - az;
  const vx = cx - ax, vy = cy - ay, vz = cz - az;
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
  return [nx / len, ny / len, nz / len];
}

// ── Quadric helpers ──────────────────────────────────────────────────────────
// Symmetric 4×4 quadric stored as 10 upper-triangle values per vertex.

function initQuadrics(quadrics, positions, faces, faceCount) {
  for (let f = 0; f < faceCount; f++) {
    if (faces[f * 3] < 0) continue;
    const fa = faces[f * 3], fb = faces[f * 3 + 1], fc = faces[f * 3 + 2];
    const [nx, ny, nz] = faceNormal(
      positions[fa*3], positions[fa*3+1], positions[fa*3+2],
      positions[fb*3], positions[fb*3+1], positions[fb*3+2],
      positions[fc*3], positions[fc*3+1], positions[fc*3+2]
    );
    const d = -(nx * positions[fa*3] + ny * positions[fa*3+1] + nz * positions[fa*3+2]);
    addPlaneQ(quadrics, fa, nx, ny, nz, d);
    addPlaneQ(quadrics, fb, nx, ny, nz, d);
    addPlaneQ(quadrics, fc, nx, ny, nz, d);
  }
}

function addPlaneQ(q, v, a, b, c, d) {
  const o = v * 10;
  q[o]   += a*a; q[o+1] += a*b; q[o+2] += a*c; q[o+3] += a*d;
                 q[o+4] += b*b; q[o+5] += b*c; q[o+6] += b*d;
                                q[o+7] += c*c; q[o+8] += c*d;
                                               q[o+9] += d*d;
}

function mergeQuadric(q, v1, v2) {
  const o1 = v1 * 10, o2 = v2 * 10;
  for (let i = 0; i < 10; i++) q[o1 + i] += q[o2 + i];
}

function evalQ(q, v, x, y, z) {
  const o = v * 10;
  return q[o]   * x*x + 2*q[o+1]*x*y + 2*q[o+2]*x*z + 2*q[o+3]*x
       + q[o+4] * y*y + 2*q[o+5]*y*z + 2*q[o+6]*y
       + q[o+7] * z*z + 2*q[o+8]*z
       + q[o+9];
}

function evalQSum(q, v1, v2, x, y, z) {
  return evalQ(q, v1, x, y, z) + evalQ(q, v2, x, y, z);
}

const _s = new Float64Array(3);

function solveQ(q, v1, v2) {
  const o1 = v1 * 10, o2 = v2 * 10;
  const a00 = q[o1]   + q[o2];
  const a01 = q[o1+1] + q[o2+1];
  const a02 = q[o1+2] + q[o2+2];
  const a11 = q[o1+4] + q[o2+4];
  const a12 = q[o1+5] + q[o2+5];
  const a22 = q[o1+7] + q[o2+7];
  const b0  = -(q[o1+3] + q[o2+3]);
  const b1  = -(q[o1+6] + q[o2+6]);
  const b2  = -(q[o1+8] + q[o2+8]);

  const det = a00*(a11*a22 - a12*a12) - a01*(a01*a22 - a12*a02) + a02*(a01*a12 - a11*a02);
  if (Math.abs(det) < 1e-10) return false;

  const inv = 1 / det;
  _s[0] = inv * (b0*(a11*a22 - a12*a12) - a01*(b1*a22 - a12*b2) + a02*(b1*a12 - a11*b2));
  _s[1] = inv * (a00*(b1*a22 - a12*b2) - b0*(a01*a22 - a12*a02) + a02*(a01*b2 - b1*a02));
  _s[2] = inv * (a00*(a11*b2 - b1*a12) - a01*(a01*b2 - b1*a02) + b0*(a01*a12 - a11*a02));
  return true;
}

function pushEdge(heap, quadrics, positions, v1, v2) {
  let px, py, pz;

  if (solveQ(quadrics, v1, v2)) {
    px = _s[0]; py = _s[1]; pz = _s[2];
  } else {
    const mx = (positions[v1*3]   + positions[v2*3])   / 2;
    const my = (positions[v1*3+1] + positions[v2*3+1]) / 2;
    const mz = (positions[v1*3+2] + positions[v2*3+2]) / 2;
    const e1 = evalQSum(quadrics, v1, v2, positions[v1*3],   positions[v1*3+1], positions[v1*3+2]);
    const e2 = evalQSum(quadrics, v1, v2, positions[v2*3],   positions[v2*3+1], positions[v2*3+2]);
    const em = evalQSum(quadrics, v1, v2, mx, my, mz);
    if      (e1 <= e2 && e1 <= em) { px = positions[v1*3]; py = positions[v1*3+1]; pz = positions[v1*3+2]; }
    else if (e2 <= em)             { px = positions[v2*3]; py = positions[v2*3+1]; pz = positions[v2*3+2]; }
    else                           { px = mx; py = my; pz = mz; }
  }

  const cost = evalQSum(quadrics, v1, v2, px, py, pz);
  heap.push({ cost, v1, v2, px, py, pz });
}

// ── Indexed <-> Non-indexed conversion ──────────────────────────────────────

function buildIndexed(geometry) {
  const posAttr = geometry.attributes.position;
  const n = posAttr.count;

  const positions  = [];
  const vertMap    = new Map();
  const indexRemap = new Int32Array(n);

  for (let i = 0; i < n; i++) {
    const x = posAttr.getX(i), y = posAttr.getY(i), z = posAttr.getZ(i);
    const key = `${Math.round(x * QUANT)}_${Math.round(y * QUANT)}_${Math.round(z * QUANT)}`;
    let idx = vertMap.get(key);
    if (idx === undefined) {
      idx = positions.length / 3;
      positions.push(x, y, z);
      vertMap.set(key, idx);
    }
    indexRemap[i] = idx;
  }

  const faceCount = n / 3;
  const faces = new Int32Array(faceCount * 3);
  for (let f = 0; f < faceCount; f++) {
    faces[f * 3]     = indexRemap[f * 3];
    faces[f * 3 + 1] = indexRemap[f * 3 + 1];
    faces[f * 3 + 2] = indexRemap[f * 3 + 2];
  }

  return { positions: new Float64Array(positions), faces, vertCount: positions.length / 3, faceCount };
}

// ── Adjacency helpers ────────────────────────────────────────────────────────

function buildAdjacency(faces, faceCount, vertCount) {
  const adj = new Array(vertCount);
  for (let v = 0; v < vertCount; v++) adj[v] = new Set();
  for (let f = 0; f < faceCount; f++) {
    if (faces[f * 3] < 0) continue;
    adj[faces[f * 3]].add(f);
    adj[faces[f * 3 + 1]].add(f);
    adj[faces[f * 3 + 2]].add(f);
  }
  return adj;
}

function shareActiveFace(faces, vertFaces, v1, v2) {
  for (const f of vertFaces[v1]) {
    if (faces[f * 3] < 0) continue;
    const fa = faces[f * 3], fb = faces[f * 3 + 1], fc = faces[f * 3 + 2];
    if (fa === v2 || fb === v2 || fc === v2) return true;
  }
  return false;
}

function buildOutput(positions, faces, faceCount) {
  let activeFaces = 0;
  for (let f = 0; f < faceCount; f++) {
    if (faces[f * 3] >= 0) activeFaces++;
  }

  const posArray = new Float32Array(activeFaces * 9);
  let out = 0;
  for (let f = 0; f < faceCount; f++) {
    if (faces[f * 3] < 0) continue;
    for (let v = 0; v < 3; v++) {
      const vi = faces[f * 3 + v];
      posArray[out++] = positions[vi * 3];
      posArray[out++] = positions[vi * 3 + 1];
      posArray[out++] = positions[vi * 3 + 2];
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(posArray, 3));
  geo.computeVertexNormals();
  return geo;
}

// ── Binary Min-Heap ──────────────────────────────────────────────────────────

class MinHeap {
  constructor() { this._data = []; }

  size() { return this._data.length; }

  push(item) {
    this._data.push(item);
    this._bubbleUp(this._data.length - 1);
  }

  pop() {
    const top = this._data[0];
    const last = this._data.pop();
    if (this._data.length > 0) { this._data[0] = last; this._sinkDown(0); }
    return top;
  }

  _bubbleUp(i) {
    const d = this._data;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (d[p].cost <= d[i].cost) break;
      [d[p], d[i]] = [d[i], d[p]];
      i = p;
    }
  }

  _sinkDown(i) {
    const d = this._data;
    const n = d.length;
    for (;;) {
      let s = i;
      const l = 2 * i + 1, r = 2 * i + 2;
      if (l < n && d[l].cost < d[s].cost) s = l;
      if (r < n && d[r].cost < d[s].cost) s = r;
      if (s === i) break;
      [d[s], d[i]] = [d[i], d[s]];
      i = s;
    }
  }
}
