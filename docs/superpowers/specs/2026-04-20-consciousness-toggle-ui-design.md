# Consciousness Toggle UI — 运行时热切换 + Dashboard 按钮

**创建日期**: 2026-04-20
**分支**: cp-0420094522-consciousness-toggle-ui
**Brain 版本**: 1.220.0 → 1.221.0 (minor)
**前置**: PR #2447（`CONSCIOUSNESS_ENABLED` env 开关 + watchdog SSOT）
**状态**: 批准（autonomous via Research Subagent）

---

## 1. 背景 & 目标

PR #2447 做了 env 层开关，需要主机改 plist + launchctl unload/load 才能切。本次 Phase 2：

1. **运行时热切换**：API/Dashboard 点一下即生效，不重启 Brain
2. **Dashboard UI**：`/settings` 页面一个 Switch 可视化控制
3. **env override 紧急逃生口**：plist 的 `CONSCIOUSNESS_ENABLED=false` 仍然优先于 memory，主机级强制关闭不可被 UI 覆盖

## 2. 架构

### 2.1 三级优先（replace PR #2447 的 env-only 判断）

```
isConsciousnessEnabled():
  if env.CONSCIOUSNESS_ENABLED === 'false' → false   (env override)
  if env.BRAIN_QUIET_MODE === 'true'         → false   (deprecated alias)
  if memory.consciousness_enabled is set    → return that
  return true                                          (default)
```

**关键**：env=false 时 memory 被完全忽略（紧急逃生口语义不变）；env 未设时 memory 是权威来源。

### 2.2 模块扩展（`packages/brain/src/consciousness-guard.js`）

新增状态 + 方法：
```js
let _cached = null;       // { enabled: bool, last_toggled_at: ISO }
let _initialized = false;

export async function initConsciousnessGuard(pool) {
  const row = await pool.query(`SELECT value FROM working_memory WHERE key='consciousness_enabled'`);
  _cached = row.rows[0]?.value || { enabled: true, last_toggled_at: null };
  _initialized = true;
}

export function isConsciousnessEnabled() {
  // env override 优先（逃生口）
  if (process.env.CONSCIOUSNESS_ENABLED === 'false') return false;
  if (process.env.BRAIN_QUIET_MODE === 'true') { _warnDeprecated(); return false; }
  // memory 权威
  if (_initialized && _cached) return _cached.enabled !== false;
  return true; // 默认
}

export async function setConsciousnessEnabled(pool, enabled) {
  const now = new Date().toISOString();
  const value = { enabled: !!enabled, last_toggled_at: now };
  await pool.query(`INSERT INTO working_memory(key, value) VALUES($1,$2)
                    ON CONFLICT (key) DO UPDATE SET value=$2, updated_at=NOW()`,
                   ['consciousness_enabled', JSON.stringify(value)]);
  _cached = value;  // write-through：立即生效
  console.log(`[Brain] Consciousness toggled → ${enabled} at ${now}`);
  return getConsciousnessStatus();
}

export function getConsciousnessStatus() {
  const envOverride = (process.env.CONSCIOUSNESS_ENABLED === 'false') ||
                      (process.env.BRAIN_QUIET_MODE === 'true');
  return {
    enabled: isConsciousnessEnabled(),
    last_toggled_at: _cached?.last_toggled_at || null,
    env_override: envOverride,
  };
}

export async function reloadConsciousnessCache(pool) {
  // 容错兜底：tick 每 N 分钟调用，防外部工具直改 DB
  const row = await pool.query(`SELECT value FROM working_memory WHERE key='consciousness_enabled'`);
  if (row.rows[0]?.value) _cached = row.rows[0].value;
}
```

**启动流程**：server.js 在 `runMigrations()` 之后、`app.listen()` 之前 `await initConsciousnessGuard(pool)`。否则请求到达时 cache 未就绪。

### 2.3 Migration 240

```sql
-- 240_consciousness_setting.sql
INSERT INTO working_memory (key, value, created_at, updated_at)
VALUES ('consciousness_enabled',
        '{"enabled": true, "last_toggled_at": null}'::jsonb,
        NOW(), NOW())
ON CONFLICT (key) DO NOTHING;
```

已部署实例 memory 可能已存在（例如手动 set），`ON CONFLICT DO NOTHING` 保证幂等且不覆盖。

### 2.4 Brain API（`packages/brain/src/routes/settings.js`）

```js
import { Router } from 'express';
import pool from '../db.js';
import { getConsciousnessStatus, setConsciousnessEnabled } from '../consciousness-guard.js';

const router = Router();

router.get('/consciousness', (req, res) => {
  res.json(getConsciousnessStatus());
});

router.patch('/consciousness', async (req, res) => {
  const { enabled } = req.body;
  if (typeof enabled !== 'boolean') {
    return res.status(400).json({ error: 'enabled must be boolean' });
  }
  const status = await setConsciousnessEnabled(pool, enabled);
  res.json(status);
});

export default router;
```

挂接 server.js：`app.use('/api/brain/settings', settingsRoutes)`。

### 2.5 apps/api 代理

