# Learning: MAX_CONTRACT_ROUNDS 截断破坏 GAN 对抗的核心意义

## 根本原因

在 PR #1983 中错误地给 contract GAN 对抗加了 3 轮上限（MAX_CONTRACT_ROUNDS = 3）。
Harness 的 GAN 对抗设计本意是：Evaluator 持续挑战 Generator，直到合同真正满足质量标准（APPROVED）。
人为截断意味着合同可能还未通过就强推 Generator 写代码，产出质量无保证。

## 下次预防

- [ ] GAN 对抗循环永远不加轮次上限，对抗停止的唯一条件是 Evaluator 返回 APPROVED
- [ ] 如果对抗卡死需要干预，走人工介入（手动 approve），不在代码里硬截断
- [ ] Evaluator 的 REVISION 反馈如果写得越来越严苛（超出 PRD 范围），才是真正需要人工判断的情况
