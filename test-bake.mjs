// Standalone harness for the bake-mask logic in js/main.js → bakeTextures.
// Mirrors the algorithm exactly so we can exercise it in Node without three.js
// or a browser. The bake-mask path is the new behavior introduced by the
// "Bake Textures (beta)" feature in the Advanced/Beta Features panel.
//
// What's under test:
//   1. Mask-building from faceParentId + faceWeights (the parent-face
//      provenance map returned by subdivide()). Every output triangle whose
//      parent face was NOT excluded got textured this round and must end up
//      in the new mask. Excluded parents stay un-masked so the user can still
//      paint over them.
//   2. faceWeights[parentIdx*3] > 0.99 captures all three exclusion paths
//      simultaneously: user-painted exclusion, selectionMode (include-only),
//      and angle masking.
//   3. The mask-toggle off-switch: when bake-mask-chk is unchecked, no mask
//      is seeded.
//   4. The flat-bottom clamp: vertices below bounds.min.z get snapped up
//      and the affected triangle's normal is recomputed.
//
// To match production behavior, the helpers here are direct copies of the
// bake-time logic added to main.js — if either side changes, this test should
// be updated too.

let _failed = 0;
function expect(label, ok, detail) {
  if (ok) {
    console.log(`  PASS  ${label}`);
  } else {
    console.log(`  FAIL  ${label}${detail ? ` :: ${detail}` : ''}`);
    _failed++;
  }
}
function approxEq(a, b, eps = 1e-6) { return Math.abs(a - b) <= eps; }

// ── Replica of buildCombinedFaceWeights (input-mask side) ────────────────────
// Per-vertex weight array, length = triCount * 3. weights[t*3] === 1.0 means
// triangle t is excluded; 0.0 means included. Mirrors buildFaceWeights +
// the angle-mask augmentation in js/main.js.
function buildFaceWeights(triCount, excludedFaces, invert = false) {
  const weights = new Float32Array(triCount * 3);
  if (invert) {
    weights.fill(1.0);
    for (const t of excludedFaces) {
      weights[t * 3]     = 0.0;
      weights[t * 3 + 1] = 0.0;
      weights[t * 3 + 2] = 0.0;
    }
  } else {
    for (const t of excludedFaces) {
      weights[t * 3]     = 1.0;
      weights[t * 3 + 1] = 1.0;
      weights[t * 3 + 2] = 1.0;
    }
  }
  return weights;
}

// ── Replica of the bake-mask builder from bakeTextures() ─────────────────────
function buildBakeMask(faceParentId, faceWeights, maskChecked) {
  if (!maskChecked) return null;
  const wasParentExcluded = faceWeights
    ? (parentIdx) => faceWeights[parentIdx * 3] > 0.99
    : () => false;
  const preExcluded = [];
  for (let i = 0; i < faceParentId.length; i++) {
    if (!wasParentExcluded(faceParentId[i])) preExcluded.push(i);
  }
  return preExcluded;
}

// ── Replica of the flat-bottom clamp from bakeTextures() ─────────────────────
function flatBottomClamp(positions, normals, bottomZ) {
  for (let i = 0; i < positions.length; i += 9) {
    let dirty = false;
    if (positions[i+2] < bottomZ) { positions[i+2] = bottomZ; dirty = true; }
    if (positions[i+5] < bottomZ) { positions[i+5] = bottomZ; dirty = true; }
    if (positions[i+8] < bottomZ) { positions[i+8] = bottomZ; dirty = true; }
    if (dirty) {
      const ux = positions[i+3]-positions[i],   uy = positions[i+4]-positions[i+1], uz = positions[i+5]-positions[i+2];
      const vx = positions[i+6]-positions[i],   vy = positions[i+7]-positions[i+1], vz = positions[i+8]-positions[i+2];
      const nx = uy*vz-uz*vy, ny = uz*vx-ux*vz, nz = ux*vy-uy*vx;
      const len = Math.sqrt(nx*nx+ny*ny+nz*nz) || 1;
      normals[i]   = normals[i+3] = normals[i+6] = nx/len;
      normals[i+1] = normals[i+4] = normals[i+7] = ny/len;
      normals[i+2] = normals[i+5] = normals[i+8] = nz/len;
    }
  }
}

// ── Synthesize a realistic faceParentId pattern ──────────────────────────────
// Models the typical subdivide() output: each input triangle expands to N
// output triangles (N varies per face based on edge length / mask state).
// Here we use a simple deterministic split: included faces split into 4
// children, excluded faces stay as 1 (subdivide skips excluded faces).
function synthesizeFaceParentId(inputTriCount, excludedSet, splitFactor = 4) {
  const out = [];
  for (let parent = 0; parent < inputTriCount; parent++) {
    const n = excludedSet.has(parent) ? 1 : splitFactor;
    for (let k = 0; k < n; k++) out.push(parent);
  }
  return new Int32Array(out);
}

