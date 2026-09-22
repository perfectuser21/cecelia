# 秋米任务切换 Runbook（旧 cron → Brain 统一调度 + Jev 路由）

切的是什么：秋米中文 GTD 表的任务，从 us-vps crontab 上的 `notion-qiumi-delegate.py` 自派发，
改成 Brain 入账（PR2）→ Jev 路由（PR3）→ 设备任务转 `device_job` / 非设备任务经 ssh 起 `openclaw agent`。

脚本：`packages/brain/scripts/ops/qiumi-cutover.sh`（幂等四步，`--step=N` 可单跑）
在途检查：`packages/brain/scripts/ops/qiumi-inflight-check.mjs`
回归 smoke：`packages/brain/scripts/smoke/qiumi-routing-smoke.sh`（cecelia_test 五闸）

---

## 0. 前置

| 项 | 值 |
| --- | --- |
| 执行位置 | 本机（MMV），脚本自己 `ssh us-vps`；**不要登到 us-vps 上跑**（零执行铁律 96054a8b） |
| 同机要求 | **step1–4 必须在同一台机器上执行**。step1 的 SINCE、step2 的清零凭据都落在本机 `$CUTOVER_STATE_DIR`（默认 `~/.cache/qiumi-cutover`），换机执行会因为找不到凭据退 6/7。影子跑到正式切换可能隔一天，中途换人换机就会撞上 |
| `NOTION_TOKEN` | `source ~/.credentials/sync-credentials.sh && source ~/.credentials/notion.env`；或 1Password：`op item get "Notion" --vault CS --format json` |
| `NOTION_GTD_DB_ID` | 不设则用脚本内默认的中文 GTD 库 id |
| `DATABASE_URL` | step4 才需要。生产 = us-vps 的 Brain 库；非 `_test`/`_scratch` 结尾必须加 `--confirm-prod` |
| `BRAIN_ENV_FILE` | 默认 `/opt/cecelia/.env`，与实际部署不符时用 env 覆盖 |

---

## 1. 影子跑一轮（先观察 24h，别直接切）

目的：在**不派发**的前提下，验证入账这半条链是对的。

> **影子跑不是并跑。** 开同步之前，旧 cron 必须已经停。
>
> 并存期防双认领没有第二条防线：Notion 侧没有条件写，谁先看到委派行谁就认领。
> 真正挡住双认领的只有「开关默认关 + SINCE 缺失 fail-closed」这一条——
> （**依赖 PR2 = #5502 的终版**：从它的审查修复那一轮起，SINCE 缺失/非法会直接不起
> 同步循环（`reason:'missing_since'`）。更早的 PR2 中间版本缺 SINCE 会自钉当下，
> 这条防线在那上面是不成立的——所以本 runbook 只对合并后的 PR2 成立。）
> 一旦 us-vps 的每 3 分钟一轮 cron 与 Brain 同步循环同时开着，SINCE 之后新建的委派行
> 两边都能领走，`headed_manual` 只管 Brain 侧派不派，管不住旧脚本去认领。
>
> 所以影子跑的正确开法是：先 `--step=1`（停旧 cron）+ `--step=2`（等在途清零），
> 再开 `QIUMI_SYNC_ENABLED`。`--step=3` 自己也会回 us-vps 验一遍旧 cron 是否真退役，
> 没退役直接退 6。

1. 先停旧 cron 并等在途清零：

   ```bash
   cd packages/brain
   bash scripts/ops/qiumi-cutover.sh --step=1
   NOTION_TOKEN="$NOTION_TOKEN" bash scripts/ops/qiumi-cutover.sh --step=2
   ```

   `--step=1` 会在停 cron 那一刻把 SINCE 取好，**当场写进 us-vps 的 `.env`**，同时落一份到本机
   `~/.cache/qiumi-cutover/since`（路径可用 `CUTOVER_STATE_DIR` 覆盖）。
   `--step=2` 在在途清零时再落一份 `inflight_cleared_at` 作为凭据。
   **下一步要用的就是 `since` 里这个值，不要另外现取一个时刻。**

