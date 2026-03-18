import * as THREE from 'three';
import { initViewer, loadGeometry, setMeshMaterial, setWireframe,
         getControls, getCamera, getCurrentMesh,
         setExclusionOverlay, setHoverPreview, setViewerTheme } from './viewer.js';
import { loadSTLFile, computeBounds, getTriangleCount }  from './stlLoader.js';
import { loadPresets, loadCustomTexture }  from './presetTextures.js';
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
let currentStlName    = 'model'; // base filename of the loaded STL (no extension)
let activeMapEntry    = null;   // { name, texture, imageData, width, height, isCustom? }
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
let selectionMode      = false;       // false = exclude painted faces; true = include only painted faces
let _lastHoverTriIdx   = -1;          // last triangle index used for hover preview
const _raycaster       = new THREE.Raycaster();

const settings = {
  mappingMode:   5,     // Triplanar default
  scaleU:        1.0,
  scaleV:        1.0,
  amplitude:     0.5,
  offsetU:       0.0,
  offsetV:       0.0,
  rotation:      0,
  refineLength:  1.0,
  maxTriangles:  1_000_000,
  lockScale:     true,
  bottomAngleLimit: 5,
  topAngleLimit:    0,
};

// ── DOM refs ──────────────────────────────────────────────────────────────────

const canvas         = document.getElementById('viewport');
const brushCursorEl  = document.getElementById('brush-cursor');
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
const exportProgPct    = document.getElementById('export-progress-pct');
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
const rotationSlider = document.getElementById('rotation');
const rotationVal    = document.getElementById('rotation-val');
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
const exclModeExcludeBtn  = document.getElementById('excl-mode-exclude');
const exclModeIncludeBtn  = document.getElementById('excl-mode-include');
const exclSectionHeading  = document.getElementById('excl-section-heading');
const exclHint            = document.getElementById('excl-hint');

// ── Scale slider log helpers ──────────────────────────────────────────────────
// Slider stores 0–1000; actual scale spans 0.1–10 on a log axis.
// Middle position 500 → scale 1.0 (exact midpoint on log scale).
const _LOG_MIN = Math.log(0.1);
const _LOG_MAX = Math.log(10);
const scaleToPos = v => Math.round((Math.log(Math.max(0.1, Math.min(10, v))) - _LOG_MIN) / (_LOG_MAX - _LOG_MIN) * 1000);
const posToScale = p => parseFloat(Math.exp(_LOG_MIN + (p / 1000) * (_LOG_MAX - _LOG_MIN)).toFixed(1));

// ── Init ──────────────────────────────────────────────────────────────────────

let PRESETS = [];

initViewer(canvas);

// Apply saved theme to 3D viewport on startup
setViewerTheme(document.documentElement.getAttribute('data-theme') === 'light');

// Theme toggle
document.getElementById('theme-toggle').addEventListener('click', () => {
  const isLight = document.documentElement.getAttribute('data-theme') !== 'light';
  document.documentElement.setAttribute('data-theme', isLight ? 'light' : 'dark');
  localStorage.setItem('stlt-theme', isLight ? 'light' : 'dark');
  setViewerTheme(isLight);
});

wireEvents();
// Sync scale number inputs with the slider's initial position
scaleUVal.value = posToScale(parseFloat(scaleUSlider.value));
scaleVVal.value = posToScale(parseFloat(scaleVSlider.value));

