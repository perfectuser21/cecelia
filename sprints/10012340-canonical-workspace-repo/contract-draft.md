# Contract — 正规仓库字段解析

任务 e83e30d3-b988-490b-9bf8-b21c5e29f7df。target_environment: local_api。journey_type: dev_pipeline。

## 批准范围

仅 workspace-spec.js 识别规范 payload.repo。cecelia、zenithjoy-workspace 与完整 allowlist 身份合法；base_repo 旧URL和路径兼容；缺两个字段维持默认；两字段归一冲突拒绝，非字符串、空、任意仓库拒绝。不扩写全局 parseBaseRepo。

## E2E 验收（target_environment: local_api）

```bash
set -euo pipefail
npx vitest run tests/gp/f1/step3-canonical-workspace-repo.test.js --maxWorkers=1 --minWorkers=1
cd packages/brain
npx vitest run src/orchestrator/workspace-spec-canonical-repo.test.js src/orchestrator/workspace-spec.test.js --maxWorkers=1 --minWorkers=1
```

通过标准：新35项与旧40项全过。永久RED原版21失败14通过，来源旧任务失败不改。完整CI、native Evaluate/Judge、实际恢复获客须另外验证，不以本地PASS替代。

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期 Red 证据 |
|---|---|---|---|
| 工作区身份 | `sprints/10012340-canonical-workspace-repo/tests/canonical-repo.test.mjs` | `native entry verifies canonical repository and legacy safeguards` | 原版21失败14通过，正规ZenithJoy身份解析到错误Cecelia |
