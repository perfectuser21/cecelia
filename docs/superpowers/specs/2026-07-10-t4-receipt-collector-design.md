# T4 回执 Collector 设计（九要素完备化 plan_seq=4）

日期：2026-07-10
任务：213e2122-1085-4c20-8001-e1bc3bf58de7
上游设计：docs/architecture/2026-07-10-nine-elements-integrity/architecture.md（PR #3731）
表基础：migration 315 `action_receipts`（已在生产，字段与本设计完全一致）

## 目标

对外动作"发出即成功"是谎言。三入口（notifier / feishu-alert / deploy webhook）发送后写
`action_receipts(pending)`，按真实结果核销 confirmed/failed；无人核销的由 tick job 超时标
timeout；未确认动作喂给作战日报，让主理人每天看到"哪些动作发出去了但没人确认效果"。

## 模块设计

### 1. 新建 `packages/brain/src/receipt-collector.js`

只 import `./db.js`。**严禁 import notifier.js / alerting.js**（alerting→notifier 已有潜在环，
本模块失败只 console.error/warn，fail-open 不告警）。

导出：

- `recordActionReceipt({ kind, target, actionId, evidence })` → INSERT pending，返回 receipt id；
  任何 DB 错误 catch → warn → 返回 null（never breaks main flow）。
- `resolveActionReceipt(id, status, evidence)` → UPDATE receipt_status + evidence 合并 +
  updated_at=NOW()；id 为 null/status 非法直接返回 false；DB 错误同样 fail-open。
- `runReceiptCollector(pool)` → tick job handler：
  - 自 gate：in-memory 三件套（`CECELIA_RECEIPT_COLLECTOR_INTERVAL_MS` env 可覆盖，默认 10min；
    `lastRunAt`；`__resetReceiptCollectorForTest()`），照抄 capture-triage.js 先例。
  - 核销扫描：`UPDATE action_receipts SET receipt_status='timeout', updated_at=NOW()
    WHERE receipt_status='pending' AND sent_at < NOW() - interval '30 minutes'
    RETURNING id, kind`，返回 `{ timedOut: n }`。
- `getUnconfirmedReceipts(pool)` → 查 24h 内 `receipt_status IN ('pending','timeout','failed')`
  的回执（kind/target/receipt_status/sent_at，LIMIT 50），供 battle-report 消费。

超时阈值 30min 理由：feishu/bark 秒级完成；deploy 最长 ~15min（status file 窗口），30min 全覆盖。

### 2. 三入口接线（写 pending → 按结果核销）

统一原则：**只在真正发起对外网络调用时写回执**——muted、rate-limit、dedupe 命中、凭据未配置
等跳过路径不写（没有动作就没有回执）。入口侧统一动态 `await import('./receipt-collector.js')`
（照 notifier 引 dedupe 的先例），record/resolve 全部 fail-open。

| 入口 | kind | target | 核销点 |
|---|---|---|---|
| notifier.js `sendFeishu` webhook 渠道 | feishu | webhook | resp.ok → confirmed（evidence: http_status）；!ok/异常 → failed |
| notifier.js `sendFeishuOpenAPI` | feishu | open_api | 发送成功 code=0 → confirmed；token/发送失败/异常 → failed |
| notifier.js `sendBark` | bark | bark | result.code===200 → confirmed；否则 failed |
| feishu-alert.js `sendToFeishu` | feishu | skill_eval_webhook | resp.ok → confirmed；!ok/异常 → failed（webhook 未配置只本地日志 → 不写） |
| ops.js POST /deploy production | deploy | production | spawn 前写 pending（evidence: changed_paths/log_path）；child close code=0 → confirmed（evidence: elapsed_ms）；≠0 → failed；Brain 中途重启 → collector 标 timeout |
| ops.js POST /deploy staging | deploy | staging | execSync 成功 → confirmed（skip 时 evidence.skip_reason 记入）；抛错 → failed |

### 3. scheduler-jobs.js 注册

JOBS 表加一行：`{ name: 'receipt-collector', needsPool: true, timeoutMs: DEFAULT_TIMEOUT_MS,
handler: runReceiptCollector, description: '回执核销（自带10min间隔gate，pending超30min标timeout）' }`。
同步改 `__tests__/scheduler-jobs.test.js` 的 job 数断言（10→11）+ 名称数组 + vi.mock 新模块。

### 4. battle-report.js 加第⑥段「未确认动作（24h）」

- `buildBattleReportData`：try/catch 调 `getUnconfirmedReceipts(pool)`（动态 import 或静态均可，
  battle-report 无测试隔离问题，用静态 import），失败降级空数组（照军师决策段先例）。
- `renderBattleReportMarkdown`：新段渲染 `- {kind} → {target}：{status}（{sent_at 上海短格式}）`，
  空渲染"暂无"；字段缺省不炸。
- 文件头/函数注释"五段"改"六段"。

## 测试策略

- **unit**（vitest，mock pool）：
  - `receipt-collector.test.js`（新）：record 写 pending SQL、resolve 状态流转与非法输入、
    tick 自 gate（间隔内 skip）、超时 UPDATE SQL 形状、getUnconfirmed 查询、全路径 fail-open。
  - `notifier.js`/`feishu-alert.js` 接线测试：vi.mock receipt-collector，断言三种结果各自
    record/resolve 调用参数（kind/target/status）；muted/dedupe 跳过路径断言不写。
  - deploy webhook：在现有 deploy 测试族（已 mock db.js）加断言——触发 deploy 后写 pending。
  - battle-report.test.js：新段查询含 action_receipts + 抛错降级 + 渲染"暂无"/正常两态。
  - scheduler-jobs.test.js：11 jobs 断言更新。
- **smoke（manual）**：node -e 读源码验证三入口都出现 recordActionReceipt 接线 +
  scheduler-jobs 注册 + battle-report 渲染函数含未确认段（CI 兼容，不连库）。
- **不改** ledger-hygiene.js：其指标3已按 migration 315 字段探活式读表，T4 写入首行即自动激活。

## 版本与部署

- brain minor bump：1.249.0 → 1.250.0（package.json / package-lock 两处 / .brain-versions /
  DEFINITION.md 四处同步，用 `npm version minor --no-git-tag-version`）。
- 无新 migration。merge 后 Gate3 自动重部署生产，验证 `/deploy/status` 与 action_receipts 出现新行。

## 不做

- 不给回执配独立告警（击穿走 T1 ledger-hygiene 棘轮，已上线）。
- 不覆盖 bark 之外的其他对外动作（pr_merge 等留后续按需接入）。
- 不做 collector 的"主动探测确认"（如回查飞书消息是否送达）——首版核销只依赖入口回调 + 超时。
