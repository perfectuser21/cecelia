# Hotfix: inferTaskPlanNode 加 git fetch 防 origin tracking 落后

**日期**: 2026-05-08
**触发事件**: W8 v4 task 5eb2718b fail at inferTaskPlan，origin 上有目标分支但 brain git show 找不到
**类型**: P0 hotfix（生产阻塞，多 in-flight harness pipeline 受影响）

---

## 背景与实证

PR #2837（已合）修了 SKILL stdout verdict JSON + fallback 命名格式。W8 v4 fallback 名 `cp-harness-propose-r3-5eb2718b` 跟 origin 实际 push 名**完全匹配**，#2837 修复正确生效。

但 brain 容器内 inferTaskPlan 跑：
```javascript
git show origin/cp-harness-propose-r3-5eb2718b:sprints/w8-langgraph-v4/task-plan.json
→ fatal: invalid object name
```

实际 origin 上：
```
$ git ls-remote origin cp-harness-propose-r3-5eb2718b
5b035a5abcd48b54  refs/heads/cp-harness-propose-r3-5eb2718b ✓
```

**根因**：proposer 在另一个 docker 容器（task container）里 `git push origin <branch>`，brain 容器自己的本地 git 库 origin tracking 不会自动更新。`inferTaskPlanNode` 直接 `git show origin/X` **没主动 fetch**，所以拿不到 task container 那边新 push 的分支。

## 候选方案

### 方案 A：节点内 git show 前置 git fetch ★ 推荐
在 `inferTaskPlanNode` 函数体内，git show 之前加 `execSync('git fetch origin ${proposeBranch}')`。fetch 失败（如分支真的不存在）graceful warn 不阻塞，让原 `git show` catch 报具体错。

- **优点**：单点修复，最小侵入，5 行代码
- **缺点**：未来其他节点（generator/evaluator）可能也有同问题，要分别修

### 方案 B：抽 git 操作 helper 强制 fetch-then-show
做一个 `gitShowOriginBranch(worktreePath, branch, file)` helper，内部强制 fetch+show。所有节点改用 helper。

- **优点**：防御所有节点的同问题
- **缺点**：超出 hotfix 范围，需要改多个文件，回归风险大

### 方案 C：上层 graph 加一个 fetch 节点
在 graph 里 inferTaskPlan 之前插入一个 `fetchOrigin` 节点。

- **优点**：节点职责单一
- **缺点**：graph 拓扑改动大，影响 LangGraph state 流转，hotfix 范围爆炸

**选 A**：hotfix 必须最小侵入快速 ship。方案 B 是 follow-up 架构 sprint 的事（[Cecelia Harness Pipeline Journey](https://www.notion.so/Cecelia-Harness-Pipeline-35ac40c2ba6381dba6fbf0c3cb4f1ad4) 的 thin features 应该处理）。

---

## 设计

### 改动单元

**仅 1 个文件**：`packages/brain/src/workflows/harness-initiative.graph.js`

inferTaskPlanNode 函数 line 826-848 范围：

```diff
 try {
   const { execSync } = await import('child_process');
+  // 防御：proposer 在另一个 docker 容器 git push 后，brain 容器本地 origin 落后
+  // 主动 fetch 该分支再 show；fetch 失败 graceful warn 让下面 show 的 catch 报具体错
+  try {
+    execSync(`git fetch origin ${proposeBranch}`, {
+      cwd: state.worktreePath,
+      encoding: 'utf8',
+      stdio: 'pipe',
+    });
+  } catch (fetchErr) {
+    console.warn(`[infer_task_plan] git fetch origin ${proposeBranch} failed: ${fetchErr.message?.slice(0, 200)}, continuing to git show`);
+  }
   const json = execSync(
     `git show origin/${proposeBranch}:${sprintDir}/task-plan.json`,
     { cwd: state.worktreePath, encoding: 'utf8' }
   );
   // ... 原有逻辑不动
 } catch (err) {
   const msg = `[infer_task_plan] git show origin/${proposeBranch}:${sprintDir}/task-plan.json failed: ${err.message}`;
   console.error(msg);
   return { error: msg };
 }
```

### 数据流（修复后）

```
Round N proposer SKILL → git push origin cp-harness-propose-rN-XXX (在 task container)
   ↓
graph proposer node 完成，state.proposeBranch = "cp-harness-propose-rN-XXX"
   ↓
inferTaskPlanNode（在 brain container）
   ├─ git fetch origin cp-harness-propose-rN-XXX  (新增 — 同步本地 origin tracking)
   └─ git show origin/cp-harness-propose-rN-XXX:sprints/.../task-plan.json  (能命中)
   ↓
state.taskPlan = parseTaskPlan(json)
```

### 错误处理

| 场景 | 行为 |
|---|---|
| fetch 成功 + show 成功 | 正常路径 |
| fetch 失败（如分支真的不存在） | warn 一行，继续 show；show 报原错（git show 的错最具体）|
| fetch 成功 + show 解析失败 | 走原有 parseTaskPlan catch 流程 |

---

## 测试策略（dev skill 测试金字塔分类）

| 测试类型 | 目标 | 文件 |
|---|---|---|
| **Unit** | mock execSync 验证 call order：fetch 在 show 之前；fetch 失败时 graceful warn 不阻塞 | `packages/brain/src/workflows/__tests__/infer-task-plan-fetch.test.js` |
| **Smoke (E2E)** | 真 git 库跑：mock 一个 `git push origin testbranch` → inferTaskPlan node 调用后能 git show 到内容 | `packages/brain/scripts/smoke/infer-task-plan-fetch-smoke.sh` |

**为什么 smoke 必要**：
- 单元测试 mock execSync 只验证 call order，看不到真实 git 行为
- 真实场景跨 process（task container push, brain container fetch），mock 看不出来
- smoke.sh 起真 git → 真 push → 真 fetch → 真 show，覆盖完整链路

---

## Version bump

- `packages/brain/package.json` + `package-lock.json`：1.228.4 → 1.228.5

---

## 不做（明确范围）

- 不扩散修复别的节点（generator/evaluator/fanout 可能也有同问题）—— 留给 [Cecelia Harness Pipeline Journey](https://www.notion.so/Cecelia-Harness-Pipeline-35ac40c2ba6381dba6fbf0c3cb4f1ad4) 长治 sprint
- 不做 git 操作的 helper 抽象（方案 B）
- 不动 PR #2837 已修的 SKILL/fallback
- 不动 docker-compose.yml 任何 env

---

## 验证（PR 合并 + brain redeploy 后）

1. 重启 Sprint 2.1a (969f7f8e) 或重新跑 W8 acceptance task
2. 期待：graph 推过 inferTaskPlan 进入 fanout / run_sub_task 阶段
3. 如果在 fanout / dbUpsert / final_evaluate 又 fail，那是另一个 bug，单独修

---

## 关联

- 上一轮 PR #2837：propose_branch SKILL/fallback 协议双修
- 长治 sprint（待启动）：Cecelia Harness Pipeline Journey 6 个 thin feature 实现，从根本上避免一个一个节点修
