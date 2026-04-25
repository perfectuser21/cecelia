# RCA — 近 24h 业务失败 + 防护方案

- **生成时间**: 2026-04-25 19:42 UTC
- **触发**: Brain 自调度任务 `ffe743c9-...`（[SelfDrive] [P0-聚焦] 近24h业务失败RCA + 防护方案）
- **观察窗口**: 2026-04-24 19:00Z ~ 2026-04-25 19:00Z
- **数据源**: Brain DB `tasks` 表（`payload.failure_class` / `quarantine_info`），代码: `packages/brain/src/executor.js`、`docker-executor.js`、`Dockerfile`

## 1. 失败清单（按发生时间倒序）

| ID | 标题 | failure_class | quarantine_reason | 重试次数 |
|----|------|----------------|--------------------|----------|
| `8986d509` | fix(spawn): executeInDocker 下沉账号轮换 | task_error | repeated_failure | 3 |
| `b4e92e19` | Brain 容器加 git + openssh-client（Alpine base 缺） | task_error | — | 1 |
| `63eda3e6` | KR 拆解（修复）: KR for project comparison | task_error / process_disappeared | DEDUP_TEST_PLACEHOLDER | 3 |
| `b0cec635` | [SelfDrive] 微信小程序 KR (25%) 深度诊断与加速方案 | liveness_dead | resource_hog | 5 |
| `bb245cb4` | [E2E-v7] Brain GET /api/brain/health 零人为介入验证 | liveness_dead | resource_hog | 3 |

> 题面写"4 个"，实测落库 5 条具备 failure_class 的近 24h 任务。本文按 4 个 RCA 簇组织，第 5 条 `bb245cb4` 与 `b0cec635` 同簇合并分析。

## 2. RCA — 4 个失败簇

### 簇 A：`liveness_dead` × `resource_hog`（b0cec635 / bb245cb4）

**症状**：watchdog 在任务运行中标 `liveness_dead`，多次 kill 后进入 `resource_hog` 隔离。

**代码现场**：
- `executor.js:3346` `probeTaskLiveness()` 双探活：探到进程不在 → 60s 缓冲期 → 二次探活仍不在 → kill。
- `executor.js:966-969` 阈值：`LIVENESS_QUARANTINE_AFTER_KILLS=3`，最小回退 900s（15min）。
- `docker-executor.js:38` `DEFAULT_TIMEOUT_MS=process.env.CECELIA_DOCKER_TIMEOUT_MS || 5400000`（默认 90 min）。

**根因（拆分问题 + 代码问题）**：
1. **decomp 类型任务的 tier.timeoutMs 没有放大**——decomp / 深度诊断属于"长尾型"，但 watchdog 探活粒度按 short-task 设计（60s 缓冲期），多轮 LLM 调用之间的进程空窗触发误判。
2. `b0cec635` 的"深度诊断+加速方案"本身就是含糊指令，LLM 跑出来要数十分钟，期间容器输出停滞被 watchdog 视为 dead。

**已有防护**：队列中已存在 `3f32212a [Harness v6 P1-E] CECELIA_DOCKER_TIMEOUT_MS 默认 90min + 按 task_type 动态` —— **已经规划，待执行**。

### 簇 B：`process_disappeared` 误杀（63eda3e6）

**症状**：`last_run_result.status='success'`、Docker 实际跑完拿到结果，但 Brain 重启后 `syncOrphanTasksOnStartup()` 把它打成 `orphan_detected` → 计入 failure_count。

**代码现场**：
- `executor.js:3487` 启动期扫所有 `status='in_progress'`，靠 `task.id` / `payload.current_run_id` 在 `ps` 里搜命令行。
- `executor.js:3550-3603` `watchdog_retry_count<2` 且无 error → requeue；否则 fail。
- 关键 race：执行容器把结果写回数据库（callback）和 Brain 重启之间存在窗口；若 callback 已写 `last_run_result.status=success` 但 `tasks.status` 仍为 `in_progress`，就会被误判 orphan。

**根因（代码问题 — race condition）**：callback 写入应当**原子化**地更新 `tasks.status`，目前是分两步写（先 `last_run_result`，再 `status`），中间 Brain crash 留下窗口。

**已有防护**：队列中 `4ab9a9e8 [Harness v6 BLOCKER-AC] harness_task 回调链路三联修（writeDockerCallback+pr_url解析+ci_watch创建）` —— **覆盖此根因，待执行**。

补充建议：`syncOrphanTasksOnStartup()` 在标 orphan 前应**优先读 `payload.last_run_result.status`**，若已是 success 直接结案为 completed 而非进入失败计数。

### 簇 C：硬编码账号轮换 失效（8986d509）

**症状**：harness/content-pipeline 早期跑全部走 `account1`，触发限流后无降级路径，watchdog 间接判 dead。

