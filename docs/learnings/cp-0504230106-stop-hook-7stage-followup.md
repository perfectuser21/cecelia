# Learning — Stop Hook 7 阶段后续完善（2026-05-04）

分支：cp-0504230106-stop-hook-7stage-followup
版本：Engine 18.20.0 → 18.20.1
前置 PR：#2766 (cp-0504214049-stop-hook-redesign-7stage) — verify_dev_complete P1-P7 已合
本 PR：plan Task 3/5/6 收尾

## 故障

PR #2766 把 verify_dev_complete 重写为 P1-P7 状态机，21 unit case 全过。但 plan Task 3/5/6 因时间紧未实施：
- Task 3 unit case 28 个（缺 P3/P5/P6 7 case）
- Task 5 cleanup.sh 仍含 deploy-local.sh fire-and-forget（25 行）
- Task 6 integration test 不存在；smoke 仅占位骨架（exit 1）

## 根本原因

PR #2766 优先修核心决策树（4 盲区根本解），测试基础设施保留旧版兼容：现有 21 case stub 按 `$1 $2` 分发不区分 `--json` 字段。新 P3/P5/P6 分支没专门 case，被动等"实战触发"验证。stop hook 关键路径需要 mock 完整覆盖。

cleanup.sh 的 deploy-local.sh 残留是历史包袱：早期 stop hook 没 deploy 验证能力，本地 fire-and-forget 是唯一选项。PR #2766 P5 引入 brain-ci-deploy.yml workflow 监听后，本地 deploy 重复且不可观测，但 PR #2766 没顺手清理（scope 已饱和）。

smoke 骨架 `exit 1` 是占位，CI lint-feature-has-smoke 通过文件存在即满足，但本质是"假绿"。

## 本次解法

### Task 3：smart_gh stub
新 helper 解析 `--json` / `--workflow` 字段：
- `gh run list --json status` vs `--json conclusion` vs `--json databaseId`
- `gh run view $id --json jobs`（P3 fail job 抽取）
- `gh run list --workflow brain-ci-deploy.yml`（P5）
- `curl /api/brain/health` mock（HEALTH_PROBE_MOCK=ok|fail）

C22-C28 case 覆盖 P3 (failure/cancelled) + P5 (in_progress/failure) + P6 超时 + 全过 done。C26 SHA 未匹配因 stub 不处理 `-q` jq filter，由 integration test 用真 jq 覆盖。

### Task 5：cleanup.sh 解耦
删 `setsid bash "$DEPLOY_LOCAL_SH" ... &` 25 行，加 5 行注释：deploy 由 brain-ci-deploy.yml workflow 自动触发（push to main），verify_dev_complete P5 监听 conclusion=success。本地 deploy-local.sh 废弃。

### Task 6：integration + smoke
- integration 5 case：smart_gh stub + curl mock 验证 P1→P0 全过 / P3 / P5 / P6 / P7 五个分支。`HEALTH_PROBE_MOCK` env 必须用 subshell `export` 才能传给 mock_curl 子进程（bash `VAR=val func` 不 export 给函数 fork 的子进程）
- smoke 8 step：真起本机 Brain → 真 health probe / dead URL 不挂死 / cleanup 解耦验证 / stop-dev.sh exit 0 三态

## 下次预防

- [ ] 测试基础设施（stub/mock）必须跟核心代码同 PR 提交，不留"等下个 PR 补"的 case
- [ ] 重构（如 P5 替代 deploy-local.sh）必须顺手删旧实现，不留 dead code 17+ 行
- [ ] smoke.sh 占位骨架（exit 1）禁止合并主线 — CI lint-feature-has-smoke 应检查实际有效行数 > N
- [ ] bash `VAR=value func` 给 mock 子进程传 env 必须用 subshell `(export VAR; func)` 形式
- [ ] gh stub 必须模拟 `-q jq filter`（`-q` 在 gh CLI 内部处理，stub 直接 echo JSON 时 verify 拿到的是整数组，而非 jq 抽取后的值）

## 验证证据

- 27 unit case `verify-dev-complete.test.sh` 全过（21 现有 + 6 新；C26 跳由 integration 覆盖）
- 5 integration case `stop-hook-7stage-flow.test.sh` 全过
- 8 smoke step `stop-hook-7stage-smoke.sh` 全过（本机 Brain 健康场景 OK，CI real-env-smoke 真起 docker 验证）
- cleanup.sh `bash -n` OK + 跑无 deploy-local.sh fire-and-forget
- 8 处版本文件 18.20.1

## Stop Hook 完整闭环延续

| 段 | PR | 内容 |
|---|---|---|
| 10 | #2766 | 7 阶段决策树 + monitor-loop guard |
| **10.1** | **本 PR** | **测试基础设施完善 + cleanup 解耦** |
