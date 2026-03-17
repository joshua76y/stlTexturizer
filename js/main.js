import { initViewer, loadGeometry, setMeshMaterial } from './viewer.js';
import { loadSTLFile, computeBounds, getTriangleCount }  from './stlLoader.js';
import { PRESETS, loadCustomTexture }  from './presetTextures.js';
import { createPreviewMaterial, updateMaterial } from './previewMaterial.js';
import { subdivide }          from './subdivision.js';
import { applyDisplacement }  from './displacement.js';
import { decimate }           from './decimation.js';
import { exportSTL }          from './exporter.js';

// ── State ─────────────────────────────────────────────────────────────────────

let currentGeometry   = null;   // original loaded geometry
let currentBounds     = null;   // bounds of the original geometry
let activeMapEntry    = null;   // { name, texture, imageData, width, height }
let previewMaterial   = null;
let isExporting       = false;

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

// ── Init ──────────────────────────────────────────────────────────────────────

initViewer(canvas);
buildPresetGrid();
wireEvents();

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
  scaleUSlider.addEventListener('input', () => {
    const v = parseFloat(scaleUSlider.value);
    settings.scaleU = v;
    scaleUVal.textContent = v.toFixed(2);
    if (settings.lockScale) {
      settings.scaleV = v;
      scaleVSlider.value = v;
      scaleVVal.textContent = v.toFixed(2);
    }
    clearTimeout(previewDebounce);
    previewDebounce = setTimeout(updatePreview, 80);
  });

  // Scale V — when lock is on, mirror to U
  scaleVSlider.addEventListener('input', () => {
    const v = parseFloat(scaleVSlider.value);
    settings.scaleV = v;
    scaleVVal.textContent = v.toFixed(2);
    if (settings.lockScale) {
      settings.scaleU = v;
      scaleUSlider.value = v;
      scaleUVal.textContent = v.toFixed(2);
    }
    clearTimeout(previewDebounce);
    previewDebounce = setTimeout(updatePreview, 80);
  });

  // Lock toggle
  lockScaleBtn.addEventListener('click', () => {
    settings.lockScale = !settings.lockScale;
    lockScaleBtn.classList.toggle('active', settings.lockScale);
    lockScaleBtn.setAttribute('aria-pressed', String(settings.lockScale));
    // When locking, snap V to current U
    if (settings.lockScale) {
      settings.scaleV = settings.scaleU;
      scaleVSlider.value = settings.scaleU;
      scaleVVal.textContent = settings.scaleU.toFixed(2);
      updatePreview();
    }
  });

  linkSlider(offsetUSlider,   offsetUVal,   v => { settings.offsetU   = v; return v.toFixed(2); });
  linkSlider(offsetVSlider,   offsetVVal,   v => { settings.offsetV   = v; return v.toFixed(2); });
  linkSlider(amplitudeSlider, amplitudeVal, v => { settings.amplitude = v; return `${v.toFixed(2)} mm`; });
  linkSlider(refineLenSlider, refineLenVal, v => { settings.refineLength  = v; return `${v.toFixed(1)} mm`; }, false);
  linkSlider(maxTriSlider,    maxTriVal,    v => { settings.maxTriangles  = v; return formatM(v); }, false);

  // ── Export ──
  exportBtn.addEventListener('click', handleExport);
}

// ── Slider helper ─────────────────────────────────────────────────────────────

let previewDebounce = null;

function linkSlider(slider, valEl, onChangeFn, livePreview = true) {
  slider.addEventListener('input', () => {
    const v  = parseFloat(slider.value);
    valEl.textContent = onChangeFn(v);
    if (livePreview) {
      clearTimeout(previewDebounce);
      previewDebounce = setTimeout(updatePreview, 80);
    }
  });
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

    // Reset scale & offset sliders so scale=1 = one tile covers the full bounding box
    const resetVal = (slider, valEl, value, fmt) => {
      slider.value = value;
      valEl.textContent = fmt(value);
    };
    settings.scaleU  = 1; resetVal(scaleUSlider,  scaleUVal,  1, v => v.toFixed(2));
    settings.scaleV  = 1; resetVal(scaleVSlider,  scaleVVal,  1, v => v.toFixed(2));
    settings.offsetU = 0; resetVal(offsetUSlider, offsetUVal, 0, v => v.toFixed(2));
    settings.offsetV = 0; resetVal(offsetVSlider, offsetVVal, 0, v => v.toFixed(2));
    triLimitWarning.classList.add('hidden');

    // Default edge length = 1/100 of the largest bounding box dimension
    const maxDim = Math.max(bounds.size.x, bounds.size.y, bounds.size.z);
    const defaultEdge = Math.max(0.1, Math.min(5.0, +(maxDim / 200).toFixed(2)));
    settings.refineLength = defaultEdge;
    refineLenSlider.value = defaultEdge;
    refineLenVal.textContent = `${defaultEdge.toFixed(2)} mm`;

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

    const { geometry: subdivided, safetyCapHit } = await runAsync(() =>
      subdivide(currentGeometry, settings.refineLength,
                (p) => setProgress(0.02 + p * 0.35, 'Subdividing mesh…'))
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
