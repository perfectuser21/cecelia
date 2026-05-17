# QA Decision

> /qa skill 输出的测试决策产物

## 基本信息

| 字段 | 值 |
|------|-----|
| Branch | `cp-xxx` |
| Date | YYYY-MM-DD |
| PRD | .prd.md |

## 测试策略

### 必须跑的测试

| 层级 | 命令 | 说明 |
|------|------|------|
| Unit | `npm run test` | 单元测试 |
| Regression | `npm run qa` | 回归测试 |
| E2E | (如适用) | 端到端 |

### RCI 决策

| 决策 | 内容 |
|------|------|
| 新增 RCI | 是/否 |
| RCI ID | (如新增) H?-00X / C?-00X |
| Priority | P0 / P1 / P2 |
| Trigger | PR / Release / Nightly |
| 理由 | 一句话 |

### DoD 条目测试方式

| DoD 条目 | 测试方式 | 说明 |
|----------|----------|------|
| 条目 1 | auto | 自动化测试覆盖 |
| 条目 2 | auto | 自动化测试覆盖 |
| 条目 3 | manual | 需要手动验证（说明原因） |

## 约束

- P0 功能：必须 auto，不允许 manual
- P1 功能：优先 auto，manual 需说明理由
- P2 功能：auto 或 manual 均可

## 结论

Decision: **READY** / **NEED_CLARIFICATION**

(如果 NEED_CLARIFICATION，列出需要澄清的问题)
