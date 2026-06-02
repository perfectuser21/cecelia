# GAN 收敛识别 bug — reviewer verdict 没进 brain gate 致无限空转（2026-06-02）

## 背景

harness 验证 run v4（task 975f5d9c）：reviewer 在 Round 3 就 APPROVED（写进 contract-review-feedback.md），
但 GAN 图没退出、空转到 round 6+ 才手动终止。一个简单 GET 端点合同不该这样。

## 根本原因（checkpoint ground truth 实证）

查 PostgresSaver checkpoint_blobs（brain GAN state 的权威记录）：
- `proposeBranch` / `contractContent` 通道：6 个版本有值 → proposer 的 `.brain-result.json` 写读正常
- **`verdict` / `rubricHistory` 通道：全程零 blob** → reviewer 节点每轮算出的 verdict 都是 undefined

即 reviewer 把决定写进了**散文** `contract-review-feedback.md`（`**verdict**: APPROVED`），
但**没把 verdict/rubric_scores 写进 brain 读的 `.brain-result.json`**。reviewer SKILL 用引号 heredoc
`<< 'BREOF'` + 模板占位符（`<APPROVED|REVISION>`、score=`X`），LLM 若没替换占位符就执行 →
写出非法 JSON → `readBrainResult` JSON.parse 抛错 → reviewer 节点 `.catch(()=>({}))` 吞掉 → resultData={}。

于是 `verdict = rubricVerdict || resultData.verdict` 两级皆空 → undefined → `reviewerRouter`
（`state.verdict==='APPROVED'?END:'proposer'`）永远路由回 proposer。叠加 **B52(#3212) 删了强制收敛
兜底阀**（"GAN 无限跑直到 Reviewer 真实 APPROVED"）→ 通道一漏判就无限空转，proposer 漂移成"归档 done"。

## 修复（brain 侧鲁棒化，尊重"无上限收敛"不加轮数硬 cap）

1. **散文降级**：结构化 verdict 缺失（非 APPROVED/REVISION）时，`defaultReadReviewerFeedbackVerdict`
   从 contract-review-feedback.md 正则解析 verdict，恢复 reviewer 真实决定 → GAN 能正常退出。
   rubric 仍是首选权威，散文仅在结构化彻底缺失时兜底（SKILL 自己也把"缺字段降级文字判断"列为预期降级模式）。
2. **防御纵深**：任何来源都拿不到可解析 verdict → `reviewerNoVerdictStreak` 累计，连续 ≥ MAX_NO_VERDICT_STREAK(3)
   即带原因中止 GAN（对称 proposerNoPushStreak / #3229），不再静默当 REVISION 无限空转。
3. `reviewerRouter` 加 `error → END` 路由（之前 reviewer 设 error 仍会被路由回 proposer）。

## 下次预防

- [ ] LLM agent 的关键信号（verdict 等）必须有**结构化通道失败时的兜底来源**，不能单一通道一漏判就死循环。
- [ ] 删"应急阀/兜底/安全网"（如 B52 删强制收敛）前必须确认主通道**绝对可靠**；赌"上游纪律防异常"不成立——上游是 LLM，必然偶发漏写。
- [ ] 任何"节点没产出可用输出"的循环都要有 streak→abort 守卫（对称 proposerNoPushStreak），杜绝静默无限空转烧账号。
- [ ] 调 LLM-agent 图状态用 PostgresSaver checkpoint_blobs 查通道实际值（ground truth），比翻日志/猜测快且准。
- [ ] 待办（本 PR 不含）：reviewer SKILL 占位符 heredoc 应改成强制可靠写 `.brain-result.json`（Layer5 SKILL 硬化，走 [CONFIG]+eval）。