2. us-vps 的 Brain env 里只打开同步，派发保持关闭：

   ```bash
   cat ~/.cache/qiumi-cutover/since     # ← SINCE 就用这个值，别手敲「现在」
   ```

   ```
   QIUMI_SYNC_ENABLED=true
   QIUMI_DISPATCH_ENABLED=false
   QIUMI_SYNC_SINCE=<上面那条命令打印出来的 ISO 时刻>
   ```

   影子跑阶段手写这三行（不要跑 `--step=3`，那一步会把 `QIUMI_DISPATCH_ENABLED` 也开成 true）。

   **SINCE 必须等于旧 cron 停下那一刻**，不是你写 env 的那一刻。两者之间隔着等在途清零
   （最长 30min）和重建容器：这段时间里新建的委派行，旧脚本已经不管了，而 Brain 侧的
   `created_time on_or_after SINCE` 又会把它们挡在外面——两边都不收，永久丢失。

   这里定下的 SINCE 就是最终的 SINCE，正式切换时不要再改（理由见下节）。

3. **重建 Brain 容器**（learning cp-0916213853：改 env 不重建等于没改）。
4. 观察 24h，逐条对：

   | 看什么 | 怎么看 |
   | --- | --- |
   | 入账正确 | `SELECT count(*) FROM tasks WHERE task_type='qiumi_task' AND created_at > <since>` 与中文表新增行数对得上 |
   | 无双认领 | 中文表「OpenClaw任务号」列里，同一行不应既有 `brain:` 又被旧脚本改写；抽查 10 行 |
   | 闸真的关着 | 上述任务应全部 `status='queued'` 且 `payload->>'headed_manual'='true'`，没有一条被 tick 领走 |
   | 正文抓全了 | 抽查 3 条 `payload->'qiumi_source'->>'body'` 与 Notion 页面正文一致 |

影子跑不通过就停在这里，不要进第 2 节。

---

## 2. 正式切换（四步）

```bash
cd packages/brain
# 全跑（step3 之后会停下来等你重建容器，见下）
DATABASE_URL='<生产库 URL>' NOTION_TOKEN="$NOTION_TOKEN" \
  bash scripts/ops/qiumi-cutover.sh --confirm-prod
```

推荐分两段跑，因为第 3 步和第 4 步中间夹着一个人工动作：

```bash
bash scripts/ops/qiumi-cutover.sh --step=1     # 旧 cron 注释掉
bash scripts/ops/qiumi-cutover.sh --step=2     # 等在途清零（最长 30min）
bash scripts/ops/qiumi-cutover.sh --step=3     # 验旧 cron 已退役 → 写开关
# ↑ 到这里手动重建 Brain 容器，确认新 env 已经进程内生效
DATABASE_URL='<生产库 URL>' bash scripts/ops/qiumi-cutover.sh --step=4 --confirm-prod
```

做过影子跑的话，step1/step2 当时已经跑过，这里再跑一遍也无妨（两步都幂等，
cron 不会被叠第二层注释，在途早就是 0）。step3 会保留影子跑写下的 SINCE，只把
`QIUMI_DISPATCH_ENABLED` 从 false 翻成 true。

各步在做什么、失败怎么读：

| step | 动作 | 非零退出 |
| --- | --- | --- |
| 1 | 给 crontab 里 `notion-qiumi-delegate.py` 行加 `#[retired-qiumi-cutover] ` 前缀 | `5` = 还有没注释掉的行；us-vps 没有 crontab 会跳过 |
| 2 | 每 30s 查一次中文表在途，最长 30min；清零时落 `inflight_cleared_at` 凭据 | `3` = 超时仍有在途；`1` = 检查本身坏了（查不到不等于清零，必须先修） |
| 3 | 验旧 cron 已退役 + 验在途清零凭据，再往 `BRAIN_ENV_FILE` 幂等写开关 | `6` = 旧 cron 还活着，**或**找不到 `inflight_cleared_at`（跳过了 step2）；`7` = 找不到 `$CUTOVER_STATE_DIR/since`；ssh 失败即非零 |
| 4 | 存量 queued 任务去掉 `payload.headed_manual` + 排程台账改写 | `4` = 目标库不是测试库且没给 `--confirm-prod` |

