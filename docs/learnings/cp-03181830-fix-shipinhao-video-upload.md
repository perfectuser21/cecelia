# Learning: 修复视频号 iframe 视频上传

**Branch**: cp-03181830-fix-shipinhao-video-upload
**Date**: 2026-03-18

## 问题描述

视频号发布页面 `https://channels.weixin.qq.com/platform/post/create` 使用嵌套 iframe 结构。
直接调用 `page.locator('.ant-upload-btn')` 无法找到上传按钮，导致视频上传失败。

### 根本原因

视频号发布页面将内容区域渲染在一个 `iframe[name="content"]` 内层 iframe 中。
Playwright 的 `page.locator()` 只能访问顶层文档，无法自动穿透 iframe 边界，
因此所有内容区元素（上传按钮、标题输入框、描述编辑器）都无法被找到。

### 解决方案

使用 SELECTORS.contentFrame 定义 iframe 选择器 `iframe[name="content"]`，
通过 `page.frameLocator()` 或直接访问 `page.frames()` 穿透到 iframe 内部，
再对 iframe 内的元素执行点击/输入操作。

### 下次预防

- [ ] 遇到 Playwright 找不到元素时，首先检查是否有 iframe 边界（DevTools → Elements 查看是否有 `<iframe>`）
- [ ] 视频号、微信公众号等腾讯系平台普遍使用 iframe 嵌套，默认应先用 `page.frames()` 检查
- [ ] 新平台发布脚本立项时，在 Task Card DoD 中明确列出 iframe 穿透验证项
- [ ] Windows SSH + CDP 场景下，文件必须先传到 Windows 本地目录，再由浏览器通过 `fileInput.setInputFiles()` 上传
