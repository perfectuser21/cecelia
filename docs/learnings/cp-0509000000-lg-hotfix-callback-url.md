# cp-0509000000-lg-hotfix-callback-url

**日期**: 2026-05-09
**触发**: W8 v8 acceptance task 跑到 sub_task fanout，spawn 容器跑通 + 生成 PR #2848，但 callback POST 路径不对，graph 永远等

## 现象

Layer 3 + Stream 1+5 + 2 hotfix 部署后，W8 v8 推过 7 节点（prep / planner / parsePrd / ganLoop / inferTaskPlan / dbUpsert / pick_sub_task）。

sub_task 容器 `harness-task-ws1-r0-28577e72` Up 7 分钟 healthy → claude CLI 真跑通：
- 46 turns
- $2.66
- 输出 `{"verdict":"DONE","pr_url":"https://github.com/perfectuser21/cecelia/pull/2848"}`
- exit=0

但 graph 卡 await_callback 永远等。container 退出了，brain 没收到 callback。

## 根本原因

**entrypoint.sh 用 `HOSTNAME` 作 containerId 拼 callback URL，但 docker 默认 HOSTNAME = container 自动生成的 hex ID（如 `aa4f313ea4a6`），**不是** `--name`（如 `harness-task-ws1-r0-28577e72`）。**

thread_lookup 表存的是 `--name`，callback router 用 URL path 段查表：
- entrypoint.sh POST: `/api/brain/harness/callback/aa4f313ea4a6`
- thread_lookup 含: `harness-task-ws1-r0-28577e72`
- → 404，graph 永远等

Layer 3 spawnNode 已经在 env 里传了 `HARNESS_CALLBACK_URL` 含完整 URL（用 finalContainerId = --name），但 Stream 1 entrypoint.sh **没用这个 env**，自己用 HOSTNAME 拼。

## 修复

entrypoint.sh 优先用 `HARNESS_CALLBACK_URL` env，缺失才 fallback 到 HOSTNAME 拼。

```bash
TARGET_URL="${HARNESS_CALLBACK_URL:-}"
if [[ -z "$TARGET_URL" ]]; then
  CONTAINER_ID="${HOSTNAME:-$(cat /etc/hostname 2>/dev/null || echo unknown)}"
  TARGET_URL="http://host.docker.internal:5221/api/brain/harness/callback/${CONTAINER_ID}"
fi
curl -X POST "$TARGET_URL" ...
```

## 下次预防

- [ ] **callback URL 应由 spawn 端注入**（caller 知道自己用了什么 --name），不该让 callee 自己猜
- [ ] **任何 docker --name vs HOSTNAME 假设都要测**：spawn 端如不显式 `--hostname`，docker 自动生成 hex ID
- [ ] **smoke 应该真发一个 callback POST 验证 lookup 命中**（而不只是 grep 部署）

## 关联

- Stream 1 PR #2841: callback router endpoint
- Stream 5 PR #2844: walking skeleton 实证（用 `--hostname` 跟 --name 同名规避此问题）
- Layer 3 PR #2845: spawnNode 重构（已传 HARNESS_CALLBACK_URL env，但 entrypoint.sh 没读）
- 本 hotfix: entrypoint.sh 真用 HARNESS_CALLBACK_URL
