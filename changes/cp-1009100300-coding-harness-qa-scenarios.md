## Brain {VERSION} — coding harness 规格必须带用户视角 QA 场景 Q-n

- evaluator 真人 QA 的测试计划来源（决策 02d8e749）：02-spec.md 在规格 S-n 之后必须有 `## QA 场景`，每个 `### Q-n` 写 对应（I-n）/前提/操作（真人操作步骤）/期望（用户可见结果）；每个 I-n 至少一条 Q-n；单元测试不算 QA 场景。
- lib/spec-check.mjs 新增 qaScenarios 解析与校验（qa_missing / qa_not_covered:I-n / Q-n:covers_missing|steps_missing|expect_missing|covers_unknown），spec 活动与合同对抗改写共用；不合格同样 retryable spec_invalid。
- 合同对抗 QA 的问题可针对 Q-n；「可验证」维度改为看 Q-n 能否在真实环境从用户视角验证。
- md-chain 覆盖只计条目锚点（01 的 I-n、02 的 S-n），02 里的 Q-n 不要求 03 覆盖。
