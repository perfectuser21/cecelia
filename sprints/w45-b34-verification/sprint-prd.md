# Sprint PRD — B34 sprint 子目录检测端到端验证

## OKR 对齐

- **对应 KR**：KR-Harness 稳定性（harness 管道零 ENOENT 断裂）
- **当前进度**：B34 单元测试已绿，e2e 集成覆盖待补
- **本次推进预期**：补 integration test，以真实文件系统验证子目录检测全链路

## 背景

B34（PR #2954）修复了 3 处 ENOENT：`defaultReadContractFile`、`parsePrdNode`、Runner Phase A。现有测试 `harness-sprint-subdir-detection.test.js` 全用 mocked fs，无法覆盖「真实 readdir + readFile 调用链是否一致」。W45 补一个不 mock fs 的集成测试，确认子目录检测端到端通过。

## Golden Path（核心场景）

测试从 [创建临时目录树 `sprints/w45-b34-e2e/sprint-prd.md`] → 经过 [直接调用 `parsePrdNode` + `defaultReadContractFile`，不 mock fs] → 到达 [返回正确 `effectiveSprintDir` = `sprints/w45-b34-e2e`，prdContent 与文件内容一致]。

具体：
1. 测试在 `tmp/` 下构造 `sprints/w45-b34-e2e/sprint-prd.md`（含伪 PRD 内容）和 `sprints/w45-b34-e2e/sprint-contract.md`（含伪合同内容）
2. 以 `worktreePath=tmp目录, sprint_dir='sprints'` 调用 `parsePrdNode` 和 `defaultReadContractFile`
3. 断言 `sprintDir === 'sprints/w45-b34-e2e'`，`prdContent` 与文件字面一致

## Response Schema

N/A — 任务无 HTTP 响应，测试断言替代 oracle

## 边界情况

- 子目录下无任何 sprint-prd.md → 函数应 fallback 到 `plannerOutput`（plannerOutput 非空时）
- subdir 存在但 contract 文件也缺失 → `defaultReadContractFile` 应 throw `contract file not found`

## 范围限定

**在范围内**：`packages/brain/src/__tests__/harness-sprint-subdir-detection.integration.test.js` 新增集成测试（不 mock node:fs/promises，使用真实 tmp 目录）

**不在范围内**：修改已有 unit tests；修改 harness graph 实现代码；添加新 endpoint

## 假设

- [ASSUMPTION: Vitest 在 CI 有权限写 `/tmp`，可用 `os.tmpdir()` 创建 temp dir + cleanup]
- [ASSUMPTION: `parsePrdNode` 和 `defaultReadContractFile` 均已以命名 export 导出，可直接 import]

## 预期受影响文件

- `packages/brain/src/__tests__/harness-sprint-subdir-detection.integration.test.js`：新增集成测试文件

## journey_type: dev_pipeline
## journey_type_reason: 改动仅涉及 packages/brain/src/__tests__/ 中的 harness 测试基础设施
