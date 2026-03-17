import * as THREE from 'three';
import { initViewer, loadGeometry, setMeshMaterial, setWireframe,
         getControls, getCamera, getCurrentMesh,
         setExclusionOverlay, setHoverPreview } from './viewer.js';
import { loadSTLFile, computeBounds, getTriangleCount }  from './stlLoader.js';
import { PRESETS, loadCustomTexture }  from './presetTextures.js';
import { createPreviewMaterial, updateMaterial } from './previewMaterial.js';
import { subdivide }          from './subdivision.js';
import { applyDisplacement }  from './displacement.js';
import { decimate }           from './decimation.js';
import { exportSTL }          from './exporter.js';
import { buildAdjacency, bucketFill,
         buildExclusionOverlayGeo, buildFaceWeights } from './exclusion.js';

// ── State ─────────────────────────────────────────────────────────────────────

let currentGeometry   = null;   // original loaded geometry
let currentBounds     = null;   // bounds of the original geometry
let activeMapEntry    = null;   // { name, texture, imageData, width, height }
let previewMaterial   = null;
let isExporting       = false;
let previewDebounce   = null;

// ── Exclusion state ───────────────────────────────────────────────────────────
let excludedFaces      = new Set();   // triangle indices in currentGeometry
let triangleAdjacency  = null;        // Map from buildAdjacency
let triangleCentroids  = null;        // Float32Array from buildAdjacency
let exclusionTool      = null;        // 'brush' | 'bucket' | null
let eraseMode          = false;
let brushIsRadius      = false;
let brushRadius        = 5.0;
let bucketThreshold    = 30;
let isPainting         = false;
let _lastHoverTriIdx   = -1;          // last triangle index used for hover preview
const _raycaster       = new THREE.Raycaster();

const settings = {
  mappingMode:   6,     // Cubic default
  scaleU:        1.0,
  scaleV:        1.0,
  amplitude:     0.5,
  offsetU:       0.0,
  offsetV:       0.0,
  refineLength:  1.0,
  maxTriangles:  1_000_000,
  lockScale:     true,
  bottomAngleLimit: 5,
  topAngleLimit:    0,
};

// ── DOM refs ──────────────────────────────────────────────────────────────────

const canvas         = document.getElementById('viewport');
const dropZone       = document.getElementById('drop-zone');
const dropHint       = document.getElementById('drop-hint');
const stlFileInput   = document.getElementById('stl-file-input');
const textureInput   = document.getElementById('texture-file-input');
const presetGrid     = document.getElementById('preset-grid');
const activeMapName  = document.getElementById('active-map-name');
const meshInfo       = document.getElementById('mesh-info');
const exportBtn        = document.getElementById('export-btn');
const exportProgress   = document.getElementById('export-progress');
const exportProgBar    = document.getElementById('export-progress-bar');
const exportProgLbl    = document.getElementById('export-progress-label');
const triLimitWarning  = document.getElementById('tri-limit-warning');
const wireframeToggle  = document.getElementById('wireframe-toggle');

const mappingSelect   = document.getElementById('mapping-mode');
const scaleUSlider    = document.getElementById('scale-u');
const scaleVSlider    = document.getElementById('scale-v');
const lockScaleBtn    = document.getElementById('lock-scale');
const offsetUSlider   = document.getElementById('offset-u');
const offsetVSlider   = document.getElementById('offset-v');
const amplitudeSlider = document.getElementById('amplitude');
const refineLenSlider = document.getElementById('refine-length');
const maxTriSlider    = document.getElementById('max-triangles');

const scaleUVal    = document.getElementById('scale-u-val');
const scaleVVal    = document.getElementById('scale-v-val');
const offsetUVal   = document.getElementById('offset-u-val');
const offsetVVal   = document.getElementById('offset-v-val');
const amplitudeVal = document.getElementById('amplitude-val');
const refineLenVal = document.getElementById('refine-length-val');
const maxTriVal    = document.getElementById('max-triangles-val');

