/**
 * LangGraph 修正 Sprint Stream 5: walking-skeleton-1node graph。
 *
 * 端到端实证最小图：spawn docker → interrupt(wait_callback) → finalize → END。
 *
 * 为什么需要：Layer 3 真实 spawn 重构会把 harness/dev/pipeline 节点改成 spawn-and-interrupt
 *   模式，而不是节点内 await 长任务。本 graph 是该模式的最小实证 — 1 节点 spawn alpine
 *   container（sleep 2 后 wget POST callback），1 节点 interrupt 等 callback router 用
 *   Command(resume) 唤回，1 节点写 task_events 标完成。
 *
 * 关键设计：
 *   1. spawn_node 幂等门：state.containerId 已存在则跳过（resume 后 graph 重跑同节点不能重 spawn）
 *   2. spawn 完立即 INSERT walking_skeleton_thread_lookup（containerId → thread_id），
 *      callback router 才能用 lookupHarnessThread 反查 graph 续跑
 *   3. await_callback_node 调 interrupt({type:'wait_callback'}) — graph yield，state 落 PG，
 *      caller invoke 立即返回（不阻塞）
 *   4. callback POST 到 /api/brain/harness/callback/:containerId → router 用
 *      Command({resume:{result,...}}) 唤回 → graph 从 await_callback 继续 → finalize_node 写 task_events
 *
 * Spec: docs/superpowers/specs/2026-05-08-langgraph-fix-walking-skeleton.md
 */
import { StateGraph, Annotation, START, END, interrupt } from '@langchain/langgraph';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import pool from '../db.js';

export const WalkingSkeletonState = Annotation.Root({
  triggerId:    Annotation({ reducer: (_o, n) => n, default: () => null }),
  containerId:  Annotation({ reducer: (_o, n) => n, default: () => null }),
  result:       Annotation({ reducer: (_o, n) => n, default: () => null }),
  finalized:    Annotation({ reducer: (_o, n) => n, default: () => false }),
  error:        Annotation({ reducer: (_o, n) => n, default: () => null }),
});

/**
 * spawn_node — 真 spawn 一个 alpine sibling container（共享 Brain 容器的 docker.sock）。
 *
 * 容器内做的事：sleep 2 → wget POST 到 callback router（host.docker.internal:5221）→ exit。
 * 我们这里 spawn 后立即 return，不等 container 跑完（spawn -d 后台跑）。
 *
 * 幂等：state.containerId 已设置则跳过 spawn（防止 graph resume 时重跑此节点导致重 spawn）。
 */
export async function spawnNode(state) {
  if (state.containerId) {
    return {}; // 幂等门：已 spawn 过
  }

  const containerId = `walking-skeleton-${randomUUID().slice(0, 8)}`;
  // 容器内 wget POST callback。
  // host.docker.internal: OrbStack/Docker Desktop 让 sibling container 访问宿主端口
  // busybox wget 支持 --post-data 但不支持 --header 多值，单 Content-Type 够用。
  const callbackUrl = `http://host.docker.internal:5221/api/brain/harness/callback/${containerId}`;
  const payload = JSON.stringify({ result: `hello-from-${containerId}`, exit_code: 0 });

  // 用 execFileSync + 数组 args 避免 shell escape 噩梦（payload 含 JSON 双引号）。
  // sh 脚本内部用单引号包 JSON（busybox sh 单引号字面量，不解释 $/"），sleep + wget。
  const shScript = `sleep 2 && wget -q -O- --post-data='${payload}' --header='Content-Type: application/json' '${callbackUrl}' 2>&1 || echo callback-failed`;

  try {
    execFileSync(
      'docker',
      ['run', '-d', '--rm', '--name', containerId, 'alpine', 'sh', '-c', shScript],
      { encoding: 'utf8', timeout: 10000 }
    );
  } catch (err) {
    return {
      error: { node: 'spawn', message: `docker spawn failed: ${err.message}` },
    };
  }

  // INSERT mapping（containerId → thread_id），callback router 用此反查
  // triggerId == thread_id（caller 在 trigger endpoint 用 randomUUID 生成）
  try {
    await pool.query(
      `INSERT INTO walking_skeleton_thread_lookup (container_id, thread_id, graph_name, status)
       VALUES ($1, $2, 'walking-skeleton-1node', 'spawning')
       ON CONFLICT (container_id) DO NOTHING`,
      [containerId, state.triggerId]
    );
  } catch (err) {
    // PG 写失败不阻塞 — 但记日志，e2e 会失败（callback router 找不到 thread）
    console.warn(`[walking-skeleton] thread_lookup INSERT failed: ${err.message}`);
  }

  return { containerId };
}