step3 那道 `6` 号闸就是本 runbook 第 1 节那条硬要求的机械化：停旧 cron 必须先于打开
`QIUMI_SYNC_ENABLED`，脚本自己回 us-vps 验，不靠执行的人记得住。
它同时验 step2 的清零凭据——只验 cron 挡不住「跑了 step1、跳过 step2 直接 step3」：
那时旧脚本手上那批活还在跑，开关却已经开了。

### QIUMI_SYNC_SINCE 的规矩

**SINCE 在 step1 停 cron 那一刻取，只写一次，之后谁也不动它。**

step1 取到那一刻就**当场写进远端 `.env`**，并落一份到本机 `$CUTOVER_STATE_DIR/since`
（默认 `~/.cache/qiumi-cutover/since`）。本机那份是副本，不是真身——中间还隔着等在途
（最长 30min）和重建容器，值只留在本机越久越容易被「重跑一下 step3」冲掉。
step3 只做兜底保持：文件不在就退 7 要求先跑 step1，自己一秒钟都不重新取。
重跑 step1 也不会把它推后——已有值就保持不动。

step3 对两个布尔开关是覆盖写，对 `QIUMI_SYNC_SINCE` 是「缺了才写」：
远端 env 里已经有值（比如影子跑时写的那个）就原样保留，日志会打「已存在，保持不动」。

为什么不能动：往后推，中间那段时间的新行就永远拉不到了；往前调，旧脚本已经处理完的
历史行会被重新入一遍账。所以重启容器、重跑 step3、回滚后再切，都不会改到 SINCE。

确实要补拉某段时间时，手工改这一个值，并事先确认那段区间不会重复入账。

---

## 3. 切换后观察

```sql
-- 路由决策在落
SELECT event_type, count(*) FROM task_events
 WHERE created_at > now() - interval '1 hour'
   AND event_type LIKE 'qiumi%' OR event_type LIKE 'openclaw_agent%'
 GROUP BY 1 ORDER BY 2 DESC;

-- 设备任务真的派生出去了（父 qiumi_task 挂起 + 子 device_job 在队列里）
SELECT p.id AS parent_id, p.status AS parent_status, p.blocked_reason,
       c.id AS device_task_id, c.task_type, c.status AS device_status,
       c.assigned_to, c.payload->>'serial' AS serial
  FROM tasks p
  JOIN tasks c ON c.id = (p.payload->>'device_task_id')::uuid
 WHERE p.task_type = 'qiumi_task' AND p.payload ? 'device_task_id'
 ORDER BY p.updated_at DESC LIMIT 10;

-- fail-closed 的量（device_uncertain 多 = 便宜闸关键词该补了，不是模型坏了）
SELECT error_message, count(*) FROM tasks
 WHERE task_type='qiumi_task' AND status='failed' AND updated_at > now() - interval '1 day'
 GROUP BY 1 ORDER BY 2 DESC;
```

中文表侧：抽查任务从「进行中」被回写成完成态的行，确认 `OpenClaw任务号` 是 `brain:` 前缀。

**第一条设备任务必须人工盯一眼**：确认它真的派生出了一条 `device_job` 子任务，
且父任务挂在 `blocked / delegated_device_job`。判据见下节。

---

## 4. 设备任务是子任务，不是同一行改类型

秋米任务被判成"要碰真机"时，**不会就地改成 `device_job`**，而是派生一条子任务：

- **子任务**：`task_type='device_job'`、`assigned_to='phone-<序列号>'`、`executor_kind='headed-session'`、
  `payload` 带 `serial` / `source='oneoff'` / `headed_manual=true` / `parent_task_id`。手机领单器领的是它。
- **父任务**：原 `qiumi_task` 行原地挂起——`status='blocked'`、`blocked_reason='delegated_device_job'`、
  `payload.device_task_id` 指向子任务。**中文表里这行显示「进行中 + [等待中: delegated_device_job]」**。
- 子任务跑完（`completed` / `completed_no_pr`）→ 60s 一轮的 `qiumi-device-reconcile` job 把父任务
  结成 `completed_no_pr`，`result.receipt` 里记着子任务 id 与结论；子任务 `failed`/`cancelled` →
  父任务 `failed`，`error_message='device_job_<子状态>'`。