const bottomAngleLimitSlider = document.getElementById('bottom-angle-limit');
const topAngleLimitSlider    = document.getElementById('top-angle-limit');
const bottomAngleLimitVal    = document.getElementById('bottom-angle-limit-val');
const topAngleLimitVal       = document.getElementById('top-angle-limit-val');

// ── Exclusion panel DOM refs ──────────────────────────────────────────────────
const exclBrushBtn        = document.getElementById('excl-brush-btn');
const exclBucketBtn       = document.getElementById('excl-bucket-btn');
const exclEraseToggle     = document.getElementById('excl-erase-toggle');
const exclBrushTypeRow    = document.getElementById('excl-brush-type-row');
const exclBrushSingleBtn  = document.getElementById('excl-brush-single');
const exclBrushRadiusBtn  = document.getElementById('excl-brush-radius-btn');
const exclRadiusRow       = document.getElementById('excl-radius-row');
const exclBrushRadiusSlider = document.getElementById('excl-brush-radius-slider');
const exclBrushRadiusVal    = document.getElementById('excl-brush-radius-val');
const exclThresholdRow    = document.getElementById('excl-threshold-row');
const exclThresholdSlider = document.getElementById('excl-threshold-slider');
const exclThresholdVal    = document.getElementById('excl-threshold-val');
const exclCount           = document.getElementById('excl-count');
const exclClearBtn        = document.getElementById('excl-clear-btn');

// ── Scale slider log helpers ──────────────────────────────────────────────────
// Slider stores 0–1000; actual scale spans 0.1–10 on a log axis.
// Middle position 500 → scale 1.0 (exact midpoint on log scale).
const _LOG_MIN = Math.log(0.1);
const _LOG_MAX = Math.log(10);
const scaleToPos = v => Math.round((Math.log(Math.max(0.1, Math.min(10, v))) - _LOG_MIN) / (_LOG_MAX - _LOG_MIN) * 1000);
const posToScale = p => parseFloat(Math.exp(_LOG_MIN + (p / 1000) * (_LOG_MAX - _LOG_MIN)).toFixed(1));

// ── Init ──────────────────────────────────────────────────────────────────────

initViewer(canvas);
buildPresetGrid();
wireEvents();
// Sync scale number inputs with the slider's initial position
scaleUVal.value = posToScale(parseFloat(scaleUSlider.value));
scaleVVal.value = posToScale(parseFloat(scaleVSlider.value));

// ── Preset grid ───────────────────────────────────────────────────────────────

function buildPresetGrid() {
  PRESETS.forEach((preset, idx) => {
    const swatch = document.createElement('div');
    swatch.className = 'preset-swatch';
    swatch.title = preset.name;

    // Use the small thumbnail canvas
    swatch.appendChild(preset.thumbCanvas);

    const label = document.createElement('span');
    label.className = 'preset-label';
    label.textContent = preset.name;
    swatch.appendChild(label);

    swatch.addEventListener('click', () => selectPreset(idx, swatch));
    presetGrid.appendChild(swatch);
  });
}

function selectPreset(idx, swatchEl) {
  document.querySelectorAll('.preset-swatch').forEach(s => s.classList.remove('active'));
  swatchEl.classList.add('active');
  activeMapEntry = PRESETS[idx];
  activeMapName.textContent = PRESETS[idx].name;
  updatePreview();
}

// ── Event wiring ──────────────────────────────────────────────────────────────

