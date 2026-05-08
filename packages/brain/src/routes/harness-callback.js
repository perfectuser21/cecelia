/**
 * Harness Callback 路由 — LangGraph 修正 Sprint Stream 1
 *
 * Spec: docs/superpowers/specs/2026-05-08-langgraph-fix-callback-router.md
 *
 * 端点：
 *   POST /api/brain/harness/callback/:containerId
 *
 * 用途：cecelia-runner 容器跑完任务后 POST callback 到这里，本路由
 *   1) 用 containerId 反查 thread_id（lookupHarnessThread）
 *   2) `compiledGraph.invoke(new Command({resume: {result, error, exit_code, stdout}}),
 *       { configurable: { thread_id } })` 唤回 LangGraph
 *   3) 返回 200 表示已发起 resume；找不到 thread → 404；resume 抛错 → 500
 *
 * 注意：本 PR 的 lookupHarnessThread 是 stub（永远 null → 404），真实 mapping
 * 在 Layer 3 spawn 节点重构时插入。本 PR 只搭路由架子，CI 跑 unit + smoke 验证。
 */

import { Router } from 'express';
import { Command } from '@langchain/langgraph';
import { lookupHarnessThread } from '../lib/harness-thread-lookup.js';

const router = Router();

router.post('/harness/callback/:containerId', async (req, res) => {
  const { containerId } = req.params;
  const { result, error, exit_code, stdout } = req.body || {};

  if (result === undefined && !error) {
    return res.status(400).json({ ok: false, error: 'result or error required' });
  }

  // Lookup thread_id by containerId
  let lookup;
  try {
    lookup = await lookupHarnessThread(containerId);
  } catch (err) {
    console.error(`[harness-callback] lookup failed containerId=${containerId}: ${err.message}`);
    return res.status(500).json({ ok: false, error: `lookup: ${err.message}` });
  }

  if (!lookup) {
    console.warn(`[harness-callback] containerId ${containerId} 找不到对应 thread_id`);
    return res.status(404).json({ ok: false, error: 'thread not found for containerId' });
  }

  // Resume graph
  try {
    const { compiledGraph, threadId } = lookup;
    await compiledGraph.invoke(
      new Command({ resume: { result, error, exit_code, stdout } }),
      { configurable: { thread_id: threadId } }
    );
    return res.json({ ok: true, threadId, containerId });
  } catch (err) {
    console.error(`[harness-callback] graph resume failed containerId=${containerId}: ${err.message}`);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
