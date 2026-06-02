## GAN proposer 没 push 时吞错误空转 23 轮（2026-06-02）

### 根本原因

harness-gan.graph.js proposer 节点用 `.catch` 吞掉 verifyProposer 的 "proposer_didnt_push" 错误，只打 warning 后照常返回旧合同。当 proposer 因账号 429/报错没产出没 push 分支时，GAN 拿旧合同交给 reviewer → REVISION → 再空转，实证空转 23 轮把 account2 烧穿到 429。

这不是 skill 问题（proposer skill 只是提示词，账号 429 它也跑不出东西），也不是 reviewer 挑刺——是编排代码"决定重试还是中止"的判断错误。

### 下次预防

- [ ] 编排代码里凡 `.catch` 吞错误必须问：吞了之后是否还能空转死循环？能则必须计数+中止
- [ ] proposer/generator 等"产出型"节点失败（没产出）要和"产出了但质量不达标"区分——前者重试无意义，应快速带原因中止
- [ ] 中止信号要带可诊断的根因（如"连续没 push，疑似账号限流"），而不是默默循环耗资源
- [ ] 尊重"GAN 无硬轮数上限"设计：用 streak（push 成功清零）而非绝对轮数 cap，真在对抗的 GAN 不受影响