function wireEvents() {
  // ── STL loading ──
  stlFileInput.addEventListener('change', (e) => {
    if (e.target.files[0]) handleSTL(e.target.files[0]);
  });

  // Drag & drop on the viewport section
  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
  });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    const file = [...e.dataTransfer.files].find(f => f.name.toLowerCase().endsWith('.stl'));
    if (file) handleSTL(file);
  });

  // Allow clicking the drop zone to open the file picker (except on canvas)
  dropZone.addEventListener('click', (e) => {
    if (e.target === dropZone) stlFileInput.click();
  });

  // ── Custom texture upload ──
  textureInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      activeMapEntry = await loadCustomTexture(file);
      activeMapName.textContent = file.name;
      document.querySelectorAll('.preset-swatch').forEach(s => s.classList.remove('active'));
      updatePreview();
    } catch (err) {
      console.error('Failed to load texture:', err);
    }
  });

  // ── Settings ──
  mappingSelect.addEventListener('change', () => {
    settings.mappingMode = parseInt(mappingSelect.value, 10);
    updatePreview();
  });

  // Scale U — when lock is on, mirror to V
  const applyScaleU = (v) => {
    v = Math.max(0.1, Math.min(10, v));
    settings.scaleU = v;
    scaleUSlider.value = scaleToPos(v);
    scaleUVal.value = v;
    if (settings.lockScale) { settings.scaleV = v; scaleVSlider.value = scaleToPos(v); scaleVVal.value = v; }
    clearTimeout(previewDebounce); previewDebounce = setTimeout(updatePreview, 80);
  };
  scaleUSlider.addEventListener('input', () => applyScaleU(posToScale(parseFloat(scaleUSlider.value))));
  scaleUVal.addEventListener('change', () => applyScaleU(parseFloat(scaleUVal.value)));

  // Scale V — when lock is on, mirror to U
  const applyScaleV = (v) => {
    v = Math.max(0.1, Math.min(10, v));
    settings.scaleV = v;
    scaleVSlider.value = scaleToPos(v);
    scaleVVal.value = v;
    if (settings.lockScale) { settings.scaleU = v; scaleUSlider.value = scaleToPos(v); scaleUVal.value = v; }
    clearTimeout(previewDebounce); previewDebounce = setTimeout(updatePreview, 80);
  };
  scaleVSlider.addEventListener('input', () => applyScaleV(posToScale(parseFloat(scaleVSlider.value))));
  scaleVVal.addEventListener('change', () => applyScaleV(parseFloat(scaleVVal.value)));

  // Lock toggle
  lockScaleBtn.addEventListener('click', () => {
    settings.lockScale = !settings.lockScale;
    lockScaleBtn.classList.toggle('active', settings.lockScale);
    lockScaleBtn.setAttribute('aria-pressed', String(settings.lockScale));
    if (settings.lockScale) {
      settings.scaleV = settings.scaleU;
      scaleVSlider.value = scaleToPos(settings.scaleU);
      scaleVVal.value = settings.scaleU;
      updatePreview();
    }
  });

  linkSlider(offsetUSlider,   offsetUVal,   v => { settings.offsetU   = v; return v.toFixed(2); });
  linkSlider(offsetVSlider,   offsetVVal,   v => { settings.offsetV   = v; return v.toFixed(2); });
  linkSlider(amplitudeSlider, amplitudeVal, v => { settings.amplitude = v; return v.toFixed(2); });
  linkSlider(refineLenSlider, refineLenVal, v => { settings.refineLength  = v; return v.toFixed(1); }, false);
  linkSlider(maxTriSlider, maxTriVal, v => { settings.maxTriangles = v; return formatM(v); }, false);
  linkSlider(bottomAngleLimitSlider, bottomAngleLimitVal, v => { settings.bottomAngleLimit = v; return v; });
  linkSlider(topAngleLimitSlider,    topAngleLimitVal,    v => { settings.topAngleLimit    = v; return v; });

  // ── Export ──
  exportBtn.addEventListener('click', handleExport);

  // ── Wireframe ──
  wireframeToggle.addEventListener('change', () => setWireframe(wireframeToggle.checked));

  // ── Exclusion tool wiring ─────────────────────────────────────────────────

  exclBrushBtn.addEventListener('click', () => setExclusionTool('brush'));
  exclBucketBtn.addEventListener('click', () => setExclusionTool('bucket'));

  exclEraseToggle.addEventListener('click', () => {
    eraseMode = !eraseMode;
    exclEraseToggle.classList.toggle('active', eraseMode);
    exclEraseToggle.setAttribute('aria-pressed', String(eraseMode));
  });

  exclBrushSingleBtn.addEventListener('click', () => {
    brushIsRadius = false;
    exclBrushSingleBtn.classList.add('active');
    exclBrushRadiusBtn.classList.remove('active');
    exclRadiusRow.classList.add('hidden');
  });

  exclBrushRadiusBtn.addEventListener('click', () => {
    brushIsRadius = true;
    exclBrushRadiusBtn.classList.add('active');
    exclBrushSingleBtn.classList.remove('active');
    if (exclusionTool === 'brush') exclRadiusRow.classList.remove('hidden');
  });

  exclBrushRadiusSlider.addEventListener('input', () => {
    brushRadius = parseFloat(exclBrushRadiusSlider.value);
    exclBrushRadiusVal.value = brushRadius;
  });
  exclBrushRadiusVal.addEventListener('change', () => {
    brushRadius = Math.max(0.1, Math.min(50, parseFloat(exclBrushRadiusVal.value) || 5));
    exclBrushRadiusSlider.value = brushRadius;
    exclBrushRadiusVal.value = brushRadius;
  });

  exclThresholdSlider.addEventListener('input', () => {
    bucketThreshold = parseFloat(exclThresholdSlider.value);
    exclThresholdVal.value = bucketThreshold;
    _lastHoverTriIdx = -1; // invalidate hover so next mousemove re-computes
  });
  exclThresholdVal.addEventListener('change', () => {
    bucketThreshold = Math.max(0, Math.min(180, parseFloat(exclThresholdVal.value) || 30));
    exclThresholdSlider.value = bucketThreshold;
    exclThresholdVal.value = bucketThreshold;
    _lastHoverTriIdx = -1;
  });

  exclClearBtn.addEventListener('click', () => {
    excludedFaces = new Set();
    refreshExclusionOverlay();
  });

  // ── Canvas mouse events for exclusion painting ────────────────────────────
  canvas.addEventListener('mousedown', (e) => {
    if (!currentGeometry || !exclusionTool || e.button !== 0) return;
    e.preventDefault();
    getControls().enabled = false;
    isPainting = true;

    if (exclusionTool === 'bucket') {
      const triIdx = pickTriangle(e);
      if (triIdx >= 0) {
        const filled = bucketFill(triIdx, triangleAdjacency, bucketThreshold);
        for (const t of filled) {
          if (eraseMode) excludedFaces.delete(t); else excludedFaces.add(t);
        }
        refreshExclusionOverlay();
        // Clear hover immediately so the confirmed orange overlay is fully visible
        _lastHoverTriIdx = -1;
        setHoverPreview(null);
      }
      isPainting = false;
      getControls().enabled = true;
    } else {
      paintAt(e);
    }
  });

  canvas.addEventListener('mousemove', (e) => {
    if (isPainting && exclusionTool === 'brush') {
      paintAt(e);
      return;
    }
    if (!isPainting && exclusionTool === 'bucket' && currentGeometry) {
      updateBucketHover(e);
    }
  });

  canvas.addEventListener('mouseleave', () => {
    _lastHoverTriIdx = -1;
    setHoverPreview(null);
  });

  document.addEventListener('mouseup', () => {
    if (!isPainting) return;
    isPainting = false;
    getControls().enabled = true;
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && exclusionTool) {
      setExclusionTool(null);
    }
  });
}

