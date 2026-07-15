# DoD 检查清单 — A8-3：金丝雀故障注入演习

- Sprint：A8-3
- 任务 ID：56d677a8-65e8-485c-9ec3-1ade28716ae9
- 对应合同：contract-draft.md

---

## DoD 检查清单

### BEHAVIOR 条目（功能行为断言）

[BEHAVIOR-1] canary 隔离过滤 dev-records：向 staging brain 注册 payload.canary=true 的任务，PR callback 写 dev_records 时，GET /api/brain/dev-records 返回的所有记录中，不存在 payload.canary==='true' 的条目（WHERE payload->>'canary' IS DISTINCT FROM 'true' 过滤有效）
（对应 FR-14，INV-16）

[BEHAVIOR-2] canary 隔离过滤回归池：harness-promote-regression.js 入池逻辑，当 task.payload.canary=true 时，不调用入池写库操作；canary 任务不出现在回归池查询结果中
（对应 FR-14，INV-16）

[BEHAVIOR-3] canary 隔离过滤统计计数：battle-report.js dev_records 24h 合并统计和 diary-scheduler.js count 查询，均不计入 payload.canary=true 的记录；插入1条 canary 记录后，计数结果不变
（对应 FR-14，INV-16）

[BEHAVIOR-4] 演习脚本生产端口守卫：canary-death-drill.mjs 在 STAGING_BRAIN_URL 含 `:5221` 时立即 exit 1，不发任何请求；在 STAGING_BRAIN_URL 为 `:5222` 时正常执行注册流程
（对应 INV-15，NFR-02）

[BEHAVIOR-5] OOM 注入分类断言：canary-death-drill.mjs 以 mode=oom 运行，向 staging brain 注册 canary 任务后，模拟 exit_code=137 注入，轮询断言 task.payload.cause==='oom'；首次 oom_upgraded 未设时 attempt 递增且 oom_upgraded 被设为 true；oom_upgraded 已为 true 时 task.status==='failed'
（对应 FR-07/FR-08，INV-10）

[BEHAVIOR-6] 演习落档降级写 design_docs：incidents 表不存在（POST /api/brain/incidents 返回 404）时，脚本降级调用 POST /api/brain/design-docs，type='drill_report'，内容包含 injected_mode 和 results；代码含 TODO 注释标明正式接口
（对应 FR-11）

[BEHAVIOR-7] Bark 失败告警：演习断言失败时，sendBark 被调用1次，告警标题含 'CanaryDrill Failed'，告警内容含 task_id 和失败断言描述；BARK_URL 未设时 log warn 不 throw
（对应 FR-13，NFR-04）

[BEHAVIOR-8] nightly tick job 注册：canary-drill-scheduler.js 在 tick loop 中，当 UTC 时间 19:25~19:35 窗口内，调用一次 canary-death-drill.mjs（exec 或 spawn）；同一日历日内不重复触发（幂等保护）
（对应 FR-12，NFR-03）

[BEHAVIOR-9] kill-9 注入分类断言：canary-death-drill.mjs 以 mode=kill9 运行，启动 `docker run -d --name canary-<task_id> alpine sleep infinity` 后执行 `docker kill canary-<task_id>`；轮询断言 task.payload.cause 为 'oom'（exit 137）或 'unknown'，且 attempt 递增（重点火触发）；canary 任务不出现在 /api/brain/dev-records 返回
（对应 FR-09，INV-17）

[BEHAVIOR-10] 卡交互注入分类断言：canary-death-drill.mjs 以 mode=interactive_stuck 运行，启动 tmux session 使 pane 显示 `Press enter to continue`；轮询断言 task.payload.cause==='interactive_stuck'，`tmux kill-session -t canary-<task_id>` 被调用（session 消失），attempt 递增
（对应 FR-10，INV-17）

---

### CONSTRAINT 条目（铁律绑定断言）

[CONSTRAINT-INV04] mock 范围限制：L1 测试只 mock docker/tmux/gh/Bark/staging-fetch 最外层接口；classifyDeath、canary 过滤 SQL 条件构造、Bark 消息内容不得 mock，必须真实执行

