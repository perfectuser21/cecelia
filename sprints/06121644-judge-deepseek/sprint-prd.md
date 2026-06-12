---
journey: cecelia-harness-pipeline
target_environment: local_api
---
# Sprint PRD — 独立验收裁判（DeepSeek via ToAPIs）

## 背景

验证架构的灵魂是「运动员-摄像头-裁判」三权分立：
- **运动员**（evaluator agent）：像人类 QA 一样在真实环境亲手执行验证，执行权不被代码取代。
- **摄像头**（证据留痕）：agent 的会话产物（取证 stdout 转录 + .brain-result.json + 合同 E2E 输出）就是证据。
- **裁判**（新增核心）：evaluator 回调后，Brain 把【证据 + 合同 + Golden Path】交给 DeepSeek 独立判读，
  独立产出 verdict + Golden Path 覆盖对照表。运动员说 PASS 但裁判说 FAIL 或覆盖缺步 → 终判 FAIL
  （裁判意见优先，feedback 进 fix loop）。运动员不能给自己发奖牌。

原 PR #3370 把执行权整个交给纯代码执行器——方向被用户否决。本 Sprint 保留 evaluator agent 的人类式
执行权，只在其回调后新增独立裁判复核。

## Golden Path（核心场景）

运维者从 [evaluator agent 亲手执行验证产出 verdict] → 经过 [Brain 收集证据 + 合同 + Golden Path 交 DeepSeek 独立裁判] → 到达 [裁判优先的终判：双 PASS 才 merge，裁判 FAIL/覆盖缺步则打回 fix loop]

具体：
1. evaluator agent 回调后，Brain 收集证据（取证 stdout 转录 + .brain-result.json + 合同 ## E2E 验收段 + sprint-prd Golden Path 段）
2. Brain 调 ToAPIs DeepSeek（deepseek-v4-flash，OpenAI chat/completions 兼容，读 message.content 忽略 reasoning_content）独立产出 verdict + coverage 对照表
3. 代码校验 coverage 覆盖 Golden Path 每步；裁判 FAIL / 覆盖缺步 / 与 agent verdict 冲突 → 终判 FAIL，feedback 进现有 fix loop；双 PASS → 照常 merge
4. 裁判调用失败（网络/超时/限流）→ fail-open 保留 agent verdict + warn；JUDGE_STRICT=1 时 fail-closed
5. 裁判输入输出按运行实例落盘取证（judge-<instance>.json）

## 成功标准

- evaluateContractNode 在 evaluator 回调产出 verdict 后，调用独立 DeepSeek 裁判复核（仅 agent verdict=PASS 时）
- 裁判据【证据 + 合同 E2E + Golden Path】独立产出 verdict + coverage 对照表
- agent PASS 但裁判 FAIL 或 Golden Path 覆盖缺步 → 终判 FAIL，feedback=裁判结构化意见进 fix loop
- agent PASS 且裁判 PASS 且覆盖全 → 照常 merge
- 裁判调用失败默认 fail-open 保留 agent verdict（JUDGE_STRICT=1 改 fail-closed）
- ToAPIs 凭据链路打通：sync-credentials.sh 解析 ToAPIs notesPlain 生成合法 toapis.env，Brain 容器经 env/挂载文件解析
- 真实 DeepSeek 调用返回合法 JSON verdict（本地用真 key 验证通过）