`apps/api/src/routes.ts`（或现有 Brain 透传所在文件）加两个代理端点：`/api/brain/settings/consciousness` GET/PATCH → fetch `localhost:5221` 透传。如果现有 proxy 是通用转发（捕获所有 `/api/brain/*`），则无需改动。实施时先 grep `localhost:5221` 确认模式。

### 2.6 Dashboard UI

**路由注册**（Cecelia Dashboard 是配置驱动）：
- 在 `InstanceContext.coreConfig.navGroups` 添加 nav item `{ path: '/settings', label: '设置', icon: Settings, component: 'SettingsPage' }`
- 在 `DynamicRouter` 的 component string → lazy import map 注册 `SettingsPage`
- **不要**在 `App.tsx` 里硬加 `<Route>`

**页面**（`apps/dashboard/src/pages/settings/SettingsPage.tsx`）：
- 顶部 Panel "意识开关"
- `<Switch>` 组件（如 shadcn/ui 不存在，用 BrainModelsPage.tsx 里已有的样式模式自建）
- 描述文字（on / off 两种状态）
- `last_toggled_at` 显示（友好格式 "X 分钟前"）
- `env_override === true` 时：Switch disabled + 红色 warning "Plist 强制关闭（CONSCIOUSNESS_ENABLED=false），需先 SSH 到主机 unset env 才能恢复 Dashboard 控制"
- 启动 useEffect 调 GET /api/brain/settings/consciousness，点击 Switch 调 PATCH

### 2.7 不需要改的（保持现状）

PR #2447 的其它产物（tick.js / server.js 现有守护、`scripts/check-consciousness-guard.sh`、`cecelia-watchdog.sh` SSOT）**不动**，因为：
- 所有守护块已经调用 `isConsciousnessEnabled()`，扩展优先级对调用方透明
- Research Subagent 已核对：守护清单的 5 个模块都是"每次查询" pattern，非启动一次性读取 → 热切换天然生效

## 3. 测试

### 3.1 Brain 单测
- `consciousness-guard.test.js` 扩展：
  - env=false 时 memory=true 仍返回 false（env override）
  - env 未设 + memory=false → 返回 false
  - env 未设 + memory=true → 返回 true
  - 默认（两者都未设）返回 true
  - `setConsciousnessEnabled(pool, false)` → cache 立即变、DB 写入、再调 `isConsciousnessEnabled()` 返回 false
  - `getConsciousnessStatus()` 包含 `env_override` 字段

### 3.2 Routes 单测（`routes/settings.test.js`）
- GET 返回 `{enabled, last_toggled_at, env_override}`
- PATCH body `{enabled: true}` 返回 200 + 新状态
- PATCH body `{enabled: "yes"}` 返回 400
- env_override=true 时 PATCH 仍返回 200（DB 写成功），但 GET 后 `enabled` 字段反映 env override

### 3.3 Integration（mock pool）
- setConsciousnessEnabled(false) 后跑 tick → `runRumination` 等 mock 0 调用
- setConsciousnessEnabled(true) 后跑 tick → 意识模块被调用

### 3.4 Dashboard（vitest + testing-library）
- SettingsPage 渲染后 fetch GET
- Switch 点击触发 PATCH
- env_override=true 时 Switch disabled + warning 可见

## 4. DoD

1. ✅ Brain 启动后 `SELECT value FROM working_memory WHERE key='consciousness_enabled'` 返回 `{enabled:true, last_toggled_at:null}`（或已存在的值）
2. ✅ `curl -X PATCH localhost:5221/api/brain/settings/consciousness -d '{"enabled":false}'` → 下一轮 tick（最多 2 分钟）意识类日志 0 输出
3. ✅ Dashboard `/settings` 页 Switch 点击 → Brain `isConsciousnessEnabled()` 立即改变（API 验证）
4. ✅ plist 设 `CONSCIOUSNESS_ENABLED=false` 时 GET `env_override: true` + Switch disabled
5. ✅ 所有新单测 + integration 全绿（≥15 新 tests）
6. ✅ ci.yml brain-unit / dashboard-test 通过
7. ✅ Brain 1.221.0，版本同步，DEFINITION.md §1.5 更新提到热切换
8. ✅ PR size 控制在 1500 行以内（吸取上次教训，docs 简洁）

## 5. 风险 & 缓解

| 风险 | 缓解 |
|---|---|
| async init 未完成就接收请求 | `await initConsciousnessGuard(pool)` 阻塞在 `app.listen` 前 |
| 并发 tick reload 覆盖 API 刚写的 cache | write-through 先更新 cache 后 reload，reload 读到最新值无副作用 |
| 前端 UI 误显示（env_override 状态错乱） | GET 响应包含 env_override 字段，UI 只显示不判断 |
| Migration 240 在已部署实例重跑覆盖手动 memory | `ON CONFLICT (key) DO NOTHING` |
| PR 过大再触发 pr-size-check | docs 简短（本 spec <400 行，plan 控制 <600 行） |

## 6. 不做（Phase 3+）

- 用户追踪 `toggled_by`（需 Brain 用户系统）
- 其它开关（MINIMAL_MODE / tick_enabled）放到同一设置页
- Audit log（切换历史表）
- 权限控制（super admin only）
