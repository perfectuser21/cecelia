# Sprint PRD — 裁判证据供给 + evaluate 重入幂等

## 背景

#3372 上线的独立验收裁判（harness-judge.js runJudgeGate）机制本身正确工作——今晚 run `01f31f66`
实证裁判判 FAIL 完全正确。但暴露两个配套缺口：

- **A（证据供给）**：evaluator agent 跑完只在 `.brain-result.json` 写结论（verdict=PASS, log_excerpt=null），
  callback 只回传 stdout 文件 **last 4KB**（entrypoint.sh `tail -c 4000`）。裁判取证 `judge-*.json` 原话：
  "transcript 仅包含运动员自述'CI 全绿 42 检查通过'，无任何步骤的实际命令行 stdout/stderr 片段"。
  裁判巧妇难为无米之炊只能保守判 FAIL → fix loop 烧轮（实测到 r5）。
- **B（重入产多容器）**：LangGraph `interrupt()` 重入让 evaluate 节点从头重跑，spawn 在 interrupt 之前
  → 每次 resume 都再 spawn 一个 evaluator 容器（实证 evaluate-ws1-r4 同时 4 个）。裁判加的 ~6s 拉长了
  evaluate 回调窗口，放大了已知的并发 resume 重 spawn 问题。

## 改动

1. **Brain 侧把 evaluator 完整 stdout 转录喂裁判**：collectEvidence 据 `promptDir`+`taskId` 定位 #3345
   forensics 文件（`<promptDir>/<TASK_ID>.<runInstance>.stdout`，按 taskId 前缀 + 最新 mtime），读全文
   （胜过 callback 4KB tail）填入证据 `agentStdout`。forensics 缺失 → fail-open 退回 callback transcript。
2. **裁判 prompt 防过严**：声明「若 transcript/stdout 含命令 stdout 即视为执行证据，不要求运动员逐行复述」，
   同时保留「证据确实缺失 → 判 FAIL」红线。
3. **evaluate 重入幂等**：spawn 前查同 (task, fix_round) 是否已有活 evaluate 容器（`docker ps` name 前缀），
   有则复用其 containerId、跳过 spawn + thread_lookup INSERT，直接进 interrupt 等回调。
4. **遗留**：evaluator SKILL（zenithjoy-skills，不在本 repo）后续要求 agent 把关键命令输出留在 stdout
   ——作为 Notion Issue 记录，本 PR 不改 skill，只确保 Brain 侧把已有的 agent stdout 转录喂给裁判。

## Golden Path

1. evaluator agent 跑完写 `.brain-result.json`（verdict）+ tee 完整 stdout 到 forensics 文件
2. Brain finalizeEvaluation 据 promptDir/taskId 读 forensics 完整 stdout，连同 .brain-result.json + 合同 + Golden Path 交裁判
3. 裁判据完整证据判读：含命令 stdout 即视为执行证据，证据缺失才判 FAIL
4. evaluate 重入时复用活容器，不再起多个 evaluator 容器

## 成功标准

- 裁判证据输入含 evaluator 完整 stdout 转录（agentStdout），不再只有 callback 4KB tail
- forensics 文件缺失时 fail-open，裁判仍能用 callback transcript 运行，不卡死流水线
- 裁判 prompt 接受命令 stdout 为执行证据，避免对已执行步骤过严误判 FAIL
- evaluate 节点同 (task, fix_round) 第二次进入不重 spawn evaluator 容器
- 全量 workflow 回归（#3372 judge / #3340 / #3335 / #3364 等）不破坏
