# Learning — [CONFIG] proposer SKILL v7.5 死规则禁 PRD 字段名漂移 (Bug 8)

**日期**: 2026-05-11
**类型**: [CONFIG]（proposer SKILL prompt 修订）

## 背景

W25 是 PR E (generator inline SKILL) 修复后的验收。结果 generator 真严守 contract（实现 `{negation:-5}` 跟 contract 一致），但 **contract 本身漂移了 PRD**（PRD `{result,operation}` → contract `{negation}`）。

漂移源从 generator 上移到 proposer，这是 PR E 真生效的反面证据 — generator 完全可控了。

### 根本原因

proposer SKILL v7.4 说"PRD response 字段必须 codify 成 jq -e"，但没强约束"字面使用 PRD 字段名"。Proposer LLM 看到 PRD 写 `negate` endpoint 后，倾向"语义化优化"成 `{negation}`（看起来更直观），即便 PRD 明确：
- response key 是 `result`/`operation`
- 禁用列表含 `negation`

LLM 没把 PRD 字段名视为不可改的字面法定。

### 下次预防

- [x] proposer SKILL.md 加"死规则"段，明示 "PRD 是法律，proposer 是翻译，不许改字段名"
- [x] 加 4 类严禁行为 + 必须行为对照表（response key / operation 值 / 禁用清单 / schema keys 集合）
- [x] 加自查 checklist：写完 contract 前 grep PRD keys vs contract keys 字面相等
- [x] 任何漂移源诊断必须用 cecelia-harness-debug Layer 4/5（先看 SKILL 协议然后看 SKILL 内容）

## 修复

proposer SKILL.md v7.4 → v7.5：
- 加"## 死规则"段在 Step 2 verifications 段前
- 4 类对照表 + 自查 checklist
- 实证 W25 Bug 8 跟踪记录

## 验收

派 W26 验：
- 期望：proposer contract response key 字面 = PRD response key
- 期望：generator 严守 contract → 跟 PRD 一致 → final_evaluate PASS → task=completed

## 跟 PR E 关系

PR E 修了 generator 漂移（5/5 历史 W 任务）。PR G（本 PR）修了 proposer 漂移（W25 暴露）。两层漂移都堵后，工厂应该能产出严守 PRD 的代码。
