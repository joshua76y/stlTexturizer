import * as THREE from 'three';

const SIZE  = 512; // texture resolution for both preview and sampling
const THUMB = 80;

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeCanvas(size = SIZE) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return c;
}

// ── Image-based presets ───────────────────────────────────────────────────────

const IMAGE_PRESETS = [
  { name: 'Basket',   url: 'basket.jpg'   },
  { name: 'Brick',    url: 'brick.jpg'    },
  { name: 'Bubble',   url: 'bubble.jpg'   },
  { name: 'Crystal',  url: 'crystal.jpg'  },
  { name: 'Knitting', url: 'knitting.jpg' },
  { name: 'Knurling', url: 'knurling.jpg' },
  { name: 'Leather',  url: 'leather.jpg'  },
  { name: 'Leather 2', url: 'leather2.jpg' },
  { name: 'Weave',    url: 'weave.jpg'    },
  { name: 'Wood',     url: 'wood.jpg'     },
  { name: 'Noise',    url: 'noise.jpg'    },
];

function loadImagePreset({ name, url }) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const full = makeCanvas(SIZE);
      full.getContext('2d').drawImage(img, 0, 0, SIZE, SIZE);

      const thumb = makeCanvas(THUMB);
      thumb.getContext('2d').drawImage(img, 0, 0, THUMB, THUMB);

      const imageData = full.getContext('2d').getImageData(0, 0, SIZE, SIZE);
      const texture   = new THREE.CanvasTexture(full);
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.name = name;

      resolve({ name, thumbCanvas: thumb, fullCanvas: full, texture, imageData, width: SIZE, height: SIZE });
    };
    img.onerror = () => reject(new Error(`Failed to load preset image: ${url}`));
    img.src = url;
  });
}

export function loadPresets() {
  return Promise.all(IMAGE_PRESETS.map(loadImagePreset));
}


/**
 * Build a THREE.CanvasTexture + ImageData from a user-uploaded image File.
 */
export function loadCustomTexture(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const canvas = makeCanvas(SIZE);
      const ctx    = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, SIZE, SIZE);
      const imageData = ctx.getImageData(0, 0, SIZE, SIZE);
      const texture   = new THREE.CanvasTexture(canvas);
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.name = file.name;
      resolve({ name: file.name, fullCanvas: canvas, texture, imageData, width: SIZE, height: SIZE });
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Failed to load image')); };
    img.src = url;
  });
}
