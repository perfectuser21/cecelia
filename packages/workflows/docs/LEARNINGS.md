---
version: 1.0.0
created: 2026-03-07
updated: 2026-03-07
changelog:
  - 1.0.0: 初始版本
---

# Workflows LEARNINGS

## 2026-03-07 快手发布脚本 Bug 修复 (PR #613)

### 问题

快手图文发布脚本 `publish-kuaishou-image.cjs` 在首次实现时引入了 3 个 bug：

1. **Windows 路径多余 `images` 子目录**：`DOM.setFileInputFiles` 传递的路径为 `{date}\{image-dir}\images\{filename}`，但 Windows 上的实际目录结构没有 `images` 子目录，导致 Chrome 报文件找不到错误
2. **无文件输入框时静默继续**：未找到 `input[type="file"]` 时只打印日志，脚本继续进入"发布"步骤，最终 exit 0 误报成功
3. **URL 检查过宽**：只检查 `kuaishou.com`，用户未登录时被重定向到 `passport.kuaishou.com/login`（含 kuaishou.com）也能通过

### 修复

- Bug 1：移除 `path.join(...)` 中的 `'images'` 参数
- Bug 2：改为 `throw new Error(...)` 让 catch 块捕获，exit 1
- Bug 3：检查 `cp.kuaishou.com`（创作者中心域名）

### 经验

- CDP 脚本中的 Windows 路径需与 Windows 实际目录结构完全匹配，开发时应先验证 Windows 侧目录存在
- 上传类操作（`DOM.setFileInputFiles`）失败必须阻断后续流程，不能让"发布"步骤在没有内容的情况下执行
- 创作者平台 URL 检查要比通用域名检查更精确（`cp.` 前缀区分了内容管理端和其他子域名）

### branch-protect hook 陷阱

编辑 `packages/workflows/skills/` 下的文件时，`find_prd_dod_dir` 向上搜索找到 `packages/workflows/.prd.md`（旧任务遗留），导致 hook 报 "PRD 未更新"。需在 `packages/workflows/` 下也创建分支 PRD/DoD 文件（`.prd-{branch}.md` / `.dod-{branch}.md`）。
