# muted toggle 测试补强 — LiveMonitor 静态检查 + brain integration E2E

日期：2026-04-22
分支：cp-0422094700-muted-test-coverage（实际以 worktree 生成为准）
Brain Task：3c359029-059a-4b3a-b858-e7ddbad23da4
前置：#2509 #2511 #2513 #2515（muted 全链路已落地）

## 问题

现有 muted 相关测试覆盖有两个缺口：

1. **LiveMonitorPage 的 toggle 无测试**（#2511 漏了）
2. **无真 pg + 真 HTTP 的 muted E2E**（现有都是 mock fetch）

**好消息**：Brain 已有 `consciousness-toggle-e2e.integration.test.js`（100 行，supertest + 真 pg + 真路由），完美模板，复制改名即可。

## 方案

### A. LiveMonitor 静态检查（grep 级）

**不渲染整页**（LiveMonitorPage.tsx 1700+ 行，mock 成本太高）。用 fs readFileSync + regex 检查关键锚点：

文件：`apps/dashboard/src/pages/live-monitor/LiveMonitorPage.test.tsx`（新建）

5 个锚点：

1. 含 `GET /api/brain/settings/muted`（初始加载）
2. 含 `PATCH .+/api/brain/settings/muted`（点击切换）
3. 含 `env_override` 的 disabled 分支
4. 含 `'飞书: 静默中'` 和 `'飞书: 发送中'` 文案（避免被改没）
5. 含 `JSON.stringify` body（避免请求体被改）

这是 **grep 级回归防线**——防止 toggle 逻辑被误删/重构忘同步。不挡"逻辑错"，但能挡"代码被删"。

### B. muted HTTP E2E integration test

文件：`packages/brain/src/__tests__/integration/muted-toggle-e2e.integration.test.js`（新建）

**照抄** `consciousness-toggle-e2e.integration.test.js`（100 行，已存在），改：

| consciousness 版 | muted 版 |
|---|---|
| `consciousness-guard.js` | `muted-guard.js` |
| `initConsciousnessGuard` | `initMutedGuard` |
| `isConsciousnessEnabled` | `isMuted` |
| `MIGRATION_240` | `MIGRATION_242` |
| `MEMORY_KEY = 'consciousness_enabled'` | `'brain_muted'` |
| `/api/brain/settings/consciousness` | `/api/brain/settings/muted` |
| 默认 enabled=true | 默认 enabled=false |

1 个 test（完整 HTTP 链）：
- GET 默认状态（enabled=false, env_override=false）
- PATCH {enabled:true} → 200 + last_toggled_at
- GET 状态持久化（enabled=true + 同 last_toggled_at）
- 查 DB working_memory.brain_muted 确认 enabled=true
- `isMuted()` 返回 true（cache write-through）
- PATCH {enabled:false} → isMuted() 回 false（对称）

### C. CI 集成

两个测试自动进现有 CI job，**不新加 job**：

- LiveMonitorPage.test.tsx → `workspace-test` job（`apps/dashboard` 的 vitest 自动扫描）
- muted-toggle-e2e.integration.test.js → `brain-integration` job（现跑 `src/__tests__/integration/**`）

## 变更清单

| 文件 | 动作 | 大小 |
|---|---|---|
| `apps/dashboard/src/pages/live-monitor/LiveMonitorPage.test.tsx` | Create | ~40 行 |
| `packages/brain/src/__tests__/integration/muted-toggle-e2e.integration.test.js` | Create | ~100 行（照抄 consciousness 改名）|

## 不做

- 不写 Playwright / headless 浏览器 E2E（基础设施没有，成本过高）
- 不重构 LiveMonitorPage 抽离 toggle 子组件（scope creep）
- 不改现有 4 个测试文件（muted-guard / settings-muted-api / notifier-muted-gate / SettingsPage）
- 不新加 CI job

## 验收

- [ARTIFACT] LiveMonitorPage.test.tsx 存在含 5 个 grep 锚点
- [ARTIFACT] muted-toggle-e2e.integration.test.js 存在
- [BEHAVIOR] `workspace-test` 本地跑 LiveMonitorPage.test.tsx 绿
- [BEHAVIOR] `brain-integration` 本地跑 muted-toggle-e2e 全绿（需要 postgres 启动）
- [BEHAVIOR] CI 上 `workspace-test` + `brain-integration` 自动跑两个新测试

## 风险

- **本地跑 integration 需要 pg 连接**：CI 有 postgres service，本地要确保 DB_HOST/DB_NAME 环境能连。参考 `consciousness-toggle-e2e` 的本地跑法（它已经能本地跑，照搬即可）
- **LiveMonitor 静态检查是薄的**：不挡逻辑错，只挡代码被删。但对于 1700 行的大组件，这是最经济的投资
