# Content Pipeline PostgresSaver + onStep Schema Fix

## 背景
`packages/brain/src/routes/content-pipeline.js` 的 `POST /:id/run-langgraph` handler：
- 未传 `checkpointer`，走默认 `MemorySaver` → Brain 重启 state 全丢
- `onStep` 回调 SQL 用 `kind` 字段但 `cecelia_events` 表 schema 是 `event_type` → INSERT 报错被 try/catch 吞 → silent fail

验证证据：content pipeline 跑过 3 次，`cecelia_events` 0 条、`checkpoints` 0 行。Harness 同架构跑 55 event + 3 thread 正常。

## 目标
照抄 `executor.js:2821-2848` harness 模式，让 content pipeline 的 state 和事件真正落盘。

## 改动

只改一个文件：`packages/brain/src/routes/content-pipeline.js`。

1. async 执行块顶部加 `PostgresSaver` 初始化：
   ```js
   const { PostgresSaver } = await import('@langchain/langgraph-checkpoint-postgres');
   const checkpointer = PostgresSaver.fromConnString(
     process.env.DATABASE_URL || 'postgresql://cecelia@localhost:5432/cecelia'
   );
   await checkpointer.setup();
   ```

2. `runContentPipeline(task, opts)` 传 `checkpointer`。

3. `onStep` 替换为 harness schema：
   ```js
   onStep: async (evt) => {
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
   ```
   删除原 `kind` 字段、`content-pipeline:step` event_type、`ON CONFLICT DO NOTHING`。

## 不改
- `content-pipeline-graph-runner.js`（runner 不动，只是调用方传新参数）
- `content-pipeline-graph.js`（graph 定义不动）
- 老 `/:id/run` 路径（orchestrator + Python worker 仍保留）

## DoD
- [ ] PostgresSaver 初始化调用存在于 run-langgraph handler
- [ ] runContentPipeline 调用传入 checkpointer 参数
- [ ] onStep SQL INSERT 使用 event_type / task_id / payload 三列
- [ ] 现有 43 tests 无回归（`npx vitest run src/__tests__/content-pipeline-graph*.test.js`）
- [ ] CI 通过
- [ ] 合并后手动验证：`SELECT COUNT(*) FROM cecelia_events WHERE event_type='content_pipeline_step'` > 0

## 验收
合并 + Brain 重启 + `CONTENT_PIPELINE_LANGGRAPH_ENABLED=true` + 跑一条 pipeline 后，`cecelia_events` 和 `checkpoints` 两表都能查到这条 pipeline 的记录。
