# stlTexturizer 本地化改造完成

## 改动清单

### 1. 中文语言支持 (i18n)
- **新建** `js/i18n/zh.js` — 完整的中文翻译文件（218 条），覆盖所有 UI 文本
- **修改** `js/i18n.js` — 在 `TRANSLATIONS` 中注册 `zh: { 'lang.name': '简体中文' }`
- 自动根据浏览器语言设置切换，也可手工在下拉菜单选择「简体中文」

### 2. 品牌替换
- **header logo**：「BumpMesh by CNC Kitchen」→「BumpMesh · 焦糖铁观音@2026」
- **页面标题 / meta 标签**：移除所有 CNC Kitchen 相关描述，改为中文
- **右上角 GitHub 链接**保留（指向原始项目仓库）

### 3. 移除无关功能按钮
- 移除**左下角**的 What's New 按钮
- 移除**左下角**的 License & Terms 按钮
- 移除**左下角**的 Imprint & Privacy 按钮
- 移除**视口中的 Store CTA** 推广横幅
- 清理 `main.js` 中对应的点击事件、DOM 引用和弹窗逻辑

### 4. 本地运行
- **新建** `serve.py` — 一键启动本地 HTTP 服务
- 运行方式：`python serve.py` → 访问 `http://localhost:8080`
- 所有 CDN 依赖（three.js、fflate）保持在线加载，确保功能完整
