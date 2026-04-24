# C7 checkpointer singleton Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `executor.js` + `routes/content-pipeline.js` 共 3 处 inline `PostgresSaver.fromConnString(...) + setup()` 改走 `orchestrator/pg-checkpointer.js` 的 `getPgCheckpointer()` 幂等单例。

**Architecture:** 等价替换，保持原有 try/catch 结构。3 处各自独立编辑，无依赖关系。

**Tech Stack:** Node.js 20 ESM / `@langchain/langgraph-checkpoint-postgres`

---

## 文件结构

- Modify: `packages/brain/src/executor.js` — L2813-2821（harness_initiative）+ L2859-2863（harness_planner LangGraph）
- Modify: `packages/brain/src/routes/content-pipeline.js` — L625-629（POST /content-pipeline/run 异步分支）
- Create: `docs/learnings/cp-0424212248-brain-v2-c7-checkpointer-singleton.md`

## 前置验证

```bash
cd /Users/administrator/worktrees/cecelia/brain-v2-c7-checkpointer-singleton
pwd && git branch --show-current
test -d packages/brain/node_modules || (cd packages/brain && npm install)
```

---

### Task 1: 替换 executor.js 两处 PostgresSaver 调用

**Files:**
- Modify: `packages/brain/src/executor.js`

- [ ] **Step 1.1: 替换 L2813-2821（harness_initiative 分支）**

找到（精确匹配）：

```javascript
    let checkpointer;
    try {
      const { PostgresSaver } = await import('@langchain/langgraph-checkpoint-postgres');
      checkpointer = PostgresSaver.fromConnString(
        process.env.DATABASE_URL || 'postgresql://cecelia@localhost:5432/cecelia'
      );
      await checkpointer.setup(); // 幂等建 checkpoints / checkpoint_blobs / checkpoint_writes / checkpoint_migrations
    } catch (cpErr) {
      console.warn(`[executor] PostgresSaver 初始化失败，降级到 MemorySaver（Brain 重启将无法续跑）: ${cpErr.message}`);
      checkpointer = undefined; // 让 runGanContractGraph 走 MemorySaver fallback
    }
```

替换为：

```javascript
    let checkpointer;
    try {
      // C7: 走 orchestrator singleton（C1 建立），migration 244 表 + 幂等 setup 双保险
      const { getPgCheckpointer } = await import('./orchestrator/pg-checkpointer.js');
      checkpointer = await getPgCheckpointer();
    } catch (cpErr) {
      console.warn(`[executor] PostgresSaver 初始化失败，降级到 MemorySaver（Brain 重启将无法续跑）: ${cpErr.message}`);
      checkpointer = undefined; // 让 runGanContractGraph 走 MemorySaver fallback
    }
```

- [ ] **Step 1.2: 替换 L2859-2863（harness_planner LangGraph 分支）**

找到（精确匹配）：

```javascript
      // PostgresSaver: LangGraph 持久化 checkpointer（Brain 重启后从断点续跑，
      // 避免 43 分钟 pipeline 被重启清零。task.id 作为 thread_id 即为 resume key）
      const { PostgresSaver } = await import('@langchain/langgraph-checkpoint-postgres');
      const checkpointer = PostgresSaver.fromConnString(
        process.env.DATABASE_URL || 'postgresql://cecelia@localhost:5432/cecelia'
      );
      await checkpointer.setup();  // 幂等建 checkpoints / checkpoint_blobs / checkpoint_writes
```

替换为：

```javascript
      // C7: 走 orchestrator singleton（C1 建立），migration 244 表 + 幂等 setup 双保险
      // task.id 作为 thread_id 即为 resume key，Brain 重启后 pipeline 可从断点续跑
      const { getPgCheckpointer } = await import('./orchestrator/pg-checkpointer.js');
      const checkpointer = await getPgCheckpointer();
```

- [ ] **Step 1.3: node --check 冒烟**

```bash
cd /Users/administrator/worktrees/cecelia/brain-v2-c7-checkpointer-singleton
node --check packages/brain/src/executor.js && echo SYNTAX_OK
```

Expected: `SYNTAX_OK`（无 SyntaxError）。

- [ ] **Step 1.4: grep 自查**

```bash
grep -c "PostgresSaver.fromConnString" packages/brain/src/executor.js
```

Expected: `0`

```bash
grep -c "getPgCheckpointer" packages/brain/src/executor.js
```

Expected: `2`

---

### Task 2: 替换 routes/content-pipeline.js 一处 PostgresSaver 调用

