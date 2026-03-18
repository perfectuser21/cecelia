# Learning: 注册5个 content-* task_type 到 Brain

**Branch**: cp-03181927-content-pipeline-brain-register
**Date**: 2026-03-18

## 做了什么

在 Brain executor.js skillMap 和 task-router.js VALID_TASK_TYPES/SKILL_WHITELIST 中注册了5个新 task_type：
- content-pipeline → /content-creator
- content-research → /notebooklm
- content-generate → /content-creator
- content-review → /content-creator
- content-export → /content-creator

### 根本原因

**DoD Test 命令需要可在 CI 中独立运行**：executor.js import 时会加载 uuid 等外部依赖，CI DoD 检查阶段没有运行 `npm install`，导致 `ERR_MODULE_NOT_FOUND`。应改用 `fs.readFileSync` 检查源文件内容，或只测试不依赖外部包的 task-router.js。

**Brain manifest 必须随代码一起更新**：Brain L2 Consistency 门禁会检查 `brain-manifest.generated.json` 是否与源码一致。任何添加新 skill/action 相关代码后，必须运行 `node packages/brain/scripts/generate-manifest.mjs` 并提交结果。

### 下次预防

- [ ] 写 DoD Test 命令时优先用 `fs.readFileSync` 直接读源文件内容，避免 import 外部依赖
- [ ] task-router.js 测试（VALID_TASK_TYPES/isValidTaskType）可直接 import，因为 task-router.js 无外部依赖
- [ ] executor.js 的 skillMap 测试用 grep 源文件代替 import
- [ ] 改 Brain 代码后必须运行 `node packages/brain/scripts/generate-manifest.mjs` 生成新 manifest
- [ ] Learning 必须在第一次 push 前写好并加入 commit（非事后补写）
- [ ] feat 类型 commit 必须包含测试文件变更（L3 Test Coverage 门禁）
