---
branch: cp-03201000-publisher-brain-integration
task: feat(publisher): 多平台发布调度器 v1
date: 2026-03-20
---

# Learning: feat(publisher): 多平台发布调度器 v1

## 背景

将 Cecelia Brain 与 8 个平台发布脚本打通，新增 `content_publish` 任务类型路由、`content_publish_jobs` 队列表、以及 `/api/brain/publish-jobs` REST API。

### 根本原因

**DoD 测试 CI 兼容性陷阱（三类）：**

1. **`require('pg')` 在 CI 失败**：`check-dod-mapping.cjs` 在 `GITHUB_ACTIONS=true` 时会实际执行所有 `manual:` 命令，但 CI runner 从 repo root 执行 `node -e "require('pg')..."`，而 pg 模块在 `packages/brain/node_modules/`，根目录没有。报错：`Cannot find module 'pg'`。

2. **硬编码本机路径失效**：测试中用 `import('/Users/administrator/perfect21/cecelia/packages/brain/src/executor.js')` 这样的绝对路径，在 CI 上 `/Users/administrator/...` 根本不存在，报 `ERR_MODULE_NOT_FOUND`。

3. **`localhost:5221` 在 CI 不可用**：`curl http://localhost:5221/api/brain/publish-jobs` 在 CI runner 上无 Brain 进程，必然失败。

### 下次预防

- [ ] DoD 测试只用 **文件内容检查**（`fs.readFileSync` + `String.includes`），不连数据库、不连 Brain
- [ ] DoD 测试路径必须是**相对路径**（`packages/brain/...`），绝不用绝对路径
- [ ] 需要测运行时行为，用 **`npx vitest run`** 代替直接 node import（vitest 会在 packages/brain 上下文中正确解析依赖）
- [ ] 写完 DoD 测试后，本地先用 `node packages/engine/scripts/devgate/check-dod-mapping.cjs` 验证一遍，再 commit
- [ ] DoD 中涉及新 migration 的 `[ARTIFACT]` 验证：用 `fs.readFileSync('packages/brain/migrations/xxx.sql')` 检查文件内容，而不是查 DB

## 技术细节

- `getSkillForTaskType` 增加 payload 参数，在 skillMap 查找之前先做 `content_publish` 平台路由
- `content_publish_jobs` 表设计：platform + status 双索引，支持跨平台查询和状态过滤
- selfcheck.js 的 `EXPECTED_SCHEMA_VERSION` 必须与最新 migration 编号保持同步，否则 brain-precheck 会失败