**代码现场**：
- 已修：commit `dae4dc1c4 fix(spawn): 拆 harness/content-pipeline 硬编码 account1`（2026-04-25 早晨合并）将 4 处硬编码 `'account1'` 移除，改由 `docker-executor.js:349 resolveAccount()` 中间件按 `selectBestAccount()` 轮转。

**根因（代码问题，已修复）**：账号选择从**调用方硬编码**改为**executor 中间件下沉**，前期硬编码导致单账号过载触发 5h-cap → 容器内子进程启动失败 → liveness_dead。

**残留风险**：`8986d509` 任务本身是"修复任务"，但因为修了 3 次都没成功 PR，已被标 `repeated_failure` 隔离 —— 表明这个任务条目本身是冗余的，对应 PR 已经在 `dae4dc1c4` 合并完成；**该任务条目应直接 cancel**，不再重试。

### 簇 D：占位测试 KR 反复重试（27cb5268 / 426d7b29 / 3c67abe5 / 8e624e4f / 63eda3e6 part2）

**症状**：标题形如 "KR 拆解: Test KR for select" / "LP Test KR" / "KR for project comparison" 的 5 个占位 KR 反复触发 `decomp` 任务，全部 `failure_count >= 2`，最终被 `DEDUP_TEST_PLACEHOLDER` 隔离。

**代码现场**：
- `quarantine.js:33` `FAILURE_THRESHOLD=3` —— 失败 3 次才隔离。
- 这些 KR 标题对应的实际描述是**空字符串**（payload `findings` 显示 `KR 描述: 无`），秋米 /decomp 跑出来就报"KR 内容空泛"无法拆解 → 计为 `task_error` → 又自动重投 → 又失败。

**根因（数据卫生 + 拆分问题）**：
1. 测试期遗留的 placeholder KR 进了生产 OKR 表，`shepherd/heartbeat` 周期性扫到 KR 没 Project 链接就触发"修复"任务 → 死循环。
2. 修复触发器没做"KR 描述是否为空"前置校验。

**防护方案**：
- 短期：在 dispatcher 里加白名单跳过 `title LIKE '%Test KR%'` / `description IS NULL OR length<10` 的 KR。
- 长期：清理 `key_results` 表里 5 条占位 KR（id 列表见下文 §4）。

## 3. 防护策略矩阵

| 失败簇 | 已有 fix（队列中） | 缺口 / 新建议 | 责任 |
|--------|--------------------|---------------|------|
| A liveness_dead 误杀长任务 | `3f32212a` 按 task_type 动态 timeout | watchdog 探活间隔随任务 phase（decomp 模式 → 5min 缓冲期） | brain |
| B orphan reaper 误杀成功任务 | `4ab9a9e8` 回调三联修 | orphan reaper 读 `last_run_result.status==success` 直接 complete | brain |
| C 硬编码账号 | 已合并 `dae4dc1c4` | cancel 旧任务 `8986d509`（避免占用 retry 槽） | ops |
| D 占位 KR 死循环 | — | dispatcher 白名单 + DB 清理 5 条 placeholder | brain + db |

补充：当前 `b4e92e19`（Brain 加 git+openssh）和 `29e87942`（Dockerfile 装 gh CLI）两条 queued 任务**对应 PR 已合并**（`2e00c0b7c` / `6519cf99c`），属于 stale 重复条目，应直接 cancel。

## 4. KR5 (Dashboard) 稳定性目标更新

**现 KR5**：`d0e7ee21` "Dashboard可交付 — 3大模块无阻断bug，可完整演示20分钟"，进度 58%。

**新增稳定性维度（建议）**：
- 任务调度层 24h `failure_class=liveness_dead` 计数 < 2/天
- orphan_detected 误判率 < 5%（即 90%+ orphan 应在 reaper 阶段判出已 success）
- placeholder/Test KR 在 `key_results` 表 = 0
- watchdog 平均 kill 后恢复时间 < 15min（已有 `MIN_BACKOFF_AFTER_LIVENESS_DEAD=900s` 兜底）

**回写动作**：调用 `PATCH /api/brain/key-results/d0e7ee21` 在 description 追加上述四项指标（见 §5 commit 中执行）。

## 5. 后续动作（task-level）

1. ✅ 本文档（PR 形式落库 `docs/current/rca/`）
2. ⏳ Cancel 4 条 stale 重复任务：`8986d509` `b4e92e19` `29e87942`（对应 fix 已合并）
3. ⏳ KR5 description 追加稳定性指标（见 §4）
4. ⏳ 回写本任务 `ffe743c9` 状态 = completed，result.pr_url 指向本 PR
5. ⏳ DB 清理 5 条占位 KR（题面"Test/LP Test/KR for project comparison/KR product domain/Active KR"）—— **建议另开任务**，本任务不直接动 DB
