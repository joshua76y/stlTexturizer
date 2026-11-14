# 本地依赖 / Vendored dependencies

本分支把上游通过 jsDelivr 加载的三个依赖全部复制到仓库内，**运行时不再需要任何外部网络请求**（STEP 导入也可完全离线）。无构建步骤、无 `npm install`。

| 库 | 版本 | 许可证 | 本地路径 | 上游原始来源 |
|---|---|---|---|---|
| Three.js | 0.170.0 | MIT | `three/three.module.js` + `three/addons/` | `https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js`、`examples/jsm/` |
| fflate | 0.8.2 | MIT | `fflate/browser.js` | `https://cdn.jsdelivr.net/npm/fflate@0.8.2/esm/browser.js` |
| meshStep | 0.1.0 | **AGPL-3.0-only** | `meshstep/index.js` | `https://cdn.jsdelivr.net/npm/meshstep@0.1.0/+esm` |

- `three/three.module.js` 取自 npm 官方包 `three@0.170.0` 的 `build/three.module.js`（1.3 MB 未压缩原版，自包含，无 `three.core.js` 依赖）。
- `three/addons/` 只保留应用实际引用到的 7 个模块及其相对依赖闭包：
  `controls/OrbitControls.js`、`controls/TransformControls.js`、`lines/LineMaterial.js`、`lines/LineSegments2.js`、`lines/LineSegmentsGeometry.js`、`loaders/OBJLoader.js`、`loaders/STLLoader.js`。它们内部的 `import ... from 'three'` 由页面 importmap 解析。
- `fflate/browser.js` 是官方 ESM 浏览器构建（单文件）。
- `meshstep/index.js` 是 jsDelivr 用 Rollup/esbuild 打包的 `+esm` 单文件，已移除指向 CDN 的 `sourceMappingURL` 注释；导出 `importStep` / `estimateStepSize` / `autoTessellation` 与上游 CDN 版本一致。
- 各库许可证全文：`three/LICENSE`、`fflate/LICENSE`、`meshstep/LICENSE`。

## 与上游的接线差异

| 位置 | 上游 | 本分支 |
|---|---|---|
| `index.html` importmap | jsDelivr 绝对 URL | `./vendor/...` 相对路径（含 `three/addons/` 前缀映射） |
| `index.html` | `preconnect` + CDN `modulepreload` | 移除 preconnect，modulepreload 指向本地文件 |
| `js/threeCompat.js` | Worker 中 `import('three')` 失败后回退到 CDN URL | 回退到 `new URL('../vendor/three/three.module.js', import.meta.url).href` |
| `js/stepWorker.js` | `import ... from 'https://cdn.jsdelivr.net/npm/meshstep@0.1.0/+esm'` | `import ... from '../vendor/meshstep/index.js'` |

> **为什么必须同时改 `threeCompat.js`**：按 HTML 规范，Web Worker **不继承页面的 importmap**，所以 `exportWorker` / `previewWorker` 里的裸 `three` 说明符一定会抛错，必须回退到绝对 URL。该 URL 现在指向本地文件，与 importmap 的 `three` 条目是同一个文件。

> **为什么 vendor 文件用 `.js` 而不是 `.mjs`**：部分 Python 版本的 `mimetypes` 把 `.mjs` 识别为 `text/plain`，浏览器对 ES Module 做严格 MIME 检查时会直接拒绝加载。`serve.py` 已显式注册 `.js` / `.mjs` → `text/javascript`；启动脚本统一走 `serve.py`，不要改回裸 `python -m http.server`。

## 升级依赖

1. 下载对应版本文件（three 用 npm tarball `https://registry.npmjs.org/three/-/three-<ver>.tgz`，其余用 jsDelivr）。
2. 覆盖 `vendor/` 内对应文件，同步更新 `index.html` importmap 的版本无关路径（路径不含版本号，无需改）与本文件的版本表。
3. 若 three 的 addons 出现新的相对依赖，重新计算闭包并补进 `three/addons/`。
4. 跑一遍 `serve.py`，在浏览器控制台确认 0 个失败请求，再验收 STEP 导入与导出 Worker。

## 许可证说明 / License

`vendor/` 内文件属于各自上游项目，保留其原有版权头与许可证；本仓库其余源码沿用 [CNC Kitchen / stlTexturizer 的 AGPL-3.0-only](../LICENSE)。meshStep 同为 AGPL-3.0-only，Three.js 与 fflate 为 MIT。**下游不得以 MIT 名义重新授权本项目整体**；分发或通过网络提供服务时需履行 AGPL-3.0-only 的全部义务（含提供对应源码）。
