# B35 — Sprint Dir 从 Planner Verdict 提取（修复 B34 subdir scan 误读旧 sprint）

**日期**：2026-05-14  
**分支**：cp-0514151213-b35-sprint-dir-from-planner-verdict  
**关联**：修复 B34（#2954）引入的 subdir scan 缺陷

---

## 1. 问题背景

B34 在 `parsePrdNode`（harness-initiative.graph.js）和 `defaultReadContractFile`（harness-gan.graph.js）添加了 fallback subdir scan，当直接读取 `sprints/sprint-prd.md` 失败时扫描 `sprints/` 下的子目录。

**根本缺陷**：harness worktree 是从 `main` 克隆的完整 repo，`sprints/` 目录下存在所有历史 sprint 子目录（w19-playground-sum, w20-xxx, w21-xxx, ...）。`readdir` 按字母顺序返回，导致 `w19-playground-sum/sprint-prd.md` 先于当前 sprint 被找到，读取到错误内容。

W45 validation run（task f85c9c3f）验证了此问题：proposer 收到 `HARNESS_SPRINT_DIR=sprints`（而非正确的子目录路径），导致后续 GAN 找不到 contract 文件。

---

## 2. 修复方案

**核心思路**：planner skill 在其 verdict JSON 输出中已明确包含 `sprint_dir` 字段，直接解析使用，无需文件系统扫描。

### 修复点 1 — `InitiativeState` 添加 `sprintDir` 状态字段

`harness-initiative.graph.js` 的 `InitiativeState`（约 line 527）和 `FullInitiativeState`（约 line 765）均需添加：

```js
sprintDir: Annotation({ reducer: (_o, n) => n, default: () => null }),
```

### 修复点 2 — `parsePrdNode` 从 planner verdict 提取 sprint_dir

在读取文件前，先尝试从 `state.plannerOutput` 解析 verdict JSON：

```js
// B35: 从 planner verdict JSON 提取 sprint_dir（优先于文件系统扫描）
let sprintDir = state.task?.payload?.sprint_dir || 'sprints';
try {
  const verdict = JSON.parse(state.plannerOutput || '');
  if (verdict?.sprint_dir && typeof verdict.sprint_dir === 'string') {
    sprintDir = verdict.sprint_dir;
  }
} catch { /* plannerOutput 不是 JSON，继续用 payload 或默认值 */ }
```

`parsePrdNode` 的返回值增加 `sprintDir`，更新 state：
```js
return { taskPlan, prdContent, sprintDir };
```

### 修复点 3 — `runGanLoopNode` 优先使用 state.sprintDir

将：
```js
const sprintDir = state.task?.payload?.sprint_dir || 'sprints';
```
改为：
```js
const sprintDir = state.sprintDir || state.task?.payload?.sprint_dir || 'sprints';
```

### 修复点 4 — B34 subdir scan 保留为 last-resort fallback

B34 的 readdir 扫描作为防御性后备保留在 parsePrdNode 中，但仅在 planner verdict 提取失败且文件系统直接读取也失败时触发。**不删除**，作为 defense-in-depth 的最后一层。

---

## 3. 数据流

```
runPlannerNode
  → state.plannerOutput = '{"verdict":"DONE","sprint_dir":"sprints/w45-b34-verification",...}'

parsePrdNode
  → JSON.parse(state.plannerOutput) → sprint_dir = "sprints/w45-b34-verification"
  → readFile(worktreePath/sprints/w45-b34-verification/sprint-prd.md)  ← 直接命中
  → return { sprintDir: "sprints/w45-b34-verification", prdContent, taskPlan }

runGanLoopNode
  → sprintDir = state.sprintDir  // "sprints/w45-b34-verification"
  → runGanContractGraph({ sprintDir: "sprints/w45-b34-verification", ... })

defaultReadContractFile(worktreePath, "sprints/w45-b34-verification")
  → readFile(worktreePath/sprints/w45-b34-verification/contract-draft.md)  ← 直接命中
```

---

## 4. 测试策略

**分类**：行为类修复（Brain runtime，multi-module），使用 integration test。

- **集成测试** `packages/brain/src/workflows/__tests__/harness-initiative-b35.test.js`：
  - `parsePrdNode` + verdict JSON 含 `sprint_dir` → state.sprintDir 正确提取
  - `parsePrdNode` + verdict JSON 不含 `sprint_dir` → fallback 到 payload/default
  - `parsePrdNode` + plannerOutput 非 JSON → fallback graceful
  - `runGanLoopNode` 正确从 `state.sprintDir` 读取（单元级 mock）

- **smoke 脚本**（commit type 为 `fix:`，非 `feat:`，不强制需要 smoke.sh — 但已有 harness smoke 覆盖）

---

## 5. 不在范围内

- 修改 `harness-planner/SKILL.md`（planner 已正确输出 `sprint_dir`）
- 修改 `defaultReadContractFile` 的 B34 subdir scan（GAN 收到正确 sprintDir 后不再触发）
- 历史 sprint 目录清理（独立议题）
