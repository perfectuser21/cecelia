## harness-gan contract.md fallback（2026-06-02）

### 根本原因

`defaultReadContractFile` candidates 只有 `contract-draft.md` 和 `sprint-contract.md`，未包含 `contract.md`。Proposer agent 有时写 `contract.md`（文件内容完全有效，仅文件名不符合约定），GAN 循环找不到合同文件 → 无限重试 → 容器 OOM → task canceled。

### 下次预防

- [ ] harness-gan.graph.js 的 `defaultReadContractFile` 现已包含 `contract.md` 作为第三候选（优先级最低兜底）
- [ ] 遇到 GAN 循环 OOM 重启时，先检查 `sprints/` 下的合同文件名是否符合 `contract-draft.md` 约定，再重启任务
- [ ] Proposer skill SKILL.md 已明确写 `contract-draft.md`，但 agent 可能混淆；框架侧加兜底比要求 agent 100% 遵守更可靠
