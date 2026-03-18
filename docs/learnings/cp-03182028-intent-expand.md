# Learning: cp-03182028-intent-expand

## 任务概述

实现 `/intent-expand` skill，Brain 派发 `intent_expand` 任务时调用，沿 Task→Project→KR→OKR→Vision 层级链查询并生成 enriched PRD。

---

### 根本原因

此次任务是新增功能 skill，无历史 bug。关键发现记录如下。

---

### 实现中的发现

1. **Brain API 端点已就绪**：`/api/brain/tasks/:id`、`/api/brain/projects/:id`、`/api/brain/goals/:id` 均已在 `packages/brain/server.js` 挂载，无需改动 Brain 代码。

2. **goals 表层级结构**：goals 使用 `parent_id` 自引用构成树形结构，类型包括 `vision`（顶层）、`area_okr`（OKR层）等。projects 表通过 `kr_id` 指向 goals 表。

3. **bash-guard 的 SKILL.md 路径匹配**：`packages/(workflows|engine)/skills/` 路径下含 `SKILL.md` 的 bash 命令会被拦截。只有 head/cat/grep/diff 等只读命令才放行。在功能分支（cp-*）时放行所有操作，但 hook 执行时检测的是主进程 git 分支，不是 bash 命令的 cwd，导致 worktree 中的 bash 命令也被误拦截。

4. **branch-protect.sh 自动修正路径**：TaskCard 中 `packages/workflows/skills` 的路径被 hook 自动改成了 `packages/engine/skills`，因为 intent-expand 是引擎级 skill，属于 engine 包范围。

5. **DoD Test 格式**：`manual:node -e "..."` 命令中如果包含 SKILL_PATH_PATTERN 匹配字符串，bash-guard 会尝试拦截。实际在 CI 环境执行时不受 bash-guard 影响（CI 没有这个 hook）。

---

### 下次预防

- [ ] 在 worktree 环境下，包含 `SKILL.md` 字符串的 bash 验证命令会被 bash-guard 拦截。可用 grep/wc 等白名单命令替代，或通过文件系统工具（Read 工具）直接验证。
- [ ] 新建 skill 时先确认归属包（engine vs workflows），engine 放开发工具类 skill，workflows 放业务流程类 skill。
- [ ] intent-expand 是"基础设施"类 skill（服务于 Brain 两阶段审查流程），应放 `packages/engine/skills/`，而不是 `packages/workflows/skills/`。
