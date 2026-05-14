# Learning — B18 generator/evaluator 工艺对齐 + 编排 retry

### 根本原因

W37-W39 evaluator 永远判 FAIL 不是 evaluator 业务挑刺，是 **generator 没按合同 manual:bash 自验**：
- generator 用 vitest mock + supertest 跑测试，自检 11/11 PASS
- evaluator 用真 curl + jq -e 跑同样的 contract-dod-ws*.md manual:bash 命令
- 两个 LLM 各自解读合同：字段名/schema/error body 任一处差异 evaluator 都 FAIL
- generator 不知道 evaluator 真期望啥字面，fix loop 永不收敛

另：W39 round 3 generator container exit_code=1（claude code 自身瞬断），await_callback 把这种当 fatal error → state.error → graph END。其实应该跟 ci_fail 同等：retry。

### 下次预防

- [ ] 任何 LLM-vs-LLM 对抗式审查（GAN/proposer-reviewer/generator-evaluator）必须共享"基线验证"（合同里写的 deterministic 命令），不能各自解读合同
- [ ] generator/evaluator 协议：generator 自验工具 ≡ evaluator 同款验证工具（不能 mock vs real 双标）
- [ ] graph await_callback exit_code≠0 不一定是 fatal — 区分 docker daemon 死（true fatal）vs container 内业务 fail（应 retry）
- [ ] fix loop 不应硬 cap round 数 — convergence 不是数轮次，是 verdict 真 PASS（W37 实证 cap=3 太严）
