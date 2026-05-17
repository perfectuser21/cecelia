# Dashboard 飞书静默 toggle — runtime BRAIN_MUTED + API + UI

日期：2026-04-21
分支：cp-0421215331-muted-toggle-ui
Brain Task：a07dc3a2-e222-4c94-aa89-2ffa961098ac
前置 PR：#2509（BRAIN_MUTED env gate，已合并）

## 目标

BRAIN_MUTED 从纯 env 升级为"env + runtime toggle"。Dashboard 一个 button 点一下即可切换静默/发送，不用 sudo、不用重启 daemon、实时生效。

## 根据已有成熟模板

Brain 已有 `packages/brain/src/consciousness-guard.js`——双层设计典范：
- Layer 1: env 优先（`CONSCIOUSNESS_ENABLED=false` 紧急逃生）
- Layer 2: `working_memory` 表 runtime toggle
- 4 函数导出：`init / set / get / reload`
- 配套 migration `240_consciousness_setting.sql` init key

本设计**完全复用这个模式**，只改 key 名和 env 名。

## 架构

```
┌────────────────────────────────────────────────────┐
│ Dashboard LiveMonitorPage — BRAIN 区块             │
│   [Toggle button: 飞书发送: ON/OFF]                 │
│        ↓ POST /api/brain/settings/muted {enabled}           │
│        ↑ GET /api/brain/settings/muted                      │
└────────────────────────────────────────────────────┘
                       ↓
┌────────────────────────────────────────────────────┐
│ Brain: routes/muted.js                             │
│   GET  → getMutedStatus()                          │
│   POST → setMuted(pool, enabled)                   │
└────────────────────────────────────────────────────┘
                       ↓
┌────────────────────────────────────────────────────┐
│ muted-guard.js (新)                                │
│   isMuted() = env || runtime_cache                 │
│   initMutedGuard(pool) — startup                   │
│   setMuted(pool, bool) — 写 DB + 更新 cache        │
│   getMutedStatus() — {muted, last_toggled_at,      │
│                        env_override}               │
└────────────────────────────────────────────────────┘
                       ↓
┌────────────────────────────────────────────────────┐
│ working_memory 表                                  │
│   key='brain_muted'                                │
│   value_json={enabled, last_toggled_at}            │
└────────────────────────────────────────────────────┘

notifier.js:
  sendFeishu/sendFeishuOpenAPI 顶部 → import { isMuted } from './muted-guard.js'
  gate 改成：if (isMuted()) return false
```

## 变更清单

| 文件 | 动作 | 说明 |
|---|---|---|
| `packages/brain/src/muted-guard.js` | Create | 复用 consciousness-guard 模式，~70 行 |
| `packages/brain/migrations/242_brain_muted_setting.sql` | Create | working_memory key=brain_muted 默认值 |
| `packages/brain/src/notifier.js` | Modify | gate 从 env 判断改为调 `isMuted()` |
| `packages/brain/src/server.js` | Modify | `app.listen` 之前加 `await initMutedGuard(pool)` |
| `packages/brain/src/routes/settings.js` | Modify | 复用现有 settings 路由文件，加 muted GET + PATCH（与 consciousness 同构）|
| `packages/brain/src/__tests__/muted-guard.test.js` | Create | 4 场景单测 |
| `packages/brain/src/__tests__/muted-api.test.js` | Create | API GET/POST 单测 |
| `apps/dashboard/src/pages/live-monitor/LiveMonitorPage.tsx` | Modify | BRAIN 区块加 toggle |
| `apps/dashboard/src/pages/live-monitor/*.test.tsx` | Modify/Create | 组件测试 |

## 关键行为契约

### muted-guard.isMuted() 返回 true 的条件（OR 逻辑）

1. `process.env.BRAIN_MUTED === 'true'` → true（env 硬静默，runtime 覆盖不了）
2. `_cached.enabled === true`（working_memory 里 runtime 设了）
3. 其他 → false（默认发送）

