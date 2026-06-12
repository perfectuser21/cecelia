# Learning — 裁判证据供给 + evaluate 重入幂等（#3372 配套缺口）

## 教训

裁判判得准不准取决于证据供给——三权分立里**摄像头不能只拍结论要拍过程**。#3372 的裁判机制本身
正确（今晚 run 01f31f66 判 FAIL 完全对），但运动员（evaluator agent）只把"结论"留在
`.brain-result.json`（log_excerpt=null），而 callback 又只回传 stdout 文件 last 4KB tail，
裁判拿到的"录像"只有运动员一句"CI 全绿 42 检查通过"，没有任何步骤的实际命令行 stdout/stderr。
独立裁判巧妇难为无米之炊，只能保守判 FAIL → fix loop 空烧到 r5。新机制上线必须同时把"证据通道"
铺好，否则裁判越严越烧轮。

## 根本原因

1. **证据供给缺口**：evaluateContractNode 传给 runJudgeGate 的 evidence 只含 callback 的 `stdout`
   （entrypoint.sh `tail -c 4000` 的 4KB 尾巴）+ `.brain-result.json`。evaluator agent 的**完整**
   stdout 转录（#3345 命名协议落在 `<promptDir>/<TASK_ID>.<runInstance>.stdout`）从没被读进证据。
   裁判 prompt 也未声明"含命令 stdout 即视为执行证据"，倾向于要求运动员逐行复述。
2. **evaluate 重入产多容器**：LangGraph `interrupt()` 的语义是 resume 时节点**从头重跑**，而 spawn
   写在 interrupt 之前——每次 resume 都再 spawn 一个新 evaluator 容器（containerId 带随机后缀，
   thread_lookup 也不去重）。裁判额外 ~6s 拉长了 evaluate 回调窗口，放大了并发 resume 同时重 spawn
   （实证 evaluate-ws1-r4 同时 4 个容器，每个 ~$5-7）。

## 修复

- collectEvidence 据 `promptDir`+`taskId`（按 taskId 前缀 + 最新 mtime）定位 forensics 完整 stdout，
  读全文（`extractAgentTranscript` 解 `--output-format json` 取 `.result`，NDJSON/文本原样）填入
  `agentStdout`；forensics 缺失 fail-open 退回 callback transcript。finalizeEvaluation 经 getHostPromptDir
  透传 promptDir/taskId。
- 裁判 prompt 增"含命令 stdout 即视为执行证据，不要求逐行复述"，保留"证据确实缺失 → FAIL"红线。
- evaluate spawn 前 `findLiveEvaluateContainer`（docker ps name 前缀 `harness-evaluate-<safeId>-r<round>-`）
  查同 (task, fix_round) 活容器，命中则复用 containerId、跳过 spawn + thread_lookup INSERT，直接进 interrupt。
- evaluator SKILL 让 agent 把关键命令输出留在 stdout = 另立 Notion Issue（不在本 repo，本 PR 不改 skill）。

## 下次预防

- [ ] 新增"独立裁判/复核"机制时，先确认它的**证据输入是过程而非结论**（命令 stdout/stderr/退出码），
      证据通道与裁判逻辑必须同一个 PR 落地
- [ ] 任何写在 LangGraph `interrupt()` **之前**的副作用（spawn/INSERT/外部调用）默认会在 resume 时重跑，
      必须加幂等门（已存在则复用/跳过），不能假设节点只执行一次
- [ ] 回调窗口被拉长（加裁判/加网络调用）时，主动复查依赖该窗口的并发/重入防护是否被放大击穿