// ── Exclusion helpers ─────────────────────────────────────────────────────────

function setExclusionTool(tool) {
  // Clicking the active tool toggles it off; passing null always deactivates
  exclusionTool = (exclusionTool === tool) ? null : tool;
  exclBrushBtn.classList.toggle('active', exclusionTool === 'brush');
  exclBucketBtn.classList.toggle('active', exclusionTool === 'bucket');
  // Show brush-type row only while brush is active
  exclBrushTypeRow.classList.toggle('hidden', exclusionTool !== 'brush');
  // Show radius row only while brush + radius mode is active
  exclRadiusRow.classList.toggle('hidden', !(exclusionTool === 'brush' && brushIsRadius));
  // Show threshold row only while bucket is active
  exclThresholdRow.classList.toggle('hidden', exclusionTool !== 'bucket');
  canvas.style.cursor = exclusionTool ? 'crosshair' : '';
  // Clear hover preview whenever the tool changes or is deactivated
  _lastHoverTriIdx = -1;
  setHoverPreview(null);
  // Re-enable controls if tool was deactivated mid-paint
  if (!exclusionTool) {
    isPainting = false;
    getControls().enabled = true;
  }
}

function _canvasNDC(e) {
  const rect = canvas.getBoundingClientRect();
  return new THREE.Vector2(
    ((e.clientX - rect.left) / rect.width)  *  2 - 1,
    ((e.clientY - rect.top)  / rect.height) * -2 + 1,
  );
}

