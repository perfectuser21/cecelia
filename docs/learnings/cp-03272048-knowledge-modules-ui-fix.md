# Learning: 知识模块页面 UI 重设计 + 查看链接修复

**Branch**: cp-03272048-knowledge-modules-ui-fix
**Date**: 2026-03-27

## 功能总结

重写 KnowledgeModules.tsx 为暗色主题（对齐 InstructionBook 风格），并修复 KnowledgeModuleDetail.tsx 中"查看知识页"按钮的 URL：从相对路径改为 `http://38.23.47.81:9998/{output_url}` 绝对 URL。

### 根本原因

知识页 HTML 文件由西安 Codex 生成，托管在 `http://38.23.47.81:9998/`（port 9998 静态文件服务器），与 Dashboard（port 5211）不同域。PR #1620 实现时用了相对路径 `/knowledge/view?url=...`，通过 KnowledgePageViewer 的 fetch 获取，但 fetch(`/${htmlUrl}`) 请求的是同域文件，无法加载跨端口的文件，导致 404。正确做法是用 `window.open` 打开绝对 URL，绕过同源限制，直接在新标签页展示知识页。

UI 方面，PR #1620 使用了 Tailwind 白色/浅色主题，与系统中其他暗色页面（InstructionBook、SuperBrain）风格不一致，用户体验断裂。重写时采用与 InstructionBook 相同的 inline style 暗色系（`#0d0d0d` 主背景、`#111` 卡片、`#3467D6` 蓝色强调）。

### 下次预防

- [ ] 新页面上线前检查 UI 风格是否与相邻页面一致（暗色系 vs 亮色系），PR 描述中显式说明主题选择
- [ ] 涉及跨端口资源的功能，明确 URL 策略：外部 URL 用 `window.open` + 绝对 URL，不要用 fetch + 相对路径
- [ ] 知识页查看功能的端口约定：HTML 知识页永远在 `http://38.23.47.81:9998/`，不通过 Dashboard proxy
