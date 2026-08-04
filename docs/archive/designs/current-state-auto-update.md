# 方案设计：CURRENT_STATE.md 自动更新机制

> 调研日期：2026-03-29
> 任务：技术调研 — /dev Stage4 hook 机制 + CURRENT_STATE 方案
> Brain Task ID：0e1e4655-166f-453a-97c9-f07e9d823b77

---

## 1. Stage4 触发点分析

### 1.1 现有流程架构

```
用户会话结束
  └─ stop.sh (hooks/stop.sh v14.0.0)
        ├─ 发现 .dev-lock.<branch> → stop-dev.sh
        └─ stop-dev.sh
              ├─ 检测 cleanup_done: true → exit 0 (已完成，退出)
              └─ 调用 devloop-check.sh
                    ├─ PR 未合并 → exit 2 (继续循环)
                    └─ PR 合并成功 (gh pr merge)
                          ├─ 回调 Brain execution-callback (通知任务完成)
                          └─ return 0 (→ cleanup_done: true → exit 0)
```

### 1.2 关键代码位置（已验证）

| 文件 | 行号 | 作用 |
|------|------|------|
| `packages/engine/lib/devloop-check.sh` | ~489 | `gh pr merge` 执行 + Brain 回调 |
| `packages/engine/hooks/stop-dev.sh` | ~421 | 检测 `cleanup_done: true` → `exit 0` |
| `packages/engine/hooks/stop.sh` | ~79 | 普通对话结束 → `curl conversation-summary` |
| `packages/engine/skills/dev/steps/04-ship.md` | §4.4.5 | AI 手动执行 `write-current-state.sh` |

### 1.3 现有 Stage4.4.5 的局限性

`04-ship.md` §4.4.5 要求 AI 在 PR 合并后执行 `bash scripts/write-current-state.sh`，但：

- **依赖 AI 主动执行**：AI 可能遗漏或 context 压缩后跳过此步骤
- **时序不确定**：在 PR 合并 → cleanup 的链路中没有强制保证
- **无法被自动化**：`devloop-check.sh` 的自动合并路径不调用此脚本

### 1.4 推荐插入点：devloop-check.sh PR 合并成功后

**位置**：`packages/engine/lib/devloop-check.sh` 中 `gh pr merge` 成功后（目前在 Brain execution-callback 之后，return 0 之前）

```bash
# 当前代码（~line 512）
if gh pr merge "$pr_number" --squash --delete-branch 2>&1; then
    echo "[devloop-check] PR #$pr_number 已合并" >&2
    # ... Brain execution-callback ...

    # ← 新增：触发 CURRENT_STATE.md 更新（fire-and-forget）
    bash "${PROJECT_ROOT}/scripts/write-current-state.sh" 2>/dev/null || true

    _devloop_jq -n ... '{"status":"merged",...}'
    return 0
fi
```

**优点**：
- 自动触发，不依赖 AI
- 在 Brain 回调之后（确保最新任务状态已同步）
- 使用 `|| true` 不中断主流程
- `PROJECT_ROOT` 变量在 devloop-check.sh 中已定义

**备选点**：`stop-dev.sh` cleanup_done 分支（但 worktree 可能已被 cleanup 删除，不可靠）

---

## 2. Brain API 可用接口清单

以下接口已通过实际调用验证（`localhost:5221`）：

### 2.1 健康与状态

| 接口 | 返回字段 | 用途 |
|------|----------|------|
| `GET /api/brain/health` | `{status, alertness}` | Brain 是否运行 |
| `GET /api/brain/alertness` | `{level, levelName}` | 警觉等级（1-CALM ~ 5-CRITICAL） |

示例：
```bash
curl -s localhost:5221/api/brain/health
# → {"service":"cecelia-brain","status":"running",...}

curl -s localhost:5221/api/brain/alertness
# → {"level":1,"levelName":"CALM"}
```

### 2.2 任务

| 接口 | 返回字段 | 用途 |
|------|----------|------|
| `GET /api/brain/tasks?status=in_progress&limit=8` | `[{id, title, priority, task_type, payload}]` | 进行中任务 |
| `GET /api/brain/tasks?status=queued&limit=5` | `[{id, title, priority}]` | 排队中任务 |

### 2.3 开发记录（最近 PR）

| 接口 | 返回字段 | 用途 |
|------|----------|------|
| `GET /api/brain/dev-records?limit=5` | `[{pr_title, pr_url, branch, merged_at, self_score, ci_results}]` | 最近合并 PR |

示例返回字段：
```
id, task_id, pr_title, pr_url, branch, merged_at, ci_results, code_review_result, arch_review_result, self_score
```

### 2.4 OKR

| 接口 | 返回字段 | 用途 |
|------|----------|------|
| `GET /api/brain/okr/current` | `[{id, title, status, key_results:[...]}]` | 当前 OKR 树（5个 Objective） |

### 2.5 决策

| 接口 | 返回字段 | 用途 |
|------|----------|------|
| `GET /api/brain/decisions?status=active` | `[{title, description, created_at}]` | 有效决策列表 |

### 2.6 降级策略

所有 API 调用使用 `--max-time 5` + `|| echo "{}"` 降级，Brain 离线不中断流程（`write-current-state.sh` 已实现此模式）。

