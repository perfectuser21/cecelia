## 调度 job 入运行舱 + notion-gtd-sync 整轮有界（2026-09-24）

PR #5541 ｜ task 50a2c256 ｜ 决策 69cd802f

### 根本原因

- **入图缺口**：Brain 自己的 48 个 scheduler job 从未进 `ops_workflows`，活性告警只对表里的行生效——`notion-gtd-sync` 内层 30s 循环 00:41Z 卡死，8.4 小时运行舱与 Notion 驾驶舱全绿，主理人两行委派任务无人接收。
- **整轮无界**：单请求都有超时（Notion 30s abort / pg 连接 5s / ssh 30s），但 pg **查询**无超时（`statement_timeout=0`、无 `query_timeout`、keepalive 7200s），整轮也没有总超时；一个既不 resolve 也不 reject 的 await 就把 `inFlight` 永久锁死，且 `safe()` 不会留下任何日志。
- **活性来源选错**：立即返回型 handler 的调度哨兵 `at` 每分钟都新，内层死了也新；活性必须认 handler 自报的"最后一轮真正完成时刻"，且一轮都没完成时要用循环启动时刻兜底（否则开机首轮即卡永远绿）。
- 触发器是 00:40:35Z 的事件循环停顿（3 条 pg 新连接 5s 超时被 reset）；精确挂在哪个 await 随重启不可复原——这正是"记录当前步名"要补的证据。

### 下次预防

- [ ] 任何常驻循环/定时 job：**整轮总超时 + 步名 + 活性自报**三件套，缺一不算完（本次 `ensureGtdSyncLoop` 模板可复用：`Promise.race` + `onStep` + `isAbandoned` + `liveness_at`）。
- [ ] 新增 scheduler job 不需要手工登记——`scheduler-liveness` 自动从 JOBS 扫进 `ops_workflows(source='scheduler')`；内层有自循环的 handler 必须返回 `liveness_at` 并声明 `livenessIntervalSec`。
- [ ] 失联告警走 **Bark**，不走 `raise('P1')`（每小时批发到飞书、只留 5 条预览、Brain 重启即丢缓冲）。
- [ ] 同一 worktree 多子代理并发提交：用 `git commit -m "..." -- <path...>` pathspec 限定，禁 `git stash`；`git add && git commit` 之间的窗口会被别人的 `git add` 插入（本次实证两次误吞）。
- [ ] `scheduler-jobs.test.js` 这类"跑全部 job"的单测必须 mock 掉会真跑 ssh/docker 的 handler（本次 55s→1s，且 openclaw-guards 在有容器的机器上会 `docker restart` 生产网关）。
- [ ] 往 `ops_workflows` 加新 source 时，检查所有把它当"业务 workflow"的读方（便宜闸 registry、Notion 派单反查）并显式筛 `source='n8n'`。
- [ ] Bug 修复的 PrepPRD 放 `docs/superpowers/specs/*-prep-prd.md`，不放 `sprints/`（`contract-exists` 守卫把 sprints/ 视为 harness PR 强制要合同）。
- [ ] `feat:` 提交触及 `packages/brain/src` 必带 `packages/brain/scripts/smoke/<x>-smoke.sh` 并登记 `packages/quality/smoke-allowlist.txt`；改任何 `src/*.js` 必有配套 test（`lint-test-pairing`）。
