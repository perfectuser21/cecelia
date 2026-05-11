# PRD — [CONFIG] proposer SKILL v7.5: 死规则禁 PRD 字段名漂移 (Bug 8)

## 背景 / 问题

W25 实证 generator 严守 contract（PR E 真生效），但 **proposer 漂移 PRD 字段名**：
- PRD: `{"result": <-n>, "operation": "negate"}` + 禁用列表含 `negation`
- Proposer contract: `200 返 {negation: result}` ← PRD `result/operation` 改成 `negation`
- Generator 严守 contract → 实现 `{negation: -5}`
- Final_evaluate FAIL（不符 PRD）
- Task=failed

W19→W24 漂移源 = generator；W25 漂移源 = **proposer**（漂移上移一层）。

## 成功标准

- SC-001: proposer SKILL v7.4 → v7.5
- SC-002: 加"死规则"段 — "PRD 是法律，proposer 是翻译，不许改字段名"
- SC-003: 表列 4 类严禁行为 + 必须行为
- SC-004: 加自查 checklist（提取 PRD keys / 提取 contract keys / 字面相等 / 禁用清单不在 contract）
- SC-005: 派 W26 验：proposer 字面用 PRD `result/operation`，不再 substitution

## 范围限定

**在范围内**：
- packages/workflows/skills/harness-contract-proposer/SKILL.md（v7.4 → v7.5）

**不在范围内**：
- 改其他 SKILL
- 改 brain code（PR E 已修 generator）
- 抽 buildAgentPrompt helper（PR F 待定）

## 不做

- 不改其他 4 个 SKILL
- 不改 brain code
- 不写 unit test（SKILL.md 配置文件）

## 测试策略

- E2E: 派 W26 验 proposer 是否字面用 PRD 字段名
- smoke.sh: N/A（packages/workflows/）

## 受影响文件

- `packages/workflows/skills/harness-contract-proposer/SKILL.md`
- `docs/learnings/cp-0511133900-proposer-skill-prd-field-name-hard-rule.md`
