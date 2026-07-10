# 小改动 PrepPRD：九要素T3 注入扩容+蒸馏接线

## 改什么
1. `packages/brain/src/harness-line-context.js`
   - PROMPT_MAX_LEN 4000 → 12000
   - MAX_FR_ABILITIES 20 → 50
   - fetchLineContext 新增拉取该 journey 最新 line_ledger（design_docs type='line_ledger'）
   - formatLineContextForPrompt 新增「Line 账本摘要」段（有则注入，单段截断，总长仍受 12000 兜底）
2. `packages/brain/src/routes/warroom.js`
   - 新端点 GET /line/:id/context-manifest
   - 返回：line 本体 + 最新 line_ledger 摘要（content/created_at）+ 增量事实（自 ledger 时刻起的六段切片，复用 line-dreaming buildLineDreamData 参数化 since）+ invariants + 累积 FR（复用 fetchLineContext）
   - journey 不存在 404；各段 best-effort 降级
3. `packages/brain/src/line-dreaming.js`
   - buildLineDreamData 增加可选 since 参数（默认 24h，向后兼容）

## 为什么改
九要素计划 T3（architecture ref: docs/architecture/2026-07-10-nine-elements-integrity/architecture.md）。
T5 dreaming L1 已上线产出 line_ledger，但没有消费方接线；planner Step 0.4 需要一个端点一次拉全上下文；
4000 字符注入上限在铁律+FR 增长后已不够用。

## 关联上下文
- 相关 Journey：bb8cc561-b3ee-4fec-b74d-2255694bd963（九要素完备化）
- Brain task：ac64f425-d7f7-498e-9380-b7064b1796ac（plan_seq=3）
- 设计 PR：#3731；前序 T2 已合并（#3748）

## 影响范围
- 注入变长：proposer/generator/evaluator 三角色 prompt 注入上限扩到 12000（增强，不改解析契约段头）
- warroom 新增只读端点，无破坏性变更
- line-dreaming 签名向后兼容

## 验收标准
- [ ] 单测：formatLineContextForPrompt 12000 上限生效 + ledger 段注入（有 ledger 出段、无 ledger 不出段）
- [ ] 单测：GET /line/:id/context-manifest 返回 ledger+delta+invariants+cumulative_fr；journey 不存在 404
- [ ] CI 全绿
