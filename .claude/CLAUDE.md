# Cecelia Monorepo

你的角色：
你是 Cecelia Monorepo 的开发代理（Claude Code）。这个仓库包含 Cecelia 系统的所有组件。

---

## 仓库结构

```
cecelia/
├── packages/
│   ├── brain/          # Brain 后端（调度/决策/保护，端口 5221）
│   ├── engine/         # 开发工作流引擎（hooks/skills/DevGate）
│   ├── quality/        # QA 基础设施
│   └── workflows/      # Agent 协议 + N8N 配置
├── apps/
│   ├── api/            # 前端 API 层（Workspace Core）
│   └── dashboard/      # React UI（Workspace Dashboard）
├── scripts/            # 共享脚本（DevGate、部署等）
├── DEFINITION.md       # Cecelia 系统定义（SSOT）
└── docker-compose.yml  # 开发环境
```

---

## 1. 绝对事实来源（SSOT）

唯一事实来源是代码本身：
- `packages/brain/src/server.js`（PORT、Brain 入口）
- `packages/brain/src/tick.js`（TICK_LOOP_INTERVAL_MS / TICK_INTERVAL_MINUTES）
- `packages/brain/src/thalamus.js`（ACTION_WHITELIST）
- `packages/brain/src/task-router.js`（LOCATION_MAP）
- `packages/brain/package.json`（version）
- `packages/brain/src/selfcheck.js`（EXPECTED_SCHEMA_VERSION）

不允许"凭记忆""猜测""从旧文档引用"。

---

## 2. DevGate（强制门禁）

改动 Brain 代码前必须通过：

```bash
node scripts/facts-check.mjs          # 校验 DEFINITION.md 与代码一致
bash scripts/check-version-sync.sh    # 校验版本四处同步
node scripts/devgate/check-dod-mapping.cjs  # DoD→Test 映射
```

---

## 3. 边界规则

### packages/brain（Brain 后端）
- 数据库、业务逻辑、API 端点、调度、决策
- 不做界面、不做可视化

### apps/（Workspace 前端）
- React 组件、页面、样式、用户交互
- API 调用层

### packages/engine（开发引擎）
- Hooks、Skills、DevGate 脚本、CI 工具
- 不是 Brain 的器官

### packages/quality（QA）
- 测试基础设施、回归契约

### packages/workflows（Agent 协议）
- Agent 配置、N8N 工作流、Skills SSOT

---

## 4. 架构

```
Brain (Node.js, port 5221)
+ Tick Loop (5s loop / 5min execute)
+ PostgreSQL (cecelia)
+ External Agents (Claude Code via bridge)
```

---

## 5. 提交规则

- 每个提交对应一个 Task
- Version bump 遵循 semver
- Brain 改动触发 brain-ci.yml
- Workspace 改动触发 workspace-ci.yml
- Engine 改动触发 engine-ci.yml

---

## 6. 禁止事项

- 不允许"估计" tick / action 数量
- 不允许编造架构
- 不允许跳过 DevGate（改 Brain 时）
- 不允许在 facts-check 失败时继续编码
- 不允许引用旧路径（cecelia/core/brain → 现在是 packages/brain）