function pickTriangle(e) {
  const mesh = getCurrentMesh();
  if (!mesh) return -1;
  _raycaster.setFromCamera(_canvasNDC(e), getCamera());
  const hits = _raycaster.intersectObject(mesh);
  return hits.length > 0 ? hits[0].faceIndex : -1;
}

function paintAt(e) {
  const mesh = getCurrentMesh();
  if (!mesh) return;
  _raycaster.setFromCamera(_canvasNDC(e), getCamera());
  const hits = _raycaster.intersectObject(mesh);
  if (hits.length === 0) return;

  const triIdx = hits[0].faceIndex;

  if (brushIsRadius) {
    const hitPt    = hits[0].point;
    const triCount = triangleCentroids.length / 3;
    const r2 = brushRadius * brushRadius;
    for (let t = 0; t < triCount; t++) {
      const dx = triangleCentroids[t * 3]     - hitPt.x;
      const dy = triangleCentroids[t * 3 + 1] - hitPt.y;
      const dz = triangleCentroids[t * 3 + 2] - hitPt.z;
      if (dx * dx + dy * dy + dz * dz <= r2) {
        if (eraseMode) excludedFaces.delete(t); else excludedFaces.add(t);
      }
    }
  } else {
    if (eraseMode) excludedFaces.delete(triIdx); else excludedFaces.add(triIdx);
  }

  refreshExclusionOverlay();
}

function refreshExclusionOverlay() {
  if (!currentGeometry) return;
  setExclusionOverlay(buildExclusionOverlayGeo(currentGeometry, excludedFaces));
  const n = excludedFaces.size;
  exclCount.textContent = `${n.toLocaleString()} face${n === 1 ? '' : 's'} excluded`;
}

function updateBucketHover(e) {
  const triIdx = pickTriangle(e);
  if (triIdx === _lastHoverTriIdx) return; // unchanged — skip expensive BFS
  _lastHoverTriIdx = triIdx;
  if (triIdx < 0 || !triangleAdjacency) {
    setHoverPreview(null);
    return;
  }
  const hovered = bucketFill(triIdx, triangleAdjacency, bucketThreshold);
  setHoverPreview(buildExclusionOverlayGeo(currentGeometry, hovered));
}

// ── Slider helper ─────────────────────────────────────────────────────────────

function linkSlider(slider, valInput, onChangeFn, livePreview = true) {
  const isSpan = valInput.tagName === 'SPAN';
  slider.addEventListener('input', () => {
    const v = parseFloat(slider.value);
    const display = onChangeFn(v);
    if (isSpan) valInput.textContent = display; else valInput.value = display;
    if (livePreview) {
      clearTimeout(previewDebounce);
      previewDebounce = setTimeout(updatePreview, 80);
    }
  });
  if (!isSpan) {
    valInput.addEventListener('change', () => {
      const raw = parseFloat(valInput.value);
      if (isNaN(raw)) { valInput.value = slider.value; return; }
      const clamped = Math.max(parseFloat(slider.min), Math.min(parseFloat(slider.max), raw));
      slider.value = clamped;
      valInput.value = onChangeFn(clamped);
      if (livePreview) {
        clearTimeout(previewDebounce);
        previewDebounce = setTimeout(updatePreview, 80);
      }
    });
  }
}

