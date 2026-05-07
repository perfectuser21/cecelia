---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Workstream 2: health endpoint 集成测试

**范围**: 新建 `tests/integration/harness-health.test.ts`（vitest）启 Brain 实例后 GET `/api/brain/harness/health` 校验 200 + body shape。
**大小**: S
**依赖**: Workstream 1
**唯一交付路径**: `tests/integration/harness-health.test.ts`（与 PRD 一致；sprint 内 `tests/ws2/...` 仅为 GAN 红证据 scaffold，不进 main）

## ARTIFACT 条目

- [ ] [ARTIFACT] 文件 `tests/integration/harness-health.test.ts` 存在
  Test: `node -e "require('fs').statSync('tests/integration/harness-health.test.ts')"`

- [ ] [ARTIFACT] 该测试 import vitest 与 supertest（或 fetch + 启 Brain server）
  Test: `node -e "const c=require('fs').readFileSync('tests/integration/harness-health.test.ts','utf8');if(!/from\s+['\"]vitest['\"]/.test(c))process.exit(1)"`

- [ ] [ARTIFACT] 测试断言含 `'/api/brain/harness/health'` 路径
  Test: `node -e "const c=require('fs').readFileSync('tests/integration/harness-health.test.ts','utf8');if(!c.includes('/api/brain/harness/health'))process.exit(1)"`

- [ ] [ARTIFACT] 测试断言 `nodes` 数组长度 ≥ 14
  Test: `node -e "const c=require('fs').readFileSync('tests/integration/harness-health.test.ts','utf8');if(!/nodes[\s\S]{0,200}(toHaveLength|length).*14/.test(c))process.exit(1)"`

## BEHAVIOR 索引（实际测试在 tests/ws2/）

见 `tests/ws2/harness-health-integration.test.ts`，覆盖：
- 启 Brain HTTP server 后 `GET /api/brain/harness/health` 返回 status 200
- 响应 body 含 `langgraph_version`（非空字符串）
- 响应 body 含 `last_attempt_at`（null 或 ISO 8601）
- 响应 body 含 `nodes`（数组，长度 ≥ 14，全部 14 节点名覆盖）
