# Brain 出站飞书单一 gate（BRAIN_MUTED）+ 堵 arch-review 源头

日期：2026-04-21
分支：cp-0421180232-brain-muted-gate
Brain Task：091672a1-322a-441f-a124-3590b9374cbc

## 问题陈述

Brain 向 Alex 飞书发送消息的频率失控——每分钟 1-2 条，24 小时不停。已有 `CONSCIOUSNESS_ENABLED=false` 开关但只覆盖"意识模块"（proactive-mouth / self-drive / dopamine），**alerting 模块（P0/P1/P2）绕过该开关直连飞书**，管不住。

## 根因链条（已从 brain.log 实证）

```
1. daily-review-scheduler.js 每 4h 创建 arch_review task
   → INSERT 只填 title，payload 只有 {scope, trigger}，缺 description / prd_summary

2. pre-flight-check.js 拒绝 description 为空的任务（见 L61/L64）
   → 24h 累积 10 条被拒 → pre_flight_burst 触发 P0 alert

3. alerting.js 的 P0 限流用 in-memory Map（L21: const _p0RateLimit = new Map()）
   → Brain 频繁重启时 Map 清零 → 限流失效
   → 每次重启后立即发一条【URGENT】→ 每分钟 1-2 条

4. proactive-mouth / self-drive 每 tick 各发 1 条（次要噪声）
```

## 设计

**核心原则：所有出站飞书经过一个 gate。**

### 单一出口 gate

`packages/brain/src/notifier.js` 是所有飞书消息的必经之路（`sendFeishu` 和 `sendFeishuOpenAPI` 两个导出函数）。在这两个函数顶部加一个 env 检查：

```js
const BRAIN_MUTED = () => process.env.BRAIN_MUTED === 'true';

async function sendFeishu(text) {
  if (BRAIN_MUTED()) {
    console.log('[notifier] BRAIN_MUTED=true → skip outbound (feishu webhook):', text.slice(0, 80));
    return false;
  }
  // ... 原逻辑
}

async function sendFeishuOpenAPI(text) {
  if (BRAIN_MUTED()) {
    console.log('[notifier] BRAIN_MUTED=true → skip outbound (feishu open api):', text.slice(0, 80));
    return false;
  }
  // ... 原逻辑
}
```

**不用 module-top const**（会被测试环境缓存），用函数形式每次读 `process.env`。

### 上游不改

现有所有 sendFeishu 调用者（alerting / proactive-mouth / self-drive / content-pipeline / daily-report / decision-executor / callback-processor）**不需要任何修改**——因为它们都经过 notifier.js 这条路。

### 默认值

`BRAIN_MUTED` 未设 / 空 / 任何非 `"true"` 的值 → gate 不生效（向后兼容）。
只有严格等于 `"true"` 字符串才静默。

### 堵 arch-review 源头

`packages/brain/src/daily-review-scheduler.js` 的 INSERT（L290-300）payload 加 `prd_summary` 字段，内容 ≥ 20 字符（pre-flight-check 的硬门槛是 20）。

示例 payload：

```json
{
  "scope": "scheduled",
  "trigger": "4h",
  "prd_summary": "架构巡检：扫描 2026-04-21 10:00 UTC 时点的 drift / 未收敛模式 / 依赖异常，输出 4A/4B 报告。"
}
```

`pre-flight-check.js:58` 的 fallback 链为 `task.description || task.prd_content || task.payload?.prd_summary` — 写 `payload.prd_summary` 即可覆盖。

## 变更清单

| 文件 | 动作 | 说明 |
|---|---|---|
| `packages/brain/src/notifier.js` | 两处加 gate（~10 行） | 唯一出口守护 |
| `packages/brain/src/daily-review-scheduler.js` | 改 INSERT payload（2 行） | arch-review 任务 description 达标 |
| `packages/brain/src/__tests__/notifier-muted-gate.test.js` | 新增测试 | 6 场景覆盖 |
| `packages/brain/src/__tests__/arch-review-prd-summary.test.js` | 新增测试 | 验证 prd_summary ≥ 20 字符 |
| `docs/learnings/cp-0421180232-brain-muted-gate.md` | 新增 Learning | 单一 gate 设计决策 + 手动静默操作手册 |

## 测试策略

### 1. `notifier-muted-gate.test.js` — 6 场景