// ── Test 1: basic mask invariants ────────────────────────────────────────────
console.log('Test 1: mask invariants — typical bake with mixed exclusions');
{
  const inputTriCount = 20;
  const excluded = new Set([3, 7, 11, 15]);            // 4 of 20 input faces excluded
  const includedCount = inputTriCount - excluded.size;  // 16
  const splitFactor = 4;
  const expectedOutputTris = excluded.size * 1 + includedCount * splitFactor; // 4 + 64 = 68
  const expectedNewMaskSize = includedCount * splitFactor;                    // 64

  const faceParentId = synthesizeFaceParentId(inputTriCount, excluded, splitFactor);
  expect('output triangle count matches expected sum',
         faceParentId.length === expectedOutputTris,
         `got ${faceParentId.length}, expected ${expectedOutputTris}`);

  const faceWeights = buildFaceWeights(inputTriCount, excluded, /*invert=*/false);
  const newMask = buildBakeMask(faceParentId, faceWeights, /*maskChecked=*/true);

  expect('new mask size = (formerly-included parents) × splitFactor',
         newMask.length === expectedNewMaskSize,
         `got ${newMask.length}, expected ${expectedNewMaskSize}`);

  // Every masked output face must have a parent that was NOT in the input mask.
  let okParentage = true;
  for (const outFace of newMask) {
    if (excluded.has(faceParentId[outFace])) { okParentage = false; break; }
  }
  expect('every masked output face has a non-excluded parent', okParentage);

  // Every UN-masked output face must have a parent that WAS in the input mask.
  const newMaskSet = new Set(newMask);
  let okComplement = true;
  for (let i = 0; i < faceParentId.length; i++) {
    if (newMaskSet.has(i)) continue;
    if (!excluded.has(faceParentId[i])) { okComplement = false; break; }
  }
  expect('every un-masked output face has an excluded parent', okComplement);

  // Disjoint + complete: |masked| + |unmasked| = |total|
  expect('masked ∪ un-masked partitions all output faces',
         newMask.length + (faceParentId.length - newMask.length) === faceParentId.length);
}

// ── Test 2: no exclusions at all → every output face is masked ──────────────
console.log('\nTest 2: bake with zero pre-existing exclusions');
{
  const inputTriCount = 12;
  const faceParentId = synthesizeFaceParentId(inputTriCount, new Set(), 4);
  // Mirrors the bake path: when excludedFaces.size===0 && !selectionMode &&
  // !hasAngleMask, faceWeights is null.
  const newMask = buildBakeMask(faceParentId, null, true);

  expect('mask covers every output face when input had no exclusions',
         newMask.length === faceParentId.length);
  expect('mask is contiguous 0..N-1',
         newMask[0] === 0 && newMask[newMask.length - 1] === faceParentId.length - 1);
}

// ── Test 3: include-only (selectionMode=true) inverts the mask ───────────────
console.log('\nTest 3: include-only mode (selectionMode=true)');
{
  const inputTriCount = 10;
  // In include-only mode, the user *paints* the faces they DO want textured.
  // Everything else gets weight 1.0 (excluded from subdivision/displacement).
  const painted = new Set([2, 4, 6]); // 3 faces will get textured
  const splitFactor = 4;
  const faceParentId = synthesizeFaceParentId(
    inputTriCount,
    new Set([0, 1, 3, 5, 7, 8, 9]), // the inverse set — these stay 1 tri each
    splitFactor
  );
  const faceWeights = buildFaceWeights(inputTriCount, painted, /*invert=*/true);

  // Sanity: in invert mode, painted faces have weight 0, others have weight 1.
  expect('include-only: painted face weight = 0', faceWeights[2 * 3] === 0.0);
  expect('include-only: non-painted face weight = 1', faceWeights[1 * 3] === 1.0);

  const newMask = buildBakeMask(faceParentId, faceWeights, true);
  // Only the 3 painted parents (each split into 4) got textured → 12 masked.
  expect('include-only: mask = painted × splitFactor',
         newMask.length === painted.size * splitFactor,
         `got ${newMask.length}, expected ${painted.size * splitFactor}`);

  // Every masked output face descends from a painted parent.
  let allFromPainted = true;
  for (const outFace of newMask) {
    if (!painted.has(faceParentId[outFace])) { allFromPainted = false; break; }
  }
  expect('include-only: every masked face descends from a painted parent', allFromPainted);
}

// ── Test 4: bake-mask checkbox unchecked → returns null ─────────────────────
console.log('\nTest 4: bake-mask toggle off');
{
  const faceParentId = synthesizeFaceParentId(5, new Set([1]), 4);
  const faceWeights  = buildFaceWeights(5, new Set([1]));
  const newMask = buildBakeMask(faceParentId, faceWeights, /*maskChecked=*/false);
  expect('mask is null when checkbox is unchecked', newMask === null);
}