---

## 3. CURRENT_STATE.md 增强格式设计

### 3.1 现有格式（已在 `scripts/write-current-state.sh` 实现）

```markdown
## 系统健康
| Brain API | {status} |
| 警觉等级  | {level} - {name} |

## Capability Probe（能力链路探针）
> 最后探针时间: ... | 总计: N | ✅ 通过: N | ❌ 失败: N
表格

## 进行中任务
- [P0] 任务标题 (task_type)
```

### 3.2 建议增强字段

在 `write-current-state.sh` 中新增以下章节：

#### 新增：最近合并 PR（来自 dev-records API）

```markdown
## 最近合并 PR

| PR 标题 | 分支 | 合并时间 | 质量分 |
|---------|------|---------|--------|
| feat(brain): xxx | cp-03280xxx | 2026-03-28 18:00 | 4/5 |
```

**数据来源**：`GET /api/brain/dev-records?limit=3`
**字段映射**：`pr_title` / `branch` / `merged_at` / `self_score`

#### 新增：排队任务（来自 tasks API）

```markdown
## 排队中任务（Top 3）

- [P0] 开发 write-current-state.sh 脚本 (dev)
- [P0] /dev Stage4 集成 (dev)
```

**数据来源**：`GET /api/brain/tasks?status=queued&limit=3`

#### 可选增强：OKR 摘要

```markdown
## OKR 进度快照

- Cecelia 基础稳固：系统可信赖、自我修复 ▓▓▓░░ 60%
- ZenithJoy 内容流水线自动化 ▓▓░░░ 40%
```

**数据来源**：`GET /api/brain/okr/current`
**注意**：OKR progress 字段需要验证是否存在，避免空值

### 3.3 完整目标格式

```markdown
---
generated: 2026-03-29 09:00:00 CST
source: write-current-state.sh
---

# Cecelia 系统当前状态

> 由 `/dev` Stage 4 自动生成，每次 PR 合并后更新。

## 系统健康
| Brain API | healthy |
| 警觉等级  | 1 - CALM |

## Capability Probe
> 最后探针时间: 2026-03-28 12:03 UTC | ✅ 10/10

| 探针名 | 描述 | 状态 | 耗时 |
...

## 最近合并 PR

| 标题 | 分支 | 合并时间 | 质量分 |
...

## 进行中任务
- [P0] 任务A (dev)

## 排队中任务
- [P0] 任务B (dev)

---
> 要查最新状态：`curl localhost:5221/api/brain/health`
```

---

## 4. 后续任务实施路线

基于本调研，下游任务的实施顺序和关键点：

### 任务 1：增强 write-current-state.sh（Brain Task: 785eff90）

**修改点**：
- `scripts/write-current-state.sh` 新增 dev-records 查询（最近 3 PR）
- 新增 queued tasks 查询
- 可选：新增 OKR 摘要章节
- 时间戳格式改为上海时间

**关键注意**：
- `dev-records` 表的 `pr_title` 字段可能为 null（需 `// "?"` 防护）
- `merged_at` 是 UTC ISO 格式，需要转换为 CST 显示
- `self_score` 可能为 null

### 任务 2：Stage4 集成（Brain Task: 8e904219）

**修改点**：
- `packages/engine/lib/devloop-check.sh`：在 `gh pr merge` 成功后（Brain 回调之后）添加调用 `write-current-state.sh`
- 调用方式：`bash "${PROJECT_ROOT}/scripts/write-current-state.sh" 2>/dev/null || true`
- 不需要修改 stop.sh 或 stop-dev.sh

**Engine 版本 bump 要求**：
- 修改 devloop-check.sh 属于 Engine 代码变更
- 需要 bump 5 个文件（见 version-management.md）
- PR title 含 `[CONFIG]`

### 任务 3：CLAUDE.md 接入（Brain Task: 873cbbfa）

**修改点**：
- `.claude/CLAUDE.md` 的 `@` 引用列表增加 `@.agent-knowledge/CURRENT_STATE.md`
- 验证：新对话启动时 Claude 能读到 CURRENT_STATE.md 内容

**注意**：CLAUDE.md 中已有 `@docs/current/README.md` 等引用，格式一致即可。

### 任务 4：集成测试（Brain Task: de276f80）

**测试策略**：
- 不需要真实 PR 合并，可以直接调用 `write-current-state.sh` 验证输出格式
- 测试文件：`scripts/__tests__/write-current-state.test.ts`
- 验证 CURRENT_STATE.md 包含必要章节（系统健康/Probe/PR/任务）
- 验证 Brain 离线时降级为空章节（不 crash）

---

## 5. 风险与注意事项

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| `write-current-state.sh` 执行慢 | 延迟 PR 合并流程 | 已有 `--max-time 5` 限制 |
| DB 不可用（psql 失败） | Probe 章节为空 | 脚本已有 `|| echo ""` 降级 |
| Brain 离线 | 多章节为空 | 所有 curl 均有 `|| echo "{}"` 降级 |
| devloop-check.sh 调用失败 | `|| true` 保证不中断主流程 | 已在设计中体现 |
| dev-records 字段为 null | Python 解析报错 | 需要 `.get('field') or '?'` 防护 |
