# Learning — 独立验收裁判（DeepSeek via ToAPIs）judge-rework

## 教训（核心）

验证架构的灵魂是「运动员-摄像头-裁判」三权分立：
- **运动员**（evaluator agent）保留人类式执行权——像人类 QA 一样在真实环境亲手执行验证，执行权绝不被纯代码执行器取代。
- **摄像头**（证据留痕）——agent 的会话产物（取证 stdout 转录 + .brain-result.json + 合同 E2E 输出）自动成为证据。
- **裁判**（独立判读）——evaluator 回调后，Brain 把【证据 + 合同 + Golden Path】交给独立 LLM（DeepSeek）判读，独立产出 verdict + Golden Path 覆盖对照表，裁判意见优先。

运动员不能给自己发奖牌：agent 自报 PASS 不等于真过，必须有独立裁判据证据复核。但裁判也不能取代运动员去执行——把执行权整个交给代码（PR #3370 原方向）会丢掉「人类式真实环境验证」这一层，被用户否决。

### 根本原因

PR #3370 把 evaluator 的执行权整个移交给纯代码执行器（runner.js 跑命令 + judge 读记录），方向性错误：
1. 丢失 evaluator agent 在真实环境的人类式探索/适配能力（很多 E2E 不是一条 bash 能脚本化的）。
2. 把"执行"和"判读"耦合进同一段代码，等于让运动员兼任裁判——失去独立性。

正确解法是三权分立：执行权留给 agent（运动员），新增独立 LLM 裁判（DeepSeek，运动员-摄像头-裁判分离），裁判只读证据不执行，agent 说 PASS 但裁判 FAIL/覆盖缺步 → 终判 FAIL 进 fix loop。

## 关键实现点

- 裁判门 `runJudgeGate` 仅对 agent verdict===PASS 生效（运动员说赢了才需复核；agent FAIL 直接走 fix loop）。
- 证据门：无合同 E2E 段且无 Golden Path 步骤 → 跳过裁判保留 agent verdict（缺独立基准时不凭空否决，也避免误杀无合同的单测/边缘 run）。
- 容错：裁判调用失败默认 **fail-open** 保留 agent verdict（裁判瘫痪不应瘫痪流水线）；`JUDGE_STRICT=1` 改 fail-closed。
- DeepSeek 是 reasoning 模型：读 `choices[0].message.content`，忽略 `reasoning_content`。
- 凭据写在 1Password 条目的 notesPlain（非独立 field）时，同步脚本必须专门解析 notesPlain 的 KEY=VALUE 行（跳过 # 注释 + 跳过含空格的非法变量名标签如 `valid from`）。

### 下次预防

- [ ] 新增「LLM 当裁判」类功能时，先确认是否动了 agent 的执行权——执行（运动员）与判读（裁判）必须分离，不能用代码执行器替掉 agent。
- [ ] 接入任何外部 LLM 裁判/网关，默认 fail-open + 提供 STRICT 开关，绝不让裁判故障阻断主流水线。
- [ ] reasoning 模型一律读 message.content，显式忽略 reasoning_content，避免把思维链当结果解析。
- [ ] 1Password 同步脚本对「凭据写在 Notes」的条目要走 notesPlain 解析，并过滤非法 env 变量名标签（含空格的 field 会污染 .env 导致 source 报错）。
- [ ] 裁判类决策必须代码校验覆盖对照（不信 LLM 文字 verdict）：Golden Path 每步都要有 coverage 且 passed=true，缺步即 FAIL。
