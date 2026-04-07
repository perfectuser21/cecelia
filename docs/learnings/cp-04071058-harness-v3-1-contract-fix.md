# Learning: Harness v3.1 — 对照论文原文修正

## 根本原因

没有实际读论文原文，凭猜测实现了两次，两次都错：
- v3.0 把 contract 协商阶段（真正的 GAN 对抗）完全删掉了
- v3.0 把验证命令错误地放到了 Planner，论文里 Planner 只写高层 spec

## 正确理解（对照 https://www.anthropic.com/engineering/harness-design-long-running-apps）

- GAN 对抗 = Generator 提合同草案 ↔ Evaluator 挑战（多轮，直到 APPROVED）
- Planner = 高层产品 spec，不含技术细节，不含验证命令
- 验证命令 = Generator 在合同草案中提出，根据任务类型自选（广谱：curl/npm/psql/playwright）
- Evaluator 执行阶段 = 无脑机械执行合同命令，看 exit code

## 下次预防

- [ ] 不确定官方设计时，先 WebFetch 原文，不猜测
- [ ] memory 文件里的"官方设计"如果是自己写的（而非对照原文），要标注"未验证"
- [ ] 每次修改 harness 前先读 harness-v3-design.md memory，确认对齐
