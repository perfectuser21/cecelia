# Learning: 升级小红书和快手发布脚本（CDP UI自动化 + 音乐选择）

**分支**: cp-03162300-upgrade-xhs-ks-publishers
**日期**: 2026-03-16

## 本次做了什么

将小红书和快手图文发布脚本升级为生产可用的纯自动化方案：

- **小红书**：端口 19225→19224，上传方案改为 `Input.dispatchMouseEvent + Page.fileChooserOpened`，新增 SCP（xian-mac 跳板）和音乐选择
- **快手**：从 HTTP API 方案切换到 CDP UI 自动化（本会话已验证），新增 SCP 和音乐选择，限制话题标签 ≤4 个

---

## 根本原因（为什么旧方案不工作）

### DOM.setFileInputFiles 直接设值触发不了 Vue 上传

小红书和快手都是 Vue 3 SPA。文件上传 `<input>` 是隐藏的（`opacity:0`），背后有 Vue 自定义上传组件。

- ❌ `DOM.setFileInputFiles(backendNodeId, files)` — 静默设值，**不触发** Vue 的 `change` 事件，Vue 上传处理器不执行
- ✅ 正确方案：`Page.setInterceptFileChooserDialog` → 鼠标点击上传按钮 → `Page.fileChooserOpened` 事件 → `DOM.setFileInputFiles(fc.backendNodeId, files)`

用鼠标事件触发原生文件选择器，再通过拦截器注入文件路径，Vue 认为是用户正常操作，所有事件都会触发。

### 快手"作品描述"是 Vue 自定义组件，不是 textarea

快手的文案输入区是 Vue 组件（class `_description_eho7l_59`），不是原生 `<textarea>`。

- ❌ `document.querySelector('textarea').value = text` — 找不到元素
- ✅ 正确方案：点击固定坐标 (793, 210) → 聚焦组件 → `Input.insertText`

这个坐标是快手 CP 发布页面"作品描述"区域的中心点（1920×1080 分辨率），已通过实际发布验证。

### 快手"发布"按钮要找最后一个

页面上有多个包含"发布"文字的元素（"上传图文"/"发布图文"/"发布设置"等标题），`querySelector` 找到的是第一个。

- ✅ 正确方案：TreeWalker 遍历所有文本节点，取最后一个内容恰好等于"发布"且 `offsetParent !== null` 的元素

---

## 下次预防

- [ ] Vue SPA 的文件上传，一律用 `dispatchMouseEvent + Page.fileChooserOpened` 方案，不要直接 `DOM.setFileInputFiles`
- [ ] 快手话题标签严格限制 ≤4 个，在写文案时就控制，不要等发布失败后截断
- [ ] 快手"发布"按钮用 TreeWalker 找最后一个，避免误点标题元素
- [ ] SCP 到 Windows 必须走 xian-mac 跳板（US Mac mini 上没有 windows_ed 密钥）
- [ ] CDP UI 自动化的坐标点（如 793,210）是平台相关的，应在脚本注释中标注已验证的分辨率和条件