| # | env | 调用 | 预期 |
|---|---|---|---|
| 1 | `BRAIN_MUTED=true` | `sendFeishu("x")` | 不发 fetch，返回 false，日志含 "skip outbound" |
| 2 | `BRAIN_MUTED=true` | `sendFeishuOpenAPI("x")` | 不发 fetch，返回 false |
| 3 | `BRAIN_MUTED=false` | `sendFeishu("x")` | 正常走 fetch（mock webhook 返回 200） |
| 4 | `BRAIN_MUTED` 未设 | `sendFeishu("x")` | 正常走 fetch |
| 5 | `BRAIN_MUTED=""` | `sendFeishu("x")` | 正常走 fetch（空串不等于 "true"） |
| 6 | `BRAIN_MUTED="1"` / `BRAIN_MUTED="yes"` | `sendFeishu("x")` | 正常走 fetch（严格 "true" 才静默）|

mock 策略：`global.fetch = vi.fn()`，断言调用次数。

### 2. `arch-review-prd-summary.test.js` — 单元测试

验证 `daily-review-scheduler.js` 生成的 payload 含 `prd_summary` 字段且长度 ≥ 20：

```js
import { triggerArchReview } from '../daily-review-scheduler.js';
const mockPool = { query: vi.fn().mockResolvedValue({ rows: [{ id: 'test-id' }] }) };
// 注入足够条件触发
await triggerArchReview(mockPool, fakeDate);
// 断言 INSERT SQL 参数 2（payload JSON）parse 出来含 prd_summary ≥ 20
```

## 不做

- 不改 `alerting.js` 的 P0 限流实现（限流用 DB 持久化是另一个问题，本 PR 用 BRAIN_MUTED 堵出口就够了）
- 不改 `consciousness-guard.js` 的语义（consciousness 管思考，muted 管输出，两个正交维度）
- 不重启 Brain（LaunchAgent 下次重启时生效。止血需求在 Learning 手册里）
- 不改 `~/Library/LaunchAgents/com.cecelia.brain.plist`（本 PR 不设默认静默，保留现状兼容）

## 兼容性

- 默认行为不变：BRAIN_MUTED 未设 = false = 所有上游继续工作
- E2E 测试不受影响：测试本来就 mock fetch，不会触发真飞书
- Codex runner / 无头任务 不受影响：它们不经过 notifier.js

## Gate 语义边界（设计决策）

BRAIN_MUTED 只关**主动出站**（Brain → 飞书的告警 / 推送 / 日报）。**不关对话回复**：

- `notifier.js` 的 `sendFeishu` / `sendFeishuOpenAPI` = **主动 outbound**（由 alerting / proactive-mouth / self-drive 等上游调用）→ **BRAIN_MUTED gate 在这里**
- `packages/brain/src/routes/ops.js` 的 `sendFeishuMessage()` = **对话回复**（飞书机器人收到用户消息后响应）→ **不加 gate**

原因：如果 MUTED 也关对话回复，用户给 Brain 发"状态"时机器人就不回了，调试更难。两条路径语义正交：一个是 Brain 主动说话，一个是 Brain 被动应答。MUTED 只管前者。

## 验收标准

- [ARTIFACT] `notifier.js` 两个函数顶部有 BRAIN_MUTED gate
- [ARTIFACT] `daily-review-scheduler.js` INSERT payload 含 `prd_summary` 字段
- [BEHAVIOR] `notifier-muted-gate.test.js` 6 场景全绿
- [BEHAVIOR] `arch-review-prd-summary.test.js` 单元测试全绿
- [BEHAVIOR] 现有 `notifier.test.js` 不回归（不改 sendFeishu 的 happy path 行为）
- [BEHAVIOR] engine-tests / brain-unit 全绿
- [ARTIFACT] Learning 文档描述设计决策 + 紧急静默操作手册（加 env 到 plist + launchctl reload）

## 紧急静默手册（记在 Learning）

止血操作（让 Brain 立刻不发飞书）：

```bash
# 1. 改 plist 加两行 env
/usr/libexec/PlistBuddy -c "Add :EnvironmentVariables:BRAIN_MUTED string true" \
  ~/Library/LaunchAgents/com.cecelia.brain.plist

# 2. 重启 LaunchAgent
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.cecelia.brain.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.cecelia.brain.plist

# 3. 验证新进程有这个 env（等 5s 让新进程启动）
sleep 5 && launchctl procinfo $(pgrep -f 'brain/server.js' | head -1) | grep BRAIN_MUTED
```

恢复：把 plist 里 `BRAIN_MUTED` 改成 false 或删除该条目，再次 reload。
