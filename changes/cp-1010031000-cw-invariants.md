## Brain {VERSION} — coding harness：铁律加载进需求与合同，逐条交代覆盖或不适用

- 决策 a1fdbc51 审计 P1 #3（对应旧 harness「Invariant 加载进合同，每条要么有断言要么写明 N/A」）：intent 拉 Brain 全部 active 铁律（decisions category=invariant）写 `01-invariants.md`（每条 `### INV-<id 前 8 位>`，拉取失败 retryable invariants_unavailable，不当作没有铁律）。
- spec 必须在 02 的 `## 铁律对照` 里对相关铁律逐条交代：引用已有 S-n/Q-n 覆盖，或「不适用：理由」；一条都不相关写「无相关铁律：理由」。程序校验（lib/invariants.mjs invariantErrors，spec 与合同对抗改写后共用）：段缺失、引用不存在的铁律、引用不存在的 S/Q、不适用无理由都判 spec_invalid。旧 sprint（无清单文件）不要求。
- 合同对抗 QA 拿到铁律清单，新增第五类问题「违反铁律」（含漏选相关铁律、不适用理由站不住）。
- 生产实测：170 条铁律，清单约 4.5 万字。
