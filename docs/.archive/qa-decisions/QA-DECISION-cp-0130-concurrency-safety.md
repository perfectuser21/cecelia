# QA Decision: 并发安全与 CI 硬化

## 风险评估

| 规则 | 命中 | 说明 |
|------|------|------|
| R1: 核心逻辑 | ✅ | 修改 stop.sh、pr-gate-v2.sh、ci.yml |
| R2: 安全相关 | ✅ | 修复 CI 绕过漏洞、并发竞态 |
| R3: 多文件 | ✅ | 5+ 文件 |

**RISK SCORE: 3** (≥3 触发完整 QA)

## Decision: PASS

### 理由
1. 修复 P0 级安全问题，属于紧急修复
2. 方案明确，改动范围可控
3. 有明确的验收标准

### 约束
- Scope: hooks/stop.sh, hooks/pr-gate-v2.sh, hooks/branch-protect.sh, .github/workflows/ci.yml, ci/known-failures.json
- Forbidden: 不得修改核心业务逻辑，只做安全加固
- Tests: 需要验证并发场景、超时场景、CI 校验

## 测试策略

| 类型 | 覆盖 |
|------|------|
| 单元测试 | branch-protect.test.ts (正则修复) |
| 手动测试 | 并发会话、超时、CI 校验 |
