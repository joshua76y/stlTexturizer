/*
 * Copyright (c) 2026 CNCKitchen (Stefan Hermann) and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * threeCompat.js — single resolution point for the three.js dependency of the
 * mesh-processing pipeline modules (subdivision, regularize, displacement,
 * decimation, meshRepair, exportPipeline).
 *
 * Why this exists: those modules must run in THREE contexts —
 *   1. the page (resolves bare 'three' via the import map in index.html),
 *   2. Node test/bench scripts (resolves 'three' from node_modules),
 *   3. the export Web Worker (workers IGNORE the page's import map per the
 *      HTML spec, so a bare 'three' import throws there).
 * The try/catch below uses the bare specifier wherever it resolves (page,
 * Node — same module instance as the rest of the app, so instanceof checks
 * hold) and falls back to an absolute URL only inside workers.
 *
 * LOCAL-FIRST FORK: dependencies are vendored under vendor/ instead of a CDN,
 * so the fallback resolves against this module's own URL. KEEP THE PATH IN
 * SYNC with the "three" entry of the import map in index.html — both must
 * point at the same file, and no network access is required.
 */
const LOCAL_THREE = new URL('../vendor/three/three.module.js', import.meta.url).href;

let THREE;
try {
  THREE = await import('three');
} catch {
  THREE = await import(LOCAL_THREE);
}

export { THREE };