/**
 * await_callback_node — interrupt() yield，等 callback router 用 Command(resume=...) 唤回。
 *
 * resume 后 callbackPayload = {result, exit_code, error, stdout}（callback router POST body）。
 * 我们只取 result 字段塞进 state.result，下游 finalize 写 task_events。
 */
export async function awaitCallbackNode(state) {
  const callbackPayload = interrupt({
    type: 'wait_callback',
    containerId: state.containerId,
    triggerId: state.triggerId,
  });
  // resume 后这里继续执行
  const result = (callbackPayload && (callbackPayload.result ?? callbackPayload)) ?? null;
  return { result };
}

/**
 * finalize_node — 写 task_events 'walking_skeleton_done' 证明端到端跑通；
 * mark thread_lookup status=completed 让 status endpoint 能查到。
 *
 * 幂等：state.finalized=true 则跳过（防 graph 二次 invoke 重写 task_events）。
 */
export async function finalizeNode(state) {
  if (state.finalized) return {};

  // 写 task_events 表（task_id 字段是 UUID，triggerId 是 randomUUID 格式 OK）
  try {
    await pool.query(
      `INSERT INTO task_events (task_id, event_type, payload, created_at)
       VALUES ($1::uuid, 'walking_skeleton_done', $2, NOW())`,
      [
        state.triggerId,
        JSON.stringify({
          thread_id: state.triggerId,
          container_id: state.containerId,
          result: state.result,
        }),
      ]
    );
  } catch (err) {
    console.warn(`[walking-skeleton] task_events INSERT failed: ${err.message}`);
  }

  // 标 mapping resolved
  try {
    await pool.query(
      `UPDATE walking_skeleton_thread_lookup
       SET status='completed', resolved_at=NOW(), updated_at=NOW(), result=$1
       WHERE container_id=$2`,
      [JSON.stringify({ result: state.result }), state.containerId]
    );
  } catch (err) {
    console.warn(`[walking-skeleton] thread_lookup UPDATE failed: ${err.message}`);
  }

  return { finalized: true };
}

/**
 * 组装 graph（未 compile）。
 */
export function buildWalkingSkeleton1NodeGraph() {
  return new StateGraph(WalkingSkeletonState)
    .addNode('spawn', spawnNode)
    .addNode('await_callback', awaitCallbackNode)
    .addNode('finalize', finalizeNode)
    .addEdge(START, 'spawn')
    .addEdge('spawn', 'await_callback')
    .addEdge('await_callback', 'finalize')
    .addEdge('finalize', END);
}

// 模块级缓存：编译后的 graph（PG checkpointer 共享单例下，graph 也只编一次）。
let _compiled = null;
let _compilePromise = null;

/**
 * 拿编译过的 graph（用 PG checkpointer 持久化，brain 重启后也能 resume）。
 *
 * checkpointer 必须传 — 不传报错而不是 fallback memory（避免 silent 数据丢失）。
 *
 * 给 trigger endpoint + harness-thread-lookup 共用。
 */
export async function getCompiledWalkingSkeleton(checkpointer) {
  if (_compiled) return _compiled;
  if (_compilePromise) return _compilePromise;
  if (!checkpointer) {
    throw new Error('[walking-skeleton] checkpointer required (use getPgCheckpointer)');
  }
  _compilePromise = (async () => {
    const graph = buildWalkingSkeleton1NodeGraph();
    _compiled = graph.compile({ checkpointer });
    return _compiled;
  })();
  return _compilePromise;
}

/**
 * 测试 hook — 清编译缓存。生产代码禁止调。
 */
export function _resetCompiledForTests() {
  _compiled = null;
  _compilePromise = null;
}