**Files:**
- Modify: `packages/brain/src/routes/content-pipeline.js`

- [ ] **Step 2.1: 替换 L625-629**

找到（精确匹配）：

```javascript
        // Postgres checkpoint 持久化 state（仿 executor.js L2821-2825 harness 模式）
        // 避免 Brain 重启清零 state。task.id 作为 thread_id 即为 resume key。
        const { PostgresSaver } = await import('@langchain/langgraph-checkpoint-postgres');
        const checkpointer = PostgresSaver.fromConnString(
          process.env.DATABASE_URL || 'postgresql://cecelia@localhost:5432/cecelia'
        );
        await checkpointer.setup();  // 幂等建 checkpoints / checkpoint_blobs / checkpoint_writes
```

替换为：

```javascript
        // C7: 走 orchestrator singleton（C1 建立），migration 244 表 + 幂等 setup 双保险
        // task.id 作为 thread_id 即为 resume key，Brain 重启后 pipeline 可从断点续跑
        const { getPgCheckpointer } = await import('../orchestrator/pg-checkpointer.js');
        const checkpointer = await getPgCheckpointer();
```

**关键**：import 路径 `'../orchestrator/pg-checkpointer.js'`（多一层 `..`，因为 routes 在 src 子目录）。写成 `'./orchestrator/...'` 会 runtime `ERR_MODULE_NOT_FOUND`。

- [ ] **Step 2.2: node --check 冒烟**

```bash
cd /Users/administrator/worktrees/cecelia/brain-v2-c7-checkpointer-singleton
node --check packages/brain/src/routes/content-pipeline.js && echo SYNTAX_OK
```

Expected: `SYNTAX_OK`。

- [ ] **Step 2.3: grep 自查**

```bash
grep -c "PostgresSaver.fromConnString" packages/brain/src/routes/content-pipeline.js
```

Expected: `0`

```bash
grep -c "getPgCheckpointer" packages/brain/src/routes/content-pipeline.js
```

Expected: `1`

- [ ] **Step 2.4: 跨目录验证（所有 src 下零 inline call）**

```bash
grep -rn "PostgresSaver.fromConnString" packages/brain/src/ --include="*.js" | grep -v node_modules | grep -v __tests__ | grep -v pg-checkpointer.js
```

Expected: 空输出（只剩 pg-checkpointer.js 本身）。

---

### Task 3: 回归测试

- [ ] **Step 3.1: 跑 executor 相关测试**

```bash
cd /Users/administrator/worktrees/cecelia/brain-v2-c7-checkpointer-singleton/packages/brain
npx vitest run --reporter=dot src/__tests__/executor 2>&1 | tail -5
```

Expected: all passed (count depends on existing suite)。

- [ ] **Step 3.2: 跑 harness-initiative / content-pipeline 相关测试**

```bash
cd /Users/administrator/worktrees/cecelia/brain-v2-c7-checkpointer-singleton/packages/brain
npx vitest run --reporter=dot src/__tests__/harness 2>&1 | tail -5
npx vitest run --reporter=dot src/__tests__/content-pipeline 2>&1 | tail -5
```

Expected: all passed。

- [ ] **Step 3.3: 跑 pg-checkpointer / orchestrator 回归**

```bash
cd /Users/administrator/worktrees/cecelia/brain-v2-c7-checkpointer-singleton/packages/brain
npx vitest run --reporter=dot src/orchestrator/__tests__ 2>&1 | tail -5
```

Expected: all passed（C1 测试 8 cases）。

---

### Task 4: 写 Learning + 单 commit push

**Files:**
- Create: `docs/learnings/cp-0424212248-brain-v2-c7-checkpointer-singleton.md`

- [ ] **Step 4.1: 写 Learning**

