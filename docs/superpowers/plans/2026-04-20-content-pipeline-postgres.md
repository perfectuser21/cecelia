# Content Pipeline PostgresSaver + onStep Schema Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 content pipeline LangGraph 路由的 state 和事件真正落盘到 Postgres（对齐 harness 已有模式）。

**Architecture:** 照抄 `packages/brain/src/executor.js:2821-2848` harness 模式。Runner 不动，只改 `routes/content-pipeline.js` 里 `/run-langgraph` handler 的两处：传入 PostgresSaver + 改 onStep SQL schema。

**Tech Stack:** Node.js + `@langchain/langgraph-checkpoint-postgres` + `pg` 连接池。

---

### Task 1: 修改 content-pipeline.js 的 /run-langgraph handler

**Files:**
- Modify: `packages/brain/src/routes/content-pipeline.js`（`POST /:id/run-langgraph` handler 的 async 异步块 L600-640）

- [ ] **Step 1：读现有 handler**

Run: `sed -n '560,670p' packages/brain/src/routes/content-pipeline.js`

Expected: 看到 `runContentPipeline(task, { onStep: ... })` 的调用 + 当前 onStep 用 `kind` 字段 INSERT。

- [ ] **Step 2：加 PostgresSaver 导入和初始化，传给 runContentPipeline**

替换 `(async () => { try { const result = await runContentPipeline(...)` 这段，加 PostgresSaver 初始化，并把 checkpointer 传入 opts：

```js
(async () => {
  try {
    // 仿 executor.js L2821-2825 harness 模式：Postgres checkpoint 持久化 state
    const { PostgresSaver } = await import('@langchain/langgraph-checkpoint-postgres');
    const checkpointer = PostgresSaver.fromConnString(
      process.env.DATABASE_URL || 'postgresql://cecelia@localhost:5432/cecelia'
    );
    await checkpointer.setup();  // 幂等建 checkpoints / checkpoint_blobs / checkpoint_writes

    const result = await runContentPipeline(
      {
        id,
        keyword,
        output_dir: outputDir,
        payload: { notebook_id: notebookId, ...payload },
      },
      {
        checkpointer,
        onStep: async (evt) => {
          // 仿 executor.js L2840-2844 harness 模式：cecelia_events 三列 schema
          try {
            await pool.query(
              `INSERT INTO cecelia_events (event_type, task_id, payload)
               VALUES ('content_pipeline_step', $1::uuid, $2::jsonb)`,
              [id, JSON.stringify({
                node: evt.node,
                step_index: evt.step_index,
                ...(evt.state_snapshot || {}),
              })],
            );
          } catch (err) {
            console.warn(`[content-pipeline] langgraph_step insert failed task=${id}: ${err.message}`);
          }
        },
      },
    );
    console.log(`[content-pipeline] run-langgraph 完成: pipeline=${id} steps=${result.steps}`);
  } catch (err) {
    console.error(`[content-pipeline] run-langgraph 失败: pipeline=${id} error=${err.message}`);
    await pool.query(
      `UPDATE tasks SET status = 'failed', completed_at = NOW() WHERE id = $1`,
      [id],
    ).catch(() => {});
  }
})();
```

关键点：
- 原 onStep 里 `kind` 字段 + `content-pipeline:step` event_type + `ON CONFLICT DO NOTHING` 全部替换
- 新 event_type = `content_pipeline_step`（跟 harness 的 `langgraph_step` 平行命名）
- payload 结构 = `{ node, step_index, ...state_snapshot }`（展开便于查询）

- [ ] **Step 3：语法检查**

Run: `cd packages/brain && node --check src/routes/content-pipeline.js`
Expected: 无输出（语法 OK）

- [ ] **Step 4：回归测试**

Run: `cd packages/brain && npx vitest run src/__tests__/content-pipeline-graph.test.js src/__tests__/content-pipeline-graph-docker.test.js src/__tests__/content-pipeline-graph-runner.test.js`
Expected: 43 tests passed（9 + 21 + 13）

- [ ] **Step 5：commit**

```bash
git add packages/brain/src/routes/content-pipeline.js docs/superpowers/specs/2026-04-20-content-pipeline-postgres-design.md docs/superpowers/plans/2026-04-20-content-pipeline-postgres.md
git commit -m "fix(content-pipeline): 路由加 PostgresSaver + 修 onStep SQL schema

照抄 executor.js L2821-2848 harness 模式。修之前：
- 无 checkpointer → 默认 MemorySaver → brain 重启 state 丢
- onStep INSERT 用 kind 字段但表只有 event_type → silent fail → DB 0 行

修后：
- PostgresSaver 持久化 checkpoint 到 Postgres 三张表
- onStep INSERT 走 event_type='content_pipeline_step' + task_id + payload 正确 schema

DB 验证证据：harness 同模式已累积 55 条 langgraph_step event + 3 个 thread checkpoint
生产运行；content pipeline 此前跑过 3 次但 cecelia_events 0 行、checkpoints 0 行。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

Expected: commit 创建成功。

---

## Self-Review（自查）

1. **Spec coverage:** ✅ 3 项改动（PostgresSaver init、checkpointer 传参、onStep SQL）全覆盖到 Step 2。
2. **Placeholder scan:** ✅ 无 TBD / TODO / "handle edge cases" 等虚词。
3. **Type consistency:** ✅ `PostgresSaver` / `cecelia_events(event_type, task_id, payload)` 跟 harness 同名同签。
4. **DoD 可验证:** ✅ 每步 Run + Expected 明确。
