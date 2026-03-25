# Cecelia Monorepo

@docs/current/README.md

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
node packages/engine/scripts/devgate/check-dod-mapping.cjs  # DoD→Test 映射
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

---

## 7. Brain 知识查询工具（Claude 可直接调用）

对话开始时，可用以下接口感知当前状态，不需要用户告诉你：

```bash
# 推荐：一次获取全景摘要（OKR + 最近PR + 活跃任务 + 有效决策）
curl localhost:5221/api/brain/context

# OKR 进度树形结构（objectives → key_results）
curl localhost:5221/api/brain/okr/current

# 进行中任务
curl "localhost:5221/api/brain/tasks?status=in_progress&limit=10"

# 最近 PR 记录
curl "localhost:5221/api/brain/dev-records?limit=10"

# 有效决策
curl "localhost:5221/api/brain/decisions?status=active"

# 设计文档 / 日报
curl "localhost:5221/api/brain/design-docs?type=diary&limit=7"

# 知识库语义搜索
curl "localhost:5221/api/brain/memory/search" -X POST -H "Content-Type: application/json" -d '{"query":"xxx"}'
```

**使用规则**：
- 遇到不了解当前状态的问题时，优先调 `/api/brain/context` 而不是猜测
- 不要把 API 结果直接贴给用户，提炼成 1-3 句话回答

---

## 8. 任务完成后必须回写（CRITICAL）

PR 合并后，必须执行以下两件事：

**回写 Brain 任务状态**：
```bash
curl -X PATCH localhost:5221/api/brain/tasks/{task_id} \
  -H "Content-Type: application/json" \
  -d '{"status":"completed","result":{"pr_url":"...","merged":true}}'
```

**更新文档路由表**（如果本次 PR 改变了系统状态）：
- 巡检状态变了 → 更新 `docs/current/README.md` 的巡检表
- 新增了系统能力 → 更新 `docs/current/SYSTEM_MAP.md`
- 文档不用 /dev，直接改直接 commit

**不需要用户提醒**，这是每次任务结束的标准动作。