```markdown
# C7 checkpointer singleton Learning

## 背景
Brain v2 Phase C7 —— 执行 handoff §3 定义的清理：移除 `executor.js` + `routes/content-pipeline.js` 共 3 处 inline `PostgresSaver.fromConnString(...) + setup()`，全部改走 C1 建立的 `orchestrator/pg-checkpointer.js` 单例 `getPgCheckpointer()`。消除重复 checkpointer 实例 + 统一走 Brain v2 L2 中央路径。

## 根本原因

C1 阶段建立 `orchestrator/pg-checkpointer.js` 作为统一单例入口，但 executor.js / content-pipeline.js 既有代码仍各自 inline 初始化，原因是 C1-C6 在推 `.graph.js` 搬家时没一并清理 caller 层面的重复。C7 的价值：(1) 三处共用同一 PostgresSaver 实例，节约连接池；(2) setup() 只执行一次（幂等 Promise 共享），避免并发 setup race；(3) 以后新增 graph 时统一路径，不出现第四处散建。

**import 路径相对层级陷阱**：`routes/content-pipeline.js` 在 `packages/brain/src/routes/` 下，必须用 `'../orchestrator/pg-checkpointer.js'`（多一层 `..`），而不是 `'./orchestrator/...'`。`node --check` 只查 syntax 不查 import 解析，错误要等 runtime 才爆。

## 下次预防

- [ ] 新增 `await import()` 相对路径前，先核对当前文件所在目录层级（`src/` vs `src/routes/` vs `src/orchestrator/`）
- [ ] C1 阶段建立新单例时，同 PR 内列出所有 caller 并清理，不留"etl tech-debt 下次再扫"
- [ ] grep 自查命令：`grep -rn "PostgresSaver.fromConnString" packages/brain/src/ --include="*.js" | grep -v node_modules | grep -v __tests__ | grep -v pg-checkpointer.js` 必须返回空，这是 DoD grep 等价
- [ ] 合并后 Brain redeploy 必做，验证 `docker exec cecelia-node-brain node -e "(async()=>{const{getPgCheckpointer}=await import('./src/orchestrator/pg-checkpointer.js');const cp=await getPgCheckpointer();console.log(cp.constructor.name)})()"` 返回 `PostgresSaver`

## 相关

- PR: 本 PR
- Handoff: `docs/design/brain-v2-c6-handoff.md` §3 C7 定义
- Design: `docs/superpowers/specs/2026-04-24-c7-checkpointer-singleton-design.md`
- Plan: `docs/superpowers/plans/2026-04-24-c7-checkpointer-singleton.md`
- Spec SSOT: `docs/design/brain-orchestrator-v2.md` §6
- Singleton source: `packages/brain/src/orchestrator/pg-checkpointer.js`（C1 #2583 建）
```

- [ ] **Step 4.2: Commit**

```bash
cd /Users/administrator/worktrees/cecelia/brain-v2-c7-checkpointer-singleton
git add packages/brain/src/executor.js packages/brain/src/routes/content-pipeline.js docs/learnings/cp-0424212248-brain-v2-c7-checkpointer-singleton.md
git commit -m "refactor(brain): C7 inline PostgresSaver setup → getPgCheckpointer 单例

3 处 inline call site 替换（handoff §3 scope）：
- executor.js:2813-2821 harness_initiative 分支（保留 try/catch 降级）
- executor.js:2859-2863 harness_planner LangGraph 分支（裸调，保留原语义）
- routes/content-pipeline.js:625-629（import 路径 ../orchestrator/ 注意相对层级）

统一走 C1 建立的 orchestrator/pg-checkpointer.js 幂等单例，消除重复实例。
setup() 由 singleton 内部调一次，_setupPromise 防并发 race。

Brain task: 255fc546-4972-4af2-9d67-4c33d54389f5

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**1. Spec coverage:**
- Design §2.1/2.2 executor 两处 → Task 1 step 1.1 + 1.2 ✅
- Design §2.3 content-pipeline 一处 → Task 2 step 2.1 ✅
- Design §4 测试策略（回归，不新增单测）→ Task 3 ✅
- Design §5 DoD 三条 grep → Task 1/2 grep 自查 + Task 2 跨目录验证 ✅
- Design §6 风险 import 路径陷阱 → Task 2 step 2.1 明确写 `../orchestrator/` ✅
- Design §7 单 commit → Task 4 step 4.2 ✅
- 对齐 handoff §3 C7 scope（1h ~80 行）→ 本 plan 保守估计 ~30 行改动 + 30 行 learning ✅

**2. Placeholder scan:** 无 TBD / TODO / "similar to"，所有代码块含完整 before/after。

**3. Type consistency:** `getPgCheckpointer()` 签名一致（`Promise<PostgresSaver>`），3 处返回值都立即赋给 `checkpointer` 局部变量，类型兼容原 `PostgresSaver` 实例。

无需 fix。

---

## 执行方式

/dev autonomous Tier 1 默认 subagent-driven；但本 PR 仅 3 处等价替换（~30 行），inline 执行更合适（避免 C6 subagent 新开分支教训）。**决定：inline 执行**，单会话一次性完成 Task 1-4，最后跑回归 + push。
