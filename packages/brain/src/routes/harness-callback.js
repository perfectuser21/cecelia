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
 * 幂等去重（P0 修复，2026-06-11）：
 *   现场（task ed860936）抓到 GAN proposer 节点被并发 spawn 5 个容器。根因：
 *   - runner(docker/cecelia-runner/entrypoint.sh) 对本回调用 `curl -m 10` + 5 次重试。
 *   - 本路由【同步】`await compiledGraph.invoke(resume)`，而 GAN proposer 是阻塞节点(B44)，
 *     spawn 容器后 await 数分钟才返回 → HTTP 10s 内无响应 → curl 超时 → runner 重试。
 *   - 本路由无幂等 → 每次重试都在【同一 thread_id】发起一次新的并发 resume → 每次都跑
 *     proposer 节点 spawn 一个相同 env 的容器（5 次重试 = 5 个并发容器，间隔 ~13-22s）。
 *   修复：每个 containerId 的回调最多 resume 一次。进程内 claim（Node 单线程，has()->set()
 *   之间无 await，check-and-set 原子，可挡并发重试）。重复回调直接 200 ack，不再 invoke。
 *   注：claim 是进程内态，curl 重试风暴是同进程内 ~70s 的事件，完全覆盖；Brain 重启后的
 *   resume 走 startup-sync checkpoint 路径（与 containerId 回调无关），不在本修复范围。
 */

import { Router } from 'express';
import { Command } from '@langchain/langgraph';
import { lookupHarnessThread } from '../lib/harness-thread-lookup.js';
import { sendBark } from '../notifier.js';
import pool from '../db.js';

const router = Router();

// relay 容器认证失败特征（Claude Code CLI 未登录/token 失效时的典型话术）。
// 只聚焦"未登录"这个具体信号，不做通用失败分类——那是 quarantine.js 的事，
// 且 quarantine.js 的分类路径本来就打不到 cecelia-relay-* 容器的 callback（见下方分支说明）。
const AUTH_FAILURE_PATTERN = /not\s+logged\s+in|please\s+run\s*\/?login/i;

// containerId 格式 cecelia-relay-<short8>-<suffix>（见 harness-skill-relay.js shortId）。
// 反查 task 标题给告警信息用；查不到就只带 containerId，不阻塞告警本身。
async function _lookupTaskTitleByContainerId(containerId) {
  const match = containerId.match(/^cecelia-relay-([a-f0-9]{8})-/);
  if (!match) return null;
  try {
    const { rows } = await pool.query(
      `SELECT id, title FROM tasks WHERE REPLACE(id::text, '-', '') LIKE $1 LIMIT 1`,
      [`${match[1]}%`]
    );
    return rows[0] || null;
  } catch (err) {
    console.warn(`[harness-callback] 反查任务标题失败（不影响告警本身）: ${err.message}`);
    return null;
  }
}

// containerId -> claimedAtMs。已 claim 的 containerId 的回调不再重入 resume。
const _claimedCallbacks = new Map();
const CLAIM_TTL_MS = 2 * 60 * 60 * 1000; // 2h，防无界增长（远超单次 pipeline + 重试窗口）

function _pruneClaims(nowMs) {
  for (const [cid, ts] of _claimedCallbacks) {
    if (nowMs - ts > CLAIM_TTL_MS) _claimedCallbacks.delete(cid);
  }
}

// 测试 hook：清空 claim 表
export function _resetCallbackDedupeForTests() {
  _claimedCallbacks.clear();
}

