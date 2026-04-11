# Learning: Pipeline Step Detail — Prompt Reconstruction Pattern

## 根本原因

Harness executor 的 `preparePrompt()` 在运行时动态构建 prompt（从 task payload + git 分支读文件），但不存储到数据库。要在详情页回溯每步的 prompt，必须在 API 层重新实现相同的构建逻辑。

## 下次预防

- [ ] 新增 Harness task type 时，同步更新 `rebuildPrompt()` 和 `getStepInput()/getStepOutput()` 映射
- [ ] `fetchFileFromBranch()` 依赖 `git fetch origin`，在大量步骤时可能成为性能瓶颈——考虑批量 fetch 或缓存
- [ ] 前端三栏视图的 `max-h-[500px]` 对超长 prompt 可能不够，后续可加全屏展开按钮