[CONSTRAINT-INV15] 生产隔离：canary-death-drill.mjs 任何代码路径不得向 `:5221` 发请求；测试用 stub URL 必须为 `:5222`；守卫断言（BEHAVIOR-4）作为测试用例存在

[CONSTRAINT-INV16] canary 污染零容忍：BEHAVIOR-1/2/3 三条测试均在 canary 记录写入后断言统计结果不变；过滤条件使用 `IS DISTINCT FROM 'true'`（而非 `!= 'true'`，以正确处理 NULL）

[CONSTRAINT-INV17] 注入方式固定三种：脚本 --mode 参数只允许 oom/kill9/interactive_stuck/random；random 从三种中随机选一；不得新增第四种注入方式

[CONSTRAINT-INV05] L1 链路用例先于处置器：canary 隔离过滤的 L1 用例（BEHAVIOR-1/2/3）必须在对应处置器实现前作为 Red 测试提交；测试文件提交时间戳早于实现文件提交时间戳（git log 可验证）

[CONSTRAINT-INV15-EARLY-EXIT] staging 5222 不在线时 early exit：canary-death-drill.mjs 脚本在注册任务前，先 GET `${STAGING_BRAIN_URL}/api/brain/context`；若返回非 2xx 或连接超时（3s），立即 exit 1 并输出 `[ERROR] staging brain not reachable at ${STAGING_BRAIN_URL}`，不继续执行任何注入操作

[CONSTRAINT-INV18] 脚本不执行 harness 逻辑：canary-death-drill.mjs 不 import harness-relay-watchdog.js、harness-death-handlers.js 或任何 harness 执行模块；只通过 HTTP API 与 brain 交互

---

### 文件交付物

- [ ] `scripts/canary-death-drill.mjs` — 新建，金丝雀注入器（注册+注入+轮询+落档+Bark），≤300 行
- [ ] `packages/brain/src/canary-drill-scheduler.js` — 新建，tick job 03:30 CST 定时逻辑，含幂等保护
- [ ] `packages/brain/src/__tests__/canary-isolation.test.js` — 新建，canary 隔离行为测试（BEHAVIOR-1/2/3）
- [ ] `sprints/07161400-a8-3-canary-drill/tests/canary-drill.contract.test.js` — 新建，演习合同测试（BEHAVIOR-4/5/6/7/8，Red 骨架）
- [ ] `packages/brain/src/cecelia-routes.js` — 修改，dev-records 查询加 canary 过滤
- [ ] `packages/brain/src/battle-report.js` — 修改，dev_records 统计加 canary 过滤
- [ ] `packages/brain/src/diary-scheduler.js` — 修改，count 查询加 canary 过滤
- [ ] `packages/brain/src/harness-promote-regression.js` — 修改，入池逻辑加 canary 过滤
- [ ] `launchd/cecelia.canary-drill.plist` — 可选，macOS 备选定时方案

---

### NFR 验收

- [ ] NFR-01：演习脚本单次运行上限 20 分钟（TIMEOUT_MS = 20 * 60 * 1000，超时 exit 1）
- [ ] NFR-02：脚本对 `:5221` 的守卫在 exit 前不发任何 HTTP 请求（BEHAVIOR-4 覆盖）
- [ ] NFR-03：nightly tick job 幂等：同日历日内只触发一次（canary-drill-scheduler.js 有去重逻辑）
- [ ] NFR-04：Bark 告警延迟 ≤ 60s（演习断言失败后立即调用，无额外等待）
- [ ] NFR-05：canary 过滤 SQL 变更加注释说明无 schema 改动原因（payload 已为 JSONB 列）

---

manual:bash cd /workspace && STAGING_BRAIN_URL=http://localhost:5222 node scripts/canary-death-drill.mjs --mode oom; echo "exit: $?"

manual:bash cd /workspace && npx vitest run packages/brain/src/__tests__/canary-isolation.test.js sprints/07161400-a8-3-canary-drill/tests/ --reporter=verbose 2>&1 | tail -40
