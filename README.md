# STL质感生成器

**3D 模型置换纹理工具** — 在浏览器中为 STL / OBJ / 3MF / STEP 模型添加表面置换纹理，预览、遮罩、烘焙并导出可打印的纹理网格。纯本地处理，无需安装、无需后端。

> 焦糖铁观音基于 [CNC Kitchen · BumpMesh](https://github.com/CNCKitchen/stlTexturizer) 修改并本地化。
> 当前代码基线：上游 `a2f8db6af9`（**v1.5.2**，2026-11-04）。
> 上游英文原版文档见 [README.upstream.md](README.upstream.md)，完整发布记录见 [changelog.html](changelog.html)，架构说明见 [CONTEXT.md](CONTEXT.md)。

---

## 快速开始

| 平台 | 操作 |
|---|---|
| Windows | 双击 `start.bat`，自动启动服务并打开浏览器 |
| macOS | 双击 `start.command`（如遇安全提示：右键 → 打开） |
| 任意平台 | `python serve.py`，然后访问 http://localhost:8080 |

> 浏览器禁止从 `file://` 加载 ES Module 与纹理，**必须通过 HTTP 服务访问**，不要直接双击 `index.html`。
> **请统一使用 `serve.py`**，不要用裸 `python -m http.server`：前者是 `ThreadingHTTPServer`（module Worker 会并发请求多个 JS 文件），发送 `Cache-Control: no-store`，并显式固定 `.js` / `.mjs` → `text/javascript`、`.webp` → `image/webp` 的 MIME（部分 Python 版本把 `.mjs` 识别成 `text/plain`，会让浏览器以严格 MIME 检查拒绝加载 ES Module）。
> 三个启动脚本现已全部指向 `serve.py`。

---

## 主要功能（v1.5.2）

- **纹理库**：101 张内置无缝纹理（几何 / 图案 / 有机 / 织物 / 自然 / 防滑 / 模具 / 轮胎 8 类）+ 本地分支新增 11 张；Texture Gallery 侧栏支持搜索、分类、收藏、Turntable 预览；自定义贴图最高 2048 px，支持 ideaMaker `.texture`，上传的贴图保存在浏览器 IndexedDB。
- **纹理图层**：最多 4 层，每层独立贴图 / 投影 / 尺寸 / 高度 / 涂刷表面，可「覆盖」或「叠加」；图层与涂刷随 `.bumpmesh` 项目一起保存。
- **投影模式**：Triplanar、Cubic、Cylindrical、Spherical、Planar XY/XZ/YZ、**Outline wrap**（沿轮廓绕 Z 无接缝）、**Surface normal**（Stamp 用）；Triplanar/Cubic 侧面可绕 Z 旋转。
- **Stamp 模式**：一次性贴图（logo / 铭牌 / 标签），点击定位、拖动移动、滚动缩放，带遮挡判定，导出只细分被盖章的面。
- **涂刷与遮罩**：自适应圆形笔刷（笔刷下自动细分网格）、Hardness 软边、Standard / Precision 模式、角度遮罩、Section View 剖切后直接涂刷内腔。
- **几何质量**：自适应细分、QEM 减面、锐边 mitre、纹理延伸到未贴纹理面的交界、Mesh Check、Preserve Untextured Surfaces、导出保留模型原始位姿。
- **性能**：导出 / 3D 预览 / Outline wrap / STEP 均在 Web Worker 中运行，约 3× 导出速度、内存降低约 70%（上游口径）；3MF 使用流式 DEFLATE。
- **界面**：中英等 17 种语言（浏览器语言自动选中文）、明暗主题、折叠侧栏、手机 / 平板布局、撤销重做、项目保存 / 载入、版本号显示。

---

## 本分支的本地化改动

| 项目 | 说明 |
|---|---|
| 品牌 | `index.html` 标题 / 描述 / og 元数据 / header 署名改为「STL质感生成器」；**保留上游全部 DOM 挂点**（license / imprint / welcome / gallery / section / stamp 等），这些节点被 `js/main.js` 直接引用，不能删除 |
| 中文 | 直接采用上游官方 `js/i18n/zh.js`（347 keys），仅覆盖 3 处产品名文案；`initLang()` 按浏览器语言自动选 zh，无需改 `index.html` 的 `data-lang` |
| 自定义纹理 | 从原分支保留 11 张 `.webp` 及其缩略图，并在 `js/presetTextures.js` 的 `IMAGE_PRESETS` 末尾重新注册（分类沿用上游已有 id，无需新增 i18n key）。原分支的 `Brick (alt)` 指向不存在的 `textures/brick.webp` 且与上游 Brick 重复，已不再注册 |
| 离线依赖 | 上游的 three / fflate / meshStep 三个 CDN 依赖全部 vendor 到 `vendor/`，改写 `index.html` importmap、`js/threeCompat.js` 的 Worker 回退 URL、`js/stepWorker.js` 的 import；**运行时零外部网络请求**，STEP 导入也能离线。详见 [vendor/README.md](vendor/README.md) |
| 启动脚本 | `serve.py`（多线程 + no-store + 固定 MIME）、`start.bat`、`start.command`，三者统一走 `serve.py` |
| 文档 | 本中文 README；上游英文 README 备份为 `README.upstream.md` |
| 未移植 | 原分支的「规整化范围」选项 —— 上游已用 `preserveExcluded` / Preserve Untextured Surfaces 实现等价语义，无需保留自有补丁；原分支删除的 license / imprint / welcome 弹窗也一并恢复 |

---

## 依赖与运行条件

**依赖已全部本地化，无构建步骤、无 `npm install`、运行时零外部网络请求。** 详见 [vendor/README.md](vendor/README.md)。

| 库 | 版本 | 用途 | 本地路径 |
|---|---|---|---|
| Three.js（含 OrbitControls / STLLoader / OBJLoader / Line2） | 0.170.0 | 3D 渲染、模型导入、线框 | `vendor/three/` |
| fflate | 0.8.2 | 3MF / ZIP 解压与流式压缩 | `vendor/fflate/` |
| meshStep | 0.1.0 | STEP / STP 的浏览器内网格化 | `vendor/meshstep/` |

- 页面侧通过 `index.html` 的 importmap 解析 `three` / `three/addons/` / `fflate`；**Web Worker 不继承 importmap**，所以 `js/threeCompat.js` 会用基于 `import.meta.url` 的绝对 URL 回退到本地 three，`js/stepWorker.js` 直接相对导入本地 meshStep。两处必须与 importmap 指向同一文件。
- 页面里的商店 / 赞助 / GitHub 链接只是超链接，不是运行时资源依赖，断网不影响功能。
- 支持 Chrome / Edge / Firefox 114+ / Safari 等具备 ES Module、module Worker、WebGL2 的现代浏览器。3Dconnexion SpaceMouse 仅 Chrome / Edge（WebHID）。
- 所有网格计算都在浏览器内完成，模型不会上传到任何服务器。

---

## 许可证 / License

**已定案：沿用上游 GNU Affero General Public License v3.0-only（AGPL-3.0-only）。** `LICENSE` 保持上游原状（Copyright © 2026 CNCKitchen / Stefan Hermann），全部上游源码文件保留 `SPDX-License-Identifier: AGPL-3.0-only` 头。

原分支曾单方面把 LICENSE 改为 MIT；AGPL 代码**不能**由下游重新授权为 MIT，因此该 MIT 声明已作废，本项目整体（含 `vendor/meshStep`）按 AGPL-3.0-only 授权。若日后再改用 MIT，必须先取得上游的书面双授权，否则只能走独立重写路线。

**合规要点**：分发本程序、或把修改版部署为网络服务时，须按 AGPL §13 向使用者提供对应的完整源代码；保留全部版权 / 许可声明与源码可得链接（界面内 license / imprint 弹窗已保留）。第三方库许可见 [vendor/README.md](vendor/README.md)：Three.js / fflate 为 MIT，meshStep 为 AGPL-3.0-only。

纹理素材另有署名要求：HP = Hero Patterns（CC BY 4.0）、CC0 = ambientCG / Poly Haven、FF = Filter Forge，详见 Gallery 内署名与 `README.upstream.md`。

---

## 验证与诊断

上游自带的脚本可直接用于回归：

浏览器**运行**零依赖；下面的 Node 脚本直接 `import 'three'` / `'fflate'`，仅开发测试时需要先装一次依赖：

```bash
npm i --no-save three@0.170.0 fflate@0.8.2   # 仅测试脚本需要，应用本身不需要

node --test tests/*.test.mjs          # paintTree / zipStream / outlineWrap / exportStreaming 单测
node diag-edgekey-collision.mjs       # >2.1M 顶点 edge key 精度回归
node test-paint-tree.mjs
python generate_thumbs.py [texture.webp ...]   # 重新生成 160×160 WebP 缩略图（需 Pillow）
node bench-pipeline.mjs <model.stl> <texture.png> <refineLength> <maxTriangles>
```

> 注意 `node --test tests/` 在 Node 22 下会把目录当成模块而报错，必须写成 `node --test tests/*.test.mjs`。
> 也可不装 npm 包，用自定义 loader 把裸说明符映射到 `vendor/` 内对应文件。

`test-worker.html` 会启动真实导出 Worker 跑完整流水线并在标题输出 `RESULT: PASS`，支持 `--headless=new --dump-dom`；`test-texture-seams.html` 用于纹理接缝的手工验证。