**所以排程看板上会多出 `device_job` 行**，一条秋米设备任务 = 看板两行（父 + 子），这是设计如此，不是重复建单。

**为什么不就地改类型**：`tasks` 上有 `work_routing_task_projection_immutable`
（迁移 421，`BEFORE UPDATE OF task_type, payload`）——任务在 `work_routing_receipts` 有回执时，
`NEW.task_type` 与 `receipt.canonical_task_type` 不一致就 `RAISE EXCEPTION`。生产秋米任务全部经
`createRoutedTask` 入账，回执写死 `canonical_task_type='qiumi_task'`，就地改成 `device_job` 必抛
（2026-09-23 在 cecelia_test 实测确认）。回执是真身、任务行是投影，改投影不改真身就是账实分叉，
触发器挡的正是这个。子任务走 `createRoutedTask` 拿自己的回执，`canonical_task_type='device_job'`
与它的 `task_type` 一致，触发器天然放行。设计全文见计划文档「补充五」。

父任务的 `blocked_until` 是 NULL（**故意的**）：自动解闸器只捞到期的行，留 NULL 才不会在子任务跑完前
被抢着放回队列派第二遍。唯一的放行方是对账 job——所以 **`qiumi-device-reconcile` 停了，
父任务就会永远挂着**。查它在不在跑：

```sql
SELECT count(*) FROM tasks
 WHERE task_type='qiumi_task' AND status='blocked'
   AND blocked_reason='delegated_device_job' AND blocked_at < now() - interval '6 hours';
```

非 0 且子任务已终态 = 对账 job 没在跑，去看 Brain 日志里的 `[scheduler-jobs]`。

---

## 5. 回滚

任何一步出问题，按相反顺序退。**复活旧 cron 是最后一步**，前面三步一步都不能省：

```bash
cd packages/brain
# ① 关掉 Brain 侧两个开关：QIUMI_SYNC_ENABLED=false + QIUMI_DISPATCH_ENABLED=false
bash scripts/ops/qiumi-cutover.sh --step=3 --rollback
# ② 重建 Brain 容器（不重建等于没关）
# ③ 存量任务重新上闸——step4 正向把它们的闸永久摘了，不补回去，Brain 照样派
DATABASE_URL='<生产库 URL>' bash scripts/ops/qiumi-cutover.sh --step=4 --rollback --confirm-prod
# ④ 最后才取消旧 cron 的注释，旧脚本复活
ssh us-vps 'T="$(crontab -l)" || exit 1; printf "%s\n" "$T" | sed -E "s|^#\[retired-qiumi-cutover\] ||" | crontab -'
ssh us-vps 'crontab -l | grep notion-qiumi-delegate.py'
```

两个洞，都是「只关派发」挡不住的，所以上面这四步缺一不可：

**① 存量任务的闸被永久摘了。** 正向 step4 把存量行的 `payload.headed_manual` 删掉了——
那是 Brain 侧唯一挡住派发的东西。只关 `QIUMI_DISPATCH_ENABLED` 而不补回闸，
容器重建前后那段窗口里 Brain 照样会派这些活，跟刚复活的旧 cron 撞在同一台真机上。
`--step=4 --rollback` 把 `headed_manual=true` 写回去（范围与正向一致，覆盖
`queued/blocked/paused`；已经有闸的行不动）。

**② 同步也必须关。** 只关派发、留着 `QIUMI_SYNC_ENABLED=true`，就回到了本 runbook 第 1 节
明令禁止的状态：旧 cron 与 Brain 同步循环同时开着，SINCE 之后新建的委派行两边都能认领。
`--step=3 --rollback` 两个开关一起关，且**不验任何前置闸**——那几道闸是防「开早了」的，
拿它们挡住要关闸的人，等于把系统锁在开着的状态里。

顺序反了会怎样：先复活 cron 再关开关，中间那段时间两边都活着，正是要避免的双跑。

排程台账（step4 写的那条）不用回滚——`active` 标志由下一次切换或巡检覆盖，留着不影响调度。

已经被 Brain 派出去的在途任务：等它们自己收尾（`reapOpenclawAgentRuns` 60s 一轮），
不要在回滚时手动改它们的状态，否则两边都以为对方在管。