router.post('/harness/callback/:containerId', async (req, res) => {
  const { containerId } = req.params;
  const { result, error, exit_code, stdout } = req.body || {};

  if (result === undefined && !error) {
    return res.status(400).json({ ok: false, error: 'result or error required' });
  }

  // v1.0.1：skill-relay controller session（cecelia-relay-*）没有 thread_lookup（不走
  // LangGraph resume），直接 200 ack——否则 entrypoint 对 404 重试 5 次（~36s/session 白等）。
  // stdout 落盘由 entrypoint tee 完成，状态回写由 controller 的 report 步骤走 PATCH relay-runs。
  if (containerId.startsWith('cecelia-relay-')) {
    console.log(`[harness-callback] relay 容器 ${containerId} 回调 ack（exit=${exit_code ?? '?'}，无 resume）`);

    // 认证失败告警（catch 兜底——告警本身失败不能拖累原有 200 ack 行为）。
    // exit_code 未提供时不判定为失败——Number(undefined)===NaN，NaN!==0 恒真，会把"没传
    // exit_code 但 result/stdout 里恰好出现相关字样"误判成登录失效（例如日志回显场景）。
    const hasFailureExitCode = exit_code !== undefined && Number(exit_code) !== 0;
    const failureText = [result, error, stdout].filter(Boolean).join(' ');
    if (hasFailureExitCode && AUTH_FAILURE_PATTERN.test(failureText)) {
      try {
        const task = await _lookupTaskTitleByContainerId(containerId);
        const taskLabel = task ? `${task.title}（${task.id}）` : containerId;
        await sendBark(
          '⚠️ Harness session 登录失效',
          `${taskLabel} 的 relay session 因未登录崩溃，需要人工检查账号状态并可能重新登录`,
          { dedupeKey: `harness-auth-fail-${containerId}`, dedupeTtlSec: 3600 }
        );
      } catch (err) {
        console.error(`[harness-callback] 认证失败告警发送异常（不影响 ack）: ${err.message}`);
      }
    }

    return res.json({ ok: true, relayAck: true, containerId });
  }

  // 幂等 claim（同步 check-and-set，原子）：已 claim 过 = 重复回调（curl 重试 / 并发），
  // 直接 ack，绝不重入 resume（重入会重 spawn 容器 —— 正是本 P0 bug）。
  const nowMs = Date.now();
  _pruneClaims(nowMs);
  if (_claimedCallbacks.has(containerId)) {
    console.warn(`[harness-callback] containerId ${containerId} 回调重复（已在处理/已处理），跳过重 resume（幂等去重）`);
    return res.json({ ok: true, deduped: true, containerId });
  }
  _claimedCallbacks.set(containerId, nowMs);

  // Lookup thread_id by containerId
  let lookup;
  try {
    lookup = await lookupHarnessThread(containerId);
  } catch (err) {
    // 未进入 resume → 释放 claim，允许后续重试（可能是瞬时 PG 错）
    _claimedCallbacks.delete(containerId);
    console.error(`[harness-callback] lookup failed containerId=${containerId}: ${err.message}`);
    return res.status(500).json({ ok: false, error: `lookup: ${err.message}` });
  }

  if (!lookup) {
    // 未进入 resume → 释放 claim（404 重试无副作用；真未知容器只会再 404）
    _claimedCallbacks.delete(containerId);
    console.warn(`[harness-callback] containerId ${containerId} 找不到对应 thread_id`);
    return res.status(404).json({ ok: false, error: 'thread not found for containerId' });
  }

  // Resume graph。claim 已持有：invoke 期间/之后到达的重复回调都会被上面的 dedup 挡掉，
  // 即使 invoke 因 proposer 阻塞数分钟不返回，也只会有这一次 resume。
  try {
    const { compiledGraph, threadId } = lookup;
    await compiledGraph.invoke(
      new Command({ resume: { result, error, exit_code, stdout } }),
      { configurable: { thread_id: threadId } }
    );
    return res.json({ ok: true, threadId, containerId });
  } catch (err) {
    // 注意：invoke 抛错时【保留】claim —— resume 可能已 spawn 了容器，重试会重 spawn（本 bug）。
    // 卡住的 thread 交给 harness watchdog/patrol 恢复，回调侧坚持 at-most-once。
    console.error(`[harness-callback] graph resume failed containerId=${containerId}: ${err.message}`);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
