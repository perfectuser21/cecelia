## 24h 任务失败根因（Round 5）— 反馈循环第 8 次 · STOP 页

**诊断时间**：2026-05-12T07:44Z
**触发任务**：`64cf5d75`（[SelfDrive] 诊断24h任务失败原因）
**前序**：Round 1 / 2 / 3 / 4（同目录）

> **这一页存在的唯一目的：把 Round 4 的 Stop-Diag 建议升级为既成事实，并把"不再开 Round 6"写在仓库里。**
> Round 4（5/12T02:05Z）已经给出完整根因谱和行动项。本任务是 Round 4 写出后 5.6h 又被 self_drive 派发的第 8 次同 intent，是 bug 本身，不是诊断需求。

---

### 1. 自 Round 4 后 5.6h 的实测 Δ

| 维度 | Round 4（02:05Z）| Round 5（07:44Z）| Δ |
|------|------------------|------------------|----|
| 24h failed | 16 | **4** | -12（窗口前推；旧任务掉出，分子未真增）|
| 24h completed | 3 | **0** | -3（同窗口效应）|
| in_progress | 2（卡 13h）| **2（仍卡 13h）** | id 已换：64cf5d75（本任务）+ c001a441（W35 harness）|
| queued | 0 | **0** | 持平 |
| Round 4 后真实 task dispatch | — | **0** | 5.6h 内 0 条 task 被派给 agent（`/dispatch/recent` 30 条全是 `task_id=null` 的 workflow_runtime_v2 内部 tick）|

**派发流停摆从 13h → 18.6h 持续恶化**。最近一次真派发仍是 5/11T13:02:59Z 的 `64cf5d75`，距今 **18.6h，0 新派发**。

---

### 2. 本轮 4 条 failed 的根因（24h 滚动窗）

| # | task | task_type | error_message | 根因层 |
|---|------|-----------|---------------|--------|
| 1 | `10005668` Insight execution-callback | dev | `[reaper] zombie idle >60min` | 基础设施（Gap G2 复现）|
| 2 | `80c17f80` Insight-to-Action 唯一修复路径 | dev | `[reaper] zombie idle >60min` | 同上 |
| 3 | `fc59c8bc` W34 WS P1 happy path | harness_initiative | `tx: duplicate key value violates unique constraint "initiative_contracts_initiat..."` | **新增 G6**：harness 重跑同 initiative 时 contract 唯一约束未做 upsert |
| 4 | `ed20a544` W33 trivial spec | harness_initiative | `final_e2e_verdict=FAIL: Step 1 Golden Path GET /ping schema` | walking-skeleton P1 spec 自身（沿用 Round 4 #2）|

**Round 5 唯一新事实 = Gap G6（harness 唯一约束）**，其余三条都是 Round 1-4 已记录过的根因继续复发。

---

### 3. 第 8 次同 intent — 把数据钉在墙上

24h 内 self_drive 派的 7 条"诊断 24h 失败"任务（Round 1-4）+ 本任务 `64cf5d75` = **第 8 次**。

**Round 4 §5 三条建议 5.6h 后落地状态**：

| Round 4 建议 | 落地 | 证据 |
|---|---|---|
| ① Stop-Diag：人工 disable self_drive 诊断 intent 24h | ❌ 未做 | 第 8 次派发已发生（本任务）|
| ② ops Brain 进程级排查（Act-A/B）| ❌ 未做 | 5.6h 内 0 新 task dispatch，派发流停摆 18.6h |
| ③ 落地 Fix-2/Fix-7（callback 回 finished_at + error_message）| ❌ 未做 | 4 条新 failed 中 2 条仍是 `[reaper] zombie` 兜底文案 |

---

### 4. 给主理人 / ops 的唯一一句话

**不要合 Round 5、不要派 Round 6**。继续写诊断文档只是给反馈循环加燃料。先做这两件 5 分钟内能完成的事：

```bash
# A. 立即关 self_drive 诊断主题 intent（任选一种）
#   方式 1：DB
psql -d cecelia -c "UPDATE self_drive_intents SET enabled = false
                    WHERE intent_key LIKE '%诊断%' OR intent_key LIKE '%failure_rca%';"
#   方式 2：进程级，重启前置 ENV
echo 'SELF_DRIVE_DIAG_DISABLED=1' >> packages/brain/.env && systemctl restart cecelia-brain

# B. 把 64cf5d75 手工置 failed 并写真实 error_message，截断本任务的 zombie 路径
curl -X PATCH "http://38.23.47.81:5221/api/brain/tasks/64cf5d75-..." \
  -H "Content-Type: application/json" \
  -d '{"status":"failed","error_message":"[manual] Round 5 stop-diag — duplicate intent, see docs/diagnostics/24h-failure-rca-20260512-round5.md"}'
```

完成 A+B 之后再回头看 Act-A/B（dispatcher 为什么 18.6h 不派 task）。**那才是这次 RCA 真正的待办**，而不是再写一份 Round 6。

---

### 5. 数据查询（如需复核）

```bash
REMOTE=http://38.23.47.81:5221

# 当前 in_progress 列表
curl -sS "$REMOTE/api/brain/tasks?status=in_progress&limit=50" \
  | jq '.[] | {id: .id[0:8], title, started_at}'

# Round 4 后的 task dispatch（应为 0）
curl -sS "$REMOTE/api/brain/dispatch/recent?limit=30" \
  | jq '.events | map(select(.task_id != null)) | length'

# 24h failed
curl -sS "$REMOTE/api/brain/tasks?status=failed&limit=100" \
  | jq '[.[] | select(.updated_at >= "2026-05-11T12:00Z")] | length'
```
