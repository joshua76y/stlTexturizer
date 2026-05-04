# BumpMesh · 焦糖铁观音@2026

**3D 模型置换纹理工具** — 在浏览器中为 STL、OBJ、3MF 模型添加表面置换纹理，无需安装，纯本地处理。

---

## 快速开始

### Windows
双击 **`start.bat`**，自动打开浏览器即可使用。

### macOS
双击 **`start.command`**（如提示安全警告，右键 → 打开），自动打开浏览器。

### 手动启动（任何平台）
```bash
python -m http.server 8080
```
然后访问 http://localhost:8080

> 由于浏览器安全策略限制 ES Module 加载，请务必通过 HTTP 服务器访问，不要直接双击 `index.html`。

---

## 功能特性

### 纹理贴图
- **36 种内置无缝纹理** — 包含编织、砖墙、气泡、碳纤维、水晶、点阵、网格、防滑纹、六边形、等栅格、针织、滚花、皮革、噪点、条纹（×2）、钻石纹、编织纹（×3）、木材（×3），以及 Cement、Geo、Leaf、Grip 1/2 等更多预设
- **自定义纹理** — 上传自己的图片作为置换贴图
- **纹理平滑** — 可调节模糊半径柔化置换贴图细节

### 投影模式
- **三平面**（默认）— 根据表面法线混合三个平面投影，适合复杂形状
- **立方体（盒状）** — 从 6 个盒面投影，带边缘接缝混合
- **圆柱** — 沿圆柱轴环绕纹理，可配置端盖角度
- **球体** — 球面映射纹理
- **平面 XY / XZ / YZ** — 沿坐标轴的平面投影

### UV 与变换控制
- **缩放 U/V** — 独立或锁定等比缩放（0.05–10×，对数曲线）
- **偏移 U/V** — 在纹理坐标系中平移贴图
- **旋转** — 投影前旋转纹理
- **接缝混合** — 柔化立方体/圆柱模式的接缝
- **过渡平滑** — 控制接缝边缘混合区域宽度
- **端盖角度**（圆柱）— 触发顶部/底部端盖投影的阈值

### 置换深度
- **纹理高度** — 0%–100% 可调置换深度
- **对称置换** — 50% 灰保持中性，白色外凸，黑色内凹（保持体积大致恒定）
- **3D 置换预览** — 实时 GPU 加速预览，直接显示顶点位移效果
- **重叠警告** — 当深度超过模型最小尺寸 10% 时发出提醒

### 表面遮罩
- **角度遮罩** — 抑制近乎水平的顶面和/或底面的纹理（0°–90° 可调）
- **面排除/包含绘制** — 用画笔标记个别面：排除（橙色）或仅包含（绿色）
  - 画笔工具 — 单击单三角形或可调半径圆形画笔
  - 桶填充 — 按二面角阈值填充相邻面
  - 擦除 — 按住 Shift 撤销绘制
  - 清除全部 — 重置遮罩

### 网格处理
- **自适应细分** — 将边细分至目标长度以下，保留尖锐折痕（>30° 二面角）
- **QEM 简化** — 基于四元误差矩阵将结果简化至目标三角形数量
- **网格规整化** — 折叠 CAD 三角剖分产生的细长三角形，使采样更一致
- **网格诊断** — 自动检查开放边、壳数，以及高级的相交/重叠检测
- **安全上限** — 细分阶段硬限制为 1000 万三角形，防止内存溢出

### 3D 查看器
- **轨道/平移/缩放** — 鼠标控制
- **线框模式** — 可视化网格拓扑
- **网格信息** — 实时显示三角形数、文件大小、包围盒尺寸
- **坐标系指示** — X=红、Y=绿、Z=蓝
- **贴面放置** — 点击面将其朝下定向到打印平台

### 文件支持
- **.STL** — 二进制和 ASCII 格式
- **.OBJ** — 通过 Three.js OBJLoader
- **.3MF** — 基于 ZIP 的格式

### 导出
- **导入/导出项目** — 保存为 `.bumpmesh` 文件，随时恢复工作状态
- **撤销/重做** — 完整的键盘快捷键支持
- **导出 STL / 3MF** — 烘焙纹理后直接下载
- **进度报告** — 细分 → 置换 → 简化 → 写入各阶段进度显示

### 界面
- **中/英/德/意/西/葡/法/日/韩 多语言** — 自动检测浏览器语言，可手动切换
- **浅色/深色主题** — 跟随系统偏好，可手动切换
- **全本地处理** — 所有计算均在浏览器内完成，不上传任何数据

---

## 项目结构

```
index.html              # 主入口
style.css               # 样式（浅色/深色主题）
logo.png                # Favicon 和头部 Logo
start.bat               # Windows 一键启动
start.command           # macOS 一键启动
textures/               # 内置纹理图片（36 种）
textures/thumbs/        # 纹理缩略图
js/
  main.js               # 应用主逻辑和 UI 绑定
  viewer.js             # Three.js 场景/相机/控制
  stlLoader.js          # STL 解析器（二进制和 ASCII）
  presetTextures.js     # 内置纹理预设 + 自定义上传
  previewMaterial.js    # 实时预览的 Three.js 材质
  mapping.js            # UV 投影逻辑（7 种模式）
  displacement.js       # 顶点置换烘焙
  subdivision.js        # 自适应网格细分
  decimation.js         # QEM 网格简化
  regularization.js     # 网格规整化
  exclusion.js          # 面排除/包含绘制
  exporter.js           # STL/3MF 导出
  meshValidation.js     # 网格诊断
  i18n.js               # 国际化引擎
  i18n/                 # 翻译文件（9 种语言）
```

---

## 依赖

通过 CDN（[jsDelivr](https://www.jsdelivr.com/)）加载，无需构建或安装：

| 库 | 版本 | 协议 | 用途 |
|---|---|---|---|
| [Three.js](https://threejs.org/) | 0.170.0 | MIT | 3D 渲染、场景管理、材质 |
| — [OrbitControls](https://threejs.org/docs/#examples/en/controls/OrbitControls) | 0.170.0 | MIT | 相机轨道/平移/缩放 |
| — [STLLoader](https://threejs.org/docs/#examples/en/loaders/STLLoader) | 0.170.0 | MIT | STL 导入 |
| — [OBJLoader](https://threejs.org/docs/#examples/en/loaders/OBJLoader) | 0.170.0 | MIT | OBJ 导入 |
| — [LineSegments2 / LineSegmentsGeometry / LineMaterial](https://threejs.org/docs/#examples/en/lines/LineSegments2) | 0.170.0 | MIT | 宽线框叠加显示 |
| [fflate](https://github.com/101arrowz/fflate) | 0.8.2 | MIT | 3MF 导入/导出的 ZIP 压缩解压 |

所有依赖均为 MIT 协议。

---

## 许可

GNU AGPL v3.0 — 参见 [LICENSE](LICENSE)。
