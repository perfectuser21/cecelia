# Brain Smoke Fix — License Route + Task-Router Status Design

**Goal:** 修复 feature registry 中 `license-management` 和 `task-route-diagnose` 两个 `smoke_status=failing` 的 feature，让它们变为 `passing`。

**Architecture:** 极简 stub 模式。两个 feature 的 smoke_cmd 指向不存在的 GET 端点；各加一个 < 10 行的无副作用 GET 端点，注册 license 路由，顺带将已有但未提交的 migration 248 纳入 PR。

**Tech Stack:** Node.js ESM, Express Router, vitest

---

## 变更清单

### 1. `packages/brain/src/routes/license.js`

在 router 定义后、第一个 admin 路由前，加 `GET /` 状态端点：

```javascript
router.get('/', (_req, res) => {
  res.json({ status: 'ok', tiers: Object.keys(TIER_CONFIG) });
});
```

### 2. `packages/brain/server.js`

在 `featuresRoutes` import/use 之后注册 license 路由：

```javascript
import licenseRoutes from './src/routes/license.js';
// ...
app.use('/api/brain/license', licenseRoutes);
```

### 3. `packages/brain/src/routes/task-router-diagnose.js`

在 `GET /diagnose/:kr_id` 之前加无参数版本：

```javascript
router.get('/diagnose', (_req, res) => {
  res.json({ status: 'ok', usage: 'GET /api/brain/task-router/diagnose/:kr_id' });
});
```

### 4. `packages/brain/migrations/248_license_system.sql`

已存在，纳入 PR 提交（Brain initDb 自动扫描运行）。

### 5. Smoke script

`packages/brain/scripts/smoke/smoke-fix-license-taskrouter.sh` 验证两个端点可访问。

---

## 测试策略

- `license-management` GET /：trivial wrapper（< 10 行，无 I/O）→ 1 unit test，验证返回 `{status, tiers}` 结构
- `task-route-diagnose` GET /diagnose：trivial wrapper → 1 unit test，验证返回 `{status, usage}` 结构
- 真环境验证：smoke.sh 在 CI `real-env-smoke` job 跑

## 成功标准

- `GET /api/brain/license` 返回 `{status: "ok", tiers: [...]}`，HTTP 200
- `GET /api/brain/task-router/diagnose` 返回 `{status: "ok", usage: "..."}`，HTTP 200
- CI 全绿（brain-unit + real-env-smoke）
- feature registry 中两条记录 `smoke_status` 从 `failing` 变 `passing`