function formatM(n) {
  return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)} M`
       : n >= 1_000    ? `${(n / 1_000).toFixed(0)} k`
       : String(n);
}

// ── STL loading ───────────────────────────────────────────────────────────────

async function handleSTL(file) {
  try {
    const { geometry, bounds } = await loadSTLFile(file);
    currentGeometry = geometry;
    currentBounds   = bounds;

    // Dispose old preview material and reset state for the new mesh
    if (previewMaterial) {
      previewMaterial.dispose();
      previewMaterial = null;
    }

    // Auto-select Brick preset (index 5) on first load
    const brickIdx = PRESETS.findIndex(p => p.name === 'Brick');
    if (brickIdx >= 0 && !activeMapEntry) {
      activeMapEntry = PRESETS[brickIdx];
      activeMapName.textContent = PRESETS[brickIdx].name;
      const swatches = document.querySelectorAll('.preset-swatch');
      swatches.forEach((s, i) => s.classList.toggle('active', i === brickIdx));
    }
    mappingSelect.value = String(settings.mappingMode);

    // Show mesh with a default material until a map is selected
    loadGeometry(geometry);
    dropHint.classList.add('hidden');

    // Reset exclusion state for the new mesh
    excludedFaces     = new Set();
    exclusionTool     = null;
    eraseMode         = false;
    isPainting        = false;
    exclBrushBtn.classList.remove('active');
    exclBucketBtn.classList.remove('active');
    exclEraseToggle.classList.remove('active');
    exclBrushTypeRow.classList.add('hidden');
    exclRadiusRow.classList.add('hidden');
    exclThresholdRow.classList.add('hidden');
    canvas.style.cursor = '';
    setExclusionOverlay(null);
    setHoverPreview(null);
    _lastHoverTriIdx = -1;
    exclCount.textContent = '0 faces excluded';
    // Build adjacency data for brush/bucket tools (synchronous; fast enough for
    // typical STL sizes processed by this tool)
    const adjData = buildAdjacency(geometry);
    triangleAdjacency = adjData.adjacency;
    triangleCentroids = adjData.centroids;

    // Reset scale & offset sliders so scale=1 = one tile covers the full bounding box
    const resetVal = (slider, valEl, value) => {
      slider.value = value;
      valEl.value = value;
    };
    settings.scaleU  = 1; scaleUSlider.value = scaleToPos(1); scaleUVal.value = 1;
    settings.scaleV  = 1; scaleVSlider.value = scaleToPos(1); scaleVVal.value = 1;
    settings.offsetU = 0; resetVal(offsetUSlider, offsetUVal, 0);
    settings.offsetV = 0; resetVal(offsetVSlider, offsetVVal, 0);
    triLimitWarning.classList.add('hidden');

    // Default edge length = 1/100 of the largest bounding box dimension
    const maxDim = Math.max(bounds.size.x, bounds.size.y, bounds.size.z);
    const defaultEdge = Math.max(0.1, Math.min(5.0, +(maxDim / 200).toFixed(2)));
    settings.refineLength = defaultEdge;
    refineLenSlider.value = defaultEdge;
    refineLenVal.value = defaultEdge;

    const triCount = getTriangleCount(geometry);
    const mb = ((geometry.attributes.position.array.byteLength) / 1024 / 1024).toFixed(2);
    meshInfo.textContent = `${triCount.toLocaleString()} triangles · ${mb} MB`;

    exportBtn.disabled = (activeMapEntry === null);
    updatePreview();
  } catch (err) {
    console.error('Failed to load STL:', err);
    alert(`Could not load STL: ${err.message}`);
  }
}

// ── Live preview ──────────────────────────────────────────────────────────────

function updatePreview() {
  if (!currentGeometry || !currentBounds) return;

  const fullSettings = { ...settings, bounds: currentBounds };

  if (!activeMapEntry) {
    // No map yet — plain material
    if (previewMaterial) {
      setMeshMaterial(null);
      previewMaterial.dispose();
      previewMaterial = null;
    }
    exportBtn.disabled = true;
    return;
  }

  if (!previewMaterial) {
    previewMaterial = createPreviewMaterial(activeMapEntry.texture, fullSettings);
    loadGeometry(currentGeometry, previewMaterial);
  } else {
    updateMaterial(previewMaterial, activeMapEntry.texture, fullSettings);
  }

  exportBtn.disabled = false;
}

// ── Export pipeline ───────────────────────────────────────────────────────────

async function handleExport() {
  if (!currentGeometry || !activeMapEntry || isExporting) return;
  isExporting = true;
  exportBtn.classList.add('busy');
  exportProgress.classList.remove('hidden');

  try {
    setProgress(0.02, 'Subdividing mesh…');

    // Build per-vertex exclusion weights if any faces are excluded.
    // subdivision.js interpolates these through edge splits so the exclusion
    // propagates correctly to all new vertices inside the excluded region.
    const faceWeights = excludedFaces.size > 0
      ? buildFaceWeights(currentGeometry, excludedFaces)
      : null;

    const { geometry: subdivided, safetyCapHit } = await runAsync(() =>
      subdivide(currentGeometry, settings.refineLength,
                (p) => setProgress(0.02 + p * 0.35, 'Subdividing mesh…'),
                faceWeights)
    );

    const subTriCount = subdivided.attributes.position.count / 3;
    setProgress(0.38, `Applying displacement to ${subTriCount.toLocaleString()} triangles…`);

    const displaced = await runAsync(() =>
      applyDisplacement(
        subdivided,
        activeMapEntry.imageData,
        activeMapEntry.width,
        activeMapEntry.height,
        settings,
        currentBounds,
        (p) => setProgress(0.38 + p * 0.32, `Displacing vertices…`)
      )
    );

    const dispTriCount = displaced.attributes.position.count / 3;
    const needsDecimation = dispTriCount > settings.maxTriangles;
    triLimitWarning.classList.toggle('hidden', !safetyCapHit);

    let finalGeometry = displaced;
    if (needsDecimation) {
      setProgress(0.71, `Decimating ${dispTriCount.toLocaleString()} → ${settings.maxTriangles.toLocaleString()} triangles…`);
      finalGeometry = await runAsync(() =>
        decimate(
          displaced,
          settings.maxTriangles,
          (p) => setProgress(0.71 + p * 0.25, `Decimating mesh…`)
        )
      );
    }

    // Flat-bottom clamp: when bottom faces are masked (bottomAngleLimit > 0),
    // any vertex that ended up below the original model's bottom layer gets
    // snapped back up to that Z. Only the Z-value is changed.
    if (settings.bottomAngleLimit > 0) {
      const bottomZ = currentBounds.min.z;
      const posArr  = finalGeometry.attributes.position.array;
      for (let i = 2; i < posArr.length; i += 3) {
        if (posArr[i] < bottomZ) posArr[i] = bottomZ;
      }
      finalGeometry.attributes.position.needsUpdate = true;
      finalGeometry.computeVertexNormals();
    }

    setProgress(0.97, 'Writing STL…');
    await yieldFrame();

    exportSTL(finalGeometry, 'textured.stl');

    setProgress(1.0, 'Done!');
    setTimeout(() => {
      exportProgress.classList.add('hidden');
      setProgress(0, '');
    }, 1500);
  } catch (err) {
    console.error('Export failed:', err);
    alert(`Export failed: ${err.message}`);
    exportProgress.classList.add('hidden');
  } finally {
    isExporting = false;
    exportBtn.classList.remove('busy');
  }
}

function setProgress(fraction, label) {
  exportProgBar.style.width = `${Math.round(fraction * 100)}%`;
  exportProgLbl.textContent = label;
}

/** Yield to the browser event loop for one frame, then run fn. */
function runAsync(fn) {
  return new Promise((resolve, reject) => {
    requestAnimationFrame(() => {
      try { resolve(fn()); }
      catch (e) { reject(e); }
    });
  });
}

function yieldFrame() {
  return new Promise(r => requestAnimationFrame(r));
}