### env_override 语义

`getMutedStatus()` 返回的 `env_override: true` 表示 **env 强制为 true，runtime toggle 无意义**。此时：
- Dashboard UI button 显示 disabled + tooltip "env BRAIN_MUTED=true 强制静默"
- 用户要切换必须改 plist + 重启 daemon（Learning 里的手动流程）

### 默认值

- working_memory `brain_muted.enabled` 默认 `false`（不静默，保持现有行为）
- `initMutedGuard` 遇到 DB 错误 → `_cached = {enabled: false, ...}`（fail-open 和 consciousness-guard 一致）

## 测试策略

### muted-guard.test.js — 4 场景

| # | env | runtime cache | isMuted() | 说明 |
|---|---|---|---|---|
| 1 | unset | `{enabled: false}` | false | 默认行为 |
| 2 | unset | `{enabled: true}` | true | runtime toggle 生效 |
| 3 | `"true"` | `{enabled: false}` | true | env 覆盖 runtime |
| 4 | `"true"` | `{enabled: true}` | true | 任一 true 即静默 |

外加 `setMuted` / `getMutedStatus` 写入 DB + cache 更新的集成测试。

### muted-api.test.js — 3 场景

- `GET /api/brain/settings/muted` → 返回 `{enabled, last_toggled_at, env_override}` 结构
- `PATCH /api/brain/settings/muted {enabled:true}` → 200 + cache 更新 + DB 写入
- `PATCH /api/brain/settings/muted {enabled:"yes"}` → 400（严格 boolean，与 consciousness 一致）

### notifier.js 升级后 regression

原 6 场景（env=true / false / unset / 空串 / 非"true"值 × 两函数）全绿。新增：
- runtime cache `enabled=true` + env unset → 不 fetch（gate 通过 isMuted）
- runtime cache `enabled=false` + env unset → 正常 fetch

### Dashboard 组件测试

- 默认状态加载时 GET 一次 → 显示当前状态
- 点击 button → POST + toast
- `env_override=true` → button disabled + tooltip

## 兼容性

- 前 PR (#2509) 的 env gate 语义**完全保留**：`BRAIN_MUTED=true` 依旧硬静默
- 现有 6 场景单测不修改（notifier 层行为契约不变）
- 前 PR 合并后手工加的 plist env `BRAIN_MUTED=true` **仍然生效**（env 优先于 runtime）—— 本 PR 合并后用户如果想用 Dashboard toggle，要先把 plist 的 env 移除 + 重启 daemon 一次

## 不做

- 不改 `consciousness-guard.js`（它是独立模块）
- 不加撤销/历史表（简单 on/off）
- 不加跨域权限/鉴权（这是内部 Dashboard，和现有 API 一致）
- 不做 Dashboard 鉴权升级

## Gate 语义边界（延续前 PR）

`isMuted()` 只控**主动 outbound**，不控对话回复（`routes/ops.js::sendFeishuMessage` 继续不受影响）。

## 验收标准

- [ARTIFACT] `muted-guard.js` 5 函数导出齐
- [ARTIFACT] migration 242 新文件
- [ARTIFACT] `notifier.js` 两个 gate 从 env 检查改为 `isMuted()` 调用
- [ARTIFACT] `server.js` 启动 init
- [ARTIFACT] `routes/muted.js` GET + POST
- [ARTIFACT] Dashboard LiveMonitorPage 有 toggle + 状态显示 + env_override 处理
- [BEHAVIOR] muted-guard 4 场景单测绿
- [BEHAVIOR] muted-api 3 场景单测绿
- [BEHAVIOR] notifier 原 6 场景 + 新增 2 场景共 8 场景绿
- [BEHAVIOR] Dashboard 组件测试绿
- [BEHAVIOR] 手动 smoke：Brain 重启后 Dashboard 点 toggle → 飞书真的静默（可发测试消息验证）