loadPresets().then(presets => {
  PRESETS = presets;
  buildPresetGrid();
  // Select Noise as the default preset
  const noiseIdx = PRESETS.findIndex(p => p.name === 'Noise');
  const defaultIdx = noiseIdx !== -1 ? noiseIdx : 0;
  const swatches = presetGrid.querySelectorAll('.preset-swatch');
  if (swatches[defaultIdx]) selectPreset(defaultIdx, swatches[defaultIdx]);
}).catch(err => console.error('Failed to load preset textures:', err));

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
      activeMapEntry.isCustom = true;
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
  linkSlider(rotationSlider,  rotationVal,  v => { settings.rotation  = v; return Math.round(v); });
  linkSlider(amplitudeSlider, amplitudeVal, v => { settings.amplitude = v; return v.toFixed(2); });
  linkSlider(refineLenSlider, refineLenVal, v => { settings.refineLength  = v; return v.toFixed(1); }, false);
  linkSlider(maxTriSlider, maxTriVal, v => { settings.maxTriangles = v; return formatM(v); }, false);
  linkSlider(bottomAngleLimitSlider, bottomAngleLimitVal, v => { settings.bottomAngleLimit = v; return v; });
  linkSlider(topAngleLimitSlider,    topAngleLimitVal,    v => { settings.topAngleLimit    = v; return v; });

  // ── Export ──
  exportBtn.addEventListener('click', () => {
    if (localStorage.getItem('stlt-no-sponsor') === '1') {
      handleExport();
      return;
    }
    const overlay = document.getElementById('sponsor-overlay');
    const closeBtn = document.getElementById('sponsor-close');
    const storeLink = overlay.querySelector('.sponsor-link');
    overlay.classList.remove('hidden');

    const dismiss = () => {
      if (document.getElementById('sponsor-dont-show').checked) {
        localStorage.setItem('stlt-no-sponsor', '1');
      }
      overlay.classList.add('hidden');
      handleExport();
    };

    closeBtn.onclick = dismiss;
    // Also start processing when the user clicks through to the store
    storeLink.onclick = () => setTimeout(dismiss, 150);
  });

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
    canvas.style.cursor = exclusionTool ? 'crosshair' : '';
    brushCursorEl.style.display = 'none';
  });

  exclBrushRadiusBtn.addEventListener('click', () => {
    brushIsRadius = true;
    exclBrushRadiusBtn.classList.add('active');
    exclBrushSingleBtn.classList.remove('active');
    if (exclusionTool === 'brush') exclRadiusRow.classList.remove('hidden');
    if (exclusionTool === 'brush') canvas.style.cursor = 'none';
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

  exclModeExcludeBtn.addEventListener('click', () => setSelectionMode(false));
  exclModeIncludeBtn.addEventListener('click', () => setSelectionMode(true));

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
    if (exclusionTool === 'brush' && brushIsRadius) {
      updateBrushCursor(e);
    }
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
    brushCursorEl.style.display = 'none';
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

function setSelectionMode(include) {
  if (selectionMode === include) return;
  selectionMode = include;
  exclModeExcludeBtn.classList.toggle('active', !selectionMode);
  exclModeIncludeBtn.classList.toggle('active', selectionMode);
  exclModeExcludeBtn.setAttribute('aria-pressed', String(!selectionMode));
  exclModeIncludeBtn.setAttribute('aria-pressed', String(selectionMode));
  exclSectionHeading.textContent = selectionMode ? 'Surface Selection' : 'Surface Exclusions';
  exclHint.textContent = selectionMode
    ? 'Selected surfaces appear green and will be the only ones to receive displacement during export.'
    : 'Excluded surfaces appear orange and will not receive displacement during export.';
  // Clear the painted set — faces had opposite semantics in the previous mode
  excludedFaces = new Set();
  refreshExclusionOverlay();
}

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
  canvas.style.cursor = (exclusionTool === 'brush' && brushIsRadius) ? 'none' : exclusionTool ? 'crosshair' : '';
  // Clear hover preview whenever the tool changes or is deactivated
  _lastHoverTriIdx = -1;
  setHoverPreview(null);
  // Hide brush cursor if tool deactivated or switched away from radius brush
  if (!(exclusionTool === 'brush' && brushIsRadius)) {
    brushCursorEl.style.display = 'none';
  }
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

// The preview material uses THREE.DoubleSide, so the raycaster can return
// back-face hits of adjacent triangles that are marginally closer than the
// intended front-facing triangle.  This helper returns the first hit whose
// face normal (in world space) points toward the camera ray origin.
const _normalMatrix = new THREE.Matrix3();
function getFrontFaceHit(hits, mesh) {
  if (!hits.length) return null;
  _normalMatrix.getNormalMatrix(mesh.matrixWorld);
  for (const hit of hits) {
    const wn = hit.face.normal.clone().applyMatrix3(_normalMatrix).normalize();
    if (wn.dot(_raycaster.ray.direction) < 0) return hit;
  }
  return hits[0]; // fallback — should not happen with a closed mesh
}

function pickTriangle(e) {
  const mesh = getCurrentMesh();
  if (!mesh) return -1;
  _raycaster.setFromCamera(_canvasNDC(e), getCamera());
  const hits = _raycaster.intersectObject(mesh);
  const hit = getFrontFaceHit(hits, mesh);
  return hit ? hit.faceIndex : -1;
}

function paintAt(e) {
  const mesh = getCurrentMesh();
  if (!mesh) return;
  _raycaster.setFromCamera(_canvasNDC(e), getCamera());
  const hits = _raycaster.intersectObject(mesh);
  const hit = getFrontFaceHit(hits, mesh);
  if (!hit) return;

  const triIdx = hit.faceIndex;

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
  if (selectionMode) {
    // Include Only mode: tint the complement (non-selected faces) with a pastel blue
    // so the model stays visible against the dark background before any faces are painted.
    const maskGeo = buildExclusionOverlayGeo(currentGeometry, excludedFaces, true);
    setExclusionOverlay(maskGeo, 0x8ab4d4, 0.96);
  } else {
    setExclusionOverlay(buildExclusionOverlayGeo(currentGeometry, excludedFaces), 0xff6600);
  }
  const n = excludedFaces.size;
  exclCount.textContent = selectionMode
    ? `${n.toLocaleString()} face${n === 1 ? '' : 's'} selected`
    : `${n.toLocaleString()} face${n === 1 ? '' : 's'} excluded`;
}

function updateBrushCursor(e) {
  if (!brushIsRadius || !currentGeometry) {
    brushCursorEl.style.display = 'none';
    return;
  }
  const mesh = getCurrentMesh();
  if (!mesh) { brushCursorEl.style.display = 'none'; return; }
  _raycaster.setFromCamera(_canvasNDC(e), getCamera());
  const hits = _raycaster.intersectObject(mesh);
  if (hits.length === 0) { brushCursorEl.style.display = 'none'; return; }

  const hitPt = hits[0].point;
  const cam   = getCamera();

  // Offset the hit point by brushRadius along the camera's right axis
  // then project both to screen space to get pixel-accurate circle size
  const camRight = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0).normalize();
  const edgePt   = hitPt.clone().addScaledVector(camRight, brushRadius);

  const rect  = canvas.getBoundingClientRect();
  const toScreen = (v) => {
    const c = v.clone().project(cam);
    return {
      x: (c.x * 0.5 + 0.5) * rect.width,
      y: (1 - (c.y * 0.5 + 0.5)) * rect.height,
    };
  };

  const sc = toScreen(hitPt);
  const se = toScreen(edgePt);
  const screenRadius = Math.sqrt((se.x - sc.x) ** 2 + (se.y - sc.y) ** 2);
  const diam = screenRadius * 2;

  brushCursorEl.style.display = 'block';
  brushCursorEl.style.left    = `${rect.left + sc.x - screenRadius}px`;
  brushCursorEl.style.top     = `${rect.top  + sc.y - screenRadius}px`;
  brushCursorEl.style.width   = `${diam}px`;
  brushCursorEl.style.height  = `${diam}px`;
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
      // Clamp to the input's own min/max (may be wider than the slider range)
      const inMin = parseFloat(valInput.min);
      const inMax = parseFloat(valInput.max);
      const clamped = (!isNaN(inMin) && !isNaN(inMax))
        ? Math.max(inMin, Math.min(inMax, raw))
        : raw;
      // Move slider thumb to nearest valid position (saturates at slider edges)
      slider.value = Math.max(parseFloat(slider.min), Math.min(parseFloat(slider.max), clamped));
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
    currentStlName  = file.name.replace(/\.stl$/i, '');

    // Dispose old preview material and reset state for the new mesh
    if (previewMaterial) {
      previewMaterial.dispose();
      previewMaterial = null;
    }

    // Auto-select first preset on first load
    if (!activeMapEntry && PRESETS.length > 0) {
      activeMapEntry = PRESETS[0];
      activeMapName.textContent = PRESETS[0].name;
      const swatches = document.querySelectorAll('.preset-swatch');
      if (swatches.length > 0) swatches[0].classList.add('active');
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
    const defaultEdge = Math.max(0.1, Math.min(5.0, +(maxDim / 100).toFixed(2)));
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

/**
 * Builds per-non-indexed-vertex weights (1.0 = excluded from subdivision/displacement)
 * that combine the user-painted exclusion set AND the top/bottom angle mask.
 */
function buildCombinedFaceWeights(geometry, excludedFaces, invert, settings) {
  const weights = buildFaceWeights(geometry, excludedFaces, invert);

  const hasAngleMask = settings.bottomAngleLimit > 0 || settings.topAngleLimit > 0;
  if (!hasAngleMask) return weights;

  const posAttr = geometry.attributes.position;
  const triCount = posAttr.count / 3;
  const vA = new THREE.Vector3();
  const vB = new THREE.Vector3();
  const vC = new THREE.Vector3();
  const edge1 = new THREE.Vector3();
  const edge2 = new THREE.Vector3();
  const faceNrm = new THREE.Vector3();

  for (let t = 0; t < triCount; t++) {
    if (weights[t * 3] > 0.99) continue; // already excluded
    vA.fromBufferAttribute(posAttr, t * 3);
    vB.fromBufferAttribute(posAttr, t * 3 + 1);
    vC.fromBufferAttribute(posAttr, t * 3 + 2);
    edge1.subVectors(vB, vA);
    edge2.subVectors(vC, vA);
    faceNrm.crossVectors(edge1, edge2);
    const faceArea  = faceNrm.length();
    const faceNzNorm = faceArea > 1e-12 ? faceNrm.z / faceArea : 0;
    const faceAngle  = Math.acos(Math.abs(faceNzNorm)) * (180 / Math.PI);
    const angleMasked = faceNzNorm < 0
      ? (settings.bottomAngleLimit > 0 && faceAngle <= settings.bottomAngleLimit)
      : (settings.topAngleLimit    > 0 && faceAngle <= settings.topAngleLimit);
    if (angleMasked) {
      weights[t * 3]     = 1.0;
      weights[t * 3 + 1] = 1.0;
      weights[t * 3 + 2] = 1.0;
    }
  }
  return weights;
}

async function handleExport() {
  if (!currentGeometry || !activeMapEntry || isExporting) return;
  isExporting = true;
  exportBtn.classList.add('busy');
  exportProgress.classList.remove('hidden');

  try {
    setProgress(0.02, 'Subdividing mesh…');
    await yieldFrame();

    // Build per-vertex exclusion weights combining user-painted exclusion + angle masking.
    // Faces masked by top/bottom angle limits are treated the same as user-excluded faces
    // so subdivision skips their interior edges too, saving triangles where no
    // displacement will be applied.
    const hasAngleMask = settings.bottomAngleLimit > 0 || settings.topAngleLimit > 0;
    const faceWeights = (excludedFaces.size > 0 || selectionMode || hasAngleMask)
      ? buildCombinedFaceWeights(currentGeometry, excludedFaces, selectionMode, settings)
      : null;

    const { geometry: subdivided, safetyCapHit } = await subdivide(
      currentGeometry, settings.refineLength,
      (p) => setProgress(0.02 + p * 0.35, 'Subdividing mesh…'),
      faceWeights
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
          (p) => {
            const cur = Math.round(dispTriCount - (dispTriCount - settings.maxTriangles) * p);
            setProgress(
              0.71 + p * 0.25,
              `Decimating: ${cur.toLocaleString()} → ${settings.maxTriangles.toLocaleString()} triangles`
            );
          }
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
      // Recompute normals via cross product so they always match winding order.
      const pa = finalGeometry.attributes.position.array;
      const na = finalGeometry.attributes.normal ? finalGeometry.attributes.normal.array : new Float32Array(pa.length);
      for (let i = 0; i < pa.length; i += 9) {
        const ux = pa[i+3]-pa[i],   uy = pa[i+4]-pa[i+1], uz = pa[i+5]-pa[i+2];
        const vx = pa[i+6]-pa[i],   vy = pa[i+7]-pa[i+1], vz = pa[i+8]-pa[i+2];
        const nx = uy*vz-uz*vy, ny = uz*vx-ux*vz, nz = ux*vy-uy*vx;
        const len = Math.sqrt(nx*nx+ny*ny+nz*nz) || 1;
        na[i]   = na[i+3] = na[i+6] = nx/len;
        na[i+1] = na[i+4] = na[i+7] = ny/len;
        na[i+2] = na[i+5] = na[i+8] = nz/len;
      }
      if (!finalGeometry.attributes.normal) finalGeometry.setAttribute('normal', new THREE.Float32BufferAttribute(na, 3));
      else finalGeometry.attributes.normal.needsUpdate = true;
    }

    setProgress(0.97, 'Writing STL…');
    await yieldFrame();

    const texLabel = activeMapEntry.isCustom ? 'custom' : activeMapEntry.name.replace(/\s+/g, '-');
    const ampLabel = settings.amplitude.toFixed(2).replace('.', 'p');
    const exportName = `${currentStlName}_${texLabel}_amp${ampLabel}.stl`;
    exportSTL(finalGeometry, exportName);

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
  const pct = Math.round(fraction * 100);
  exportProgBar.style.width = `${pct}%`;
  exportProgPct.textContent = `${pct}%`;
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