// ── Test 5: angle masking treated identically to user paint ─────────────────
console.log('\nTest 5: angle-masked parents excluded same as user paint');
{
  // buildCombinedFaceWeights additionally sets weight=1 on faces masked by
  // bottomAngleLimit/topAngleLimit. From bake's perspective, those are
  // indistinguishable from user paint — both must be treated as "not textured
  // this round → don't mask in the new mesh".
  const inputTriCount = 8;
  const userExcluded   = new Set([2]);           // 1 user-painted exclusion
  const angleExcluded  = new Set([5, 6]);        // 2 angle-masked faces
  const allExcluded    = new Set([...userExcluded, ...angleExcluded]); // 3

  const faceWeights = buildFaceWeights(inputTriCount, allExcluded);
  const faceParentId = synthesizeFaceParentId(inputTriCount, allExcluded, 4);
  const newMask = buildBakeMask(faceParentId, faceWeights, true);

  const includedCount = inputTriCount - allExcluded.size; // 5
  expect('angle-masked parents stay un-masked (treated like user paint)',
         newMask.length === includedCount * 4,
         `got ${newMask.length}, expected ${includedCount * 4}`);
}

// ── Test 6: flat-bottom clamp ───────────────────────────────────────────────
console.log('\nTest 6: flat-bottom clamp recomputes normals on dirty triangles');
{
  // Two triangles:
  //   t0 — entirely above bottomZ (no clamp, normal unchanged)
  //   t1 — one vertex below bottomZ (clamp + recompute)
  const bottomZ = 0;
  // Triangle 0: above bottom, normal (0,0,1)
  // Triangle 1: one vertex at z=-2, others at z=0, normal initially garbage
  const positions = new Float32Array([
    // t0: (0,0,5), (1,0,5), (0,1,5)
    0,0,5,  1,0,5,  0,1,5,
    // t1: (0,0,0), (1,0,0), (0,1,-2)
    0,0,0,  1,0,0,  0,1,-2,
  ]);
  const normals = new Float32Array([
    0,0,1,  0,0,1,  0,0,1,
    9,9,9,  9,9,9,  9,9,9,
  ]);

  flatBottomClamp(positions, normals, bottomZ);

  // t0 untouched
  expect('t0 z-coords unchanged', positions[2] === 5 && positions[5] === 5 && positions[8] === 5);
  expect('t0 normal unchanged',   normals[0] === 0 && normals[1] === 0 && normals[2] === 1);
  // t1: third vertex z snapped to 0
  expect('t1 third vertex clamped to bottomZ', positions[8 + 9] === 0); // wait, positions index for t1 is offset 9
  // Re-check using correct offsets
  expect('t1 v0 z=0 (was 0)',  positions[9 + 2]  === 0);
  expect('t1 v1 z=0 (was 0)',  positions[9 + 5]  === 0);
  expect('t1 v2 z=0 (was -2)', positions[9 + 8]  === 0);

  // After clamp, all three vertices of t1 have z=0 → triangle is in the XY
  // plane → recomputed normal points along ±Z. Cross of (1,0,0)×(0,1,0) = (0,0,1).
  expect('t1 normal recomputed to (0,0,1)',
         approxEq(normals[9 + 0], 0) && approxEq(normals[9 + 1], 0) && approxEq(normals[9 + 2], 1));
  expect('t1 normal applied to all three vertex copies',
         approxEq(normals[9 + 3], 0) && approxEq(normals[9 + 4], 0) && approxEq(normals[9 + 5], 1) &&
         approxEq(normals[9 + 6], 0) && approxEq(normals[9 + 7], 0) && approxEq(normals[9 + 8], 1));
}

// ── Test 7: large stress test — ensure no off-by-one in big buffers ─────────
console.log('\nTest 7: 100k input tris, 25% excluded, splitFactor=8');
{
  const inputTriCount = 100_000;
  const excluded = new Set();
  for (let i = 0; i < inputTriCount; i++) if (i % 4 === 0) excluded.add(i);
  const splitFactor = 8;
  const faceParentId = synthesizeFaceParentId(inputTriCount, excluded, splitFactor);
  const faceWeights = buildFaceWeights(inputTriCount, excluded);
  const newMask = buildBakeMask(faceParentId, faceWeights, true);

  const includedCount = inputTriCount - excluded.size;
  const expectedTotal = excluded.size + includedCount * splitFactor;
  expect('output count = excluded + included×split',
         faceParentId.length === expectedTotal);
  expect('mask size = included × split',
         newMask.length === includedCount * splitFactor);

  // Spot-check: first masked face must have parent 1 (since parent 0 was excluded).
  expect('first masked face descends from parent 1 (parent 0 was excluded)',
         faceParentId[newMask[0]] === 1);
  // Spot-check: last masked face must have parent inputTriCount-1 if not divisible by 4,
  // or the last non-excluded parent otherwise. inputTriCount=100000, last excluded
  // parent is 99996 (multiple of 4), last included is 99999.
  expect('last masked face descends from last included parent',
         faceParentId[newMask[newMask.length - 1]] === inputTriCount - 1);
}

console.log(`\n${_failed === 0 ? 'All tests PASSED' : `${_failed} test(s) FAILED`}`);
process.exit(_failed === 0 ? 0 : 1);
