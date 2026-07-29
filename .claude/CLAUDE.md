# Cecelia Monorepo

@docs/current/README.md
@.agent-knowledge/brain.md
@.agent-knowledge/engine.md
@.agent-knowledge/skills-index.md
@.agent-knowledge/CURRENT_STATE.md

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
node packages/quality/scripts/devgate/check-dod-mapping.cjs  # DoD→Test 映射
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

## 6. Shell Alias 配置（强推荐）

为让 Stop Hook 循环机制对**交互模式**也生效，用户 `~/.zshrc` 或 `~/.bashrc` 加：

```bash
alias claude='bash /Users/administrator/perfect21/cecelia/scripts/claude-launch.sh'
```

**原理**：`claude-launch.sh` 强制 `--session-id` + export `$CLAUDE_SESSION_ID`，让 `worktree-manage.sh` 能写正确的 owner_session，Stop Hook 能精确匹配 .dev-lock。

**不加 alias 的后果**：交互 claude 无 session_id → owner_session=unknown → Stop Hook 永远 mismatch → exit 0 放行 → assistant 中途退出 → /dev 循环失效。

Headless 模式（Brain 派）由 `cecelia-run.sh` 自动走 launcher，无需用户配置。

---

## 7. 禁止事项

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

## 8. 系统性问题记录到 Notion Issues

**触发条件**（满足其一即建 issue，不是每次 fix 都建）：
- 对话中发现某个地方被反复修（stop hook、evaluator、health check 等）
- 和用户商量后识别出设计缺陷或架构问题
- 同一根因导致多次 CI/pipeline 失败

**创建命令**：
```bash
node scripts/notion-create-issue.js \
  --title "<问题简述>" \
  --priority <P0|P1|P2|P3> \
  --sub-area <brain|engine|dashboard|zenithjoy|multi-agent> \
  --body "<根因描述>"
```

Sub Area 对应关系：`packages/brain/` → brain，`packages/engine/` → engine，
`apps/dashboard/`(Cecelia) → dashboard，`apps/api/`(ZenithJoy) → zenithjoy

**修复完成后**更新 issue 状态为 Closed，附 PR 链接。

---

## 9. 任务完成后必须回写（CRITICAL）

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

## 硬规则摘要（Hard Rules Summary — Codex/Grok 同步锚点）

> 本 section 是给非 Claude Code 执行体（Codex/Grok 等）的行为约束兜底摘要。
> 07-29 实测：codex exec 纯任务提示词下只原生读 AGENTS.md，不读本文件——AGENTS.md 里必须有一份同步副本。
> 与 `AGENTS.md` 里同名 section 逐字同步，由 `scripts/check-agents-rules-sync.sh` 校验，禁止手动改一边不改另一边。

<!-- HARD_RULES:BEGIN -->
### 语言
1. 所有输出必须使用简体中文，禁止日语、韩语或其他语言。

### 分支与提交
2. 绝对禁止 `git push origin main`。
3. 绝对禁止在 main 分支上 `git add` / `git commit`。
4. 分支策略：`cp-*` / `feature/*` 分支开发 → PR → main，不允许绕过。
5. push 后必须等待 CI 完成，禁止用 `gh pr merge --admin` 绕过 CI 检查。
6. commit message 遵循 Conventional Commits 格式（feat/fix/docs/chore/test/refactor/build/ci/style/perf/revert）。

### 危险操作确认
7. 网络配置变更、分区操作、`docker rm -f` 生产容器、数据库 schema 直改、`ufw deny 22` 等危险操作，必须先告知风险并获得明确确认后才能执行。

### Brain 改动门禁（DevGate）
8. 改动 `packages/brain` 代码前必须依次通过：`node scripts/facts-check.mjs`、`bash scripts/check-version-sync.sh`、`node packages/quality/scripts/devgate/check-dod-mapping.cjs`。
9. DevGate 校验失败时禁止继续编码，必须先修复校验问题。
10. 不允许凭记忆/猜测编造架构、跳过 DevGate、引用已废弃的旧路径。

### 任务追踪
11. 改代码走 `/dev` 流程（bug 修复 / 小改动 / 大功能三条路径）。
12. 任务生命周期状态通过 Brain API（`localhost:5221`）管理，不使用临时 ad-hoc 状态记录。

### 决策留痕
13. 用户做出的实质性决策必须写入 Brain `decisions` 表，不放进 memory 或 CLAUDE.md。

### 代码规范
14. 禁止创建 `*New.tsx` / `*Old.tsx` / `*Backup.*` 等临时版本文件。
15. 禁止在仓库根目录堆放临时脚本。
16. 不主动创建 markdown 文档，除非用户明确要求。
17. 单文件超过 500 行需拆分；同一段逻辑重复出现 3 次以上需提取为函数。
18. 完成任务后必须清理调试用的 `console.log`、注释掉的死代码、未使用的 import。

### Bug 修复流程
19. 修 bug 前必须先写一个能复现该 bug 的 failing test。
20. 该 failing test 修复后必须永久保留在 CI 里作为回归测试，不能删除。

### 验收标准
21. 功能验收必须验证真实产出效果（例如：视频类功能用 ffprobe 验证真实视频/音频流；数据写入类功能查数据库确认记录存在），不能仅凭"测试通过"这类空泛断言收尾。

### 凭据管理
22. API Key / Token / 密钥等凭据一律不提交进 git；`.gitignore` 必须排除 `.env` / `*.key` / `*.pem` 等敏感文件模式。

### AI 自我检测
23. 当输出中出现"手动/您可以/暂时禁用/等待用户/绕过/临时/跳过/忽略/先不管/稍后"这类推诿性措辞时，必须停下重新分析并自动解决问题，不能把困难推给用户。
<!-- HARD_RULES:END -->
