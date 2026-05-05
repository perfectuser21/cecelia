// packages/brain/src/workflows/consciousness.graph.js
/**
 * Brain 意识层 StateGraph（Wave 2 LangGraph 改造）
 *
 * 4-node graph：thalamus → decision → rumination → plan_next_task
 * PG Checkpointer 实现步骤级崩溃恢复。
 * thread_id 由 consciousness-loop.js 管理（rotating consciousness:{epochMs}）。
 *
 * 节点内 catch 吞非致命异常并写 errors，保持与原 _doConsciousnessWork 容错语义一致。
 * rumination 节点 fire-and-forget：立即 push completed_steps，不等待 runRumination 完成。
 */
import { StateGraph, Annotation, START, END } from '@langchain/langgraph';
import { processEvent as thalamusProcessEvent, EVENT_TYPES } from '../thalamus.js';
import { generateDecision } from '../decision.js';
import { runRumination } from '../rumination.js';
import { planNextTask } from '../planner.js';
import { setGuidance } from '../guidance.js';
import { getPgCheckpointer } from '../orchestrator/pg-checkpointer.js';
import pool from '../db.js';

export const ConsciousnessState = Annotation.Root({
  completed_steps: Annotation({ reducer: (_, neu) => neu, default: () => [] }),
  errors:          Annotation({ reducer: (_, neu) => neu, default: () => [] }),
  // run_ts 由 consciousness-loop.js 在 fresh start 时注入（new Date().toISOString()），节点内不修改
  run_ts:          Annotation({ reducer: (_, neu) => neu, default: () => null }),
});

async function thalamusNode(state) {
  try {
    const tickEvent = {
      type: EVENT_TYPES.TICK,
      timestamp: new Date().toISOString(),
      has_anomaly: false,
    };
    const thalamusResult = await thalamusProcessEvent(tickEvent);
    const dispatchAction = thalamusResult.actions?.find(a => a.type === 'dispatch_task');
    if (dispatchAction?.task_id) {
      await setGuidance(
        `routing:${dispatchAction.task_id}`,
        { executor_type: 'cecelia_bridge', source: 'thalamus', level: thalamusResult.level },
        'thalamus',
        3600_000
      );
    }
    return {
      completed_steps: [...state.completed_steps, 'thalamus'],
      errors: state.errors,
    };
  } catch (err) {
    console.warn('[consciousness-graph] thalamus 失败（非致命）:', err.message);
    return {
      completed_steps: [...state.completed_steps, 'thalamus'],
      errors: [...state.errors, `thalamus: ${err.message}`],
    };
  }
}

async function decisionNode(state) {
  try {
    const decision = await generateDecision({ trigger: 'consciousness_loop' });
    if (decision.actions?.length > 0) {
      await setGuidance(
        'strategy:global',
        { decision_id: decision.decision_id, actions: decision.actions },
        'cortex',
        24 * 3600_000
      );
    }
    return {
      completed_steps: [...state.completed_steps, 'decision'],
      errors: state.errors,
    };
  } catch (err) {
    console.warn('[consciousness-graph] generateDecision 失败（非致命）:', err.message);
    return {
      completed_steps: [...state.completed_steps, 'decision'],
      errors: [...state.errors, `decision: ${err.message}`],
    };
  }
}

async function ruminationNode(state) {
  const RUMINATION_TIMEOUT_MS = 10 * 60 * 1000;
  Promise.resolve()
    .then(() =>
      Promise.race([
        runRumination(pool),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('rumination timeout')), RUMINATION_TIMEOUT_MS)
        ),
      ])
    )
    .catch(e => console.warn('[consciousness-graph] rumination 失败:', e.message));

  return {
    completed_steps: [...state.completed_steps, 'rumination'],
    errors: state.errors,
  };
}

async function planNextTaskNode(state) {
  try {
    const { rows } = await pool.query(
      `SELECT id FROM key_results WHERE status IN ('active', 'in_progress') LIMIT 5`
    );
    const krIds = rows.map(r => r.id);
    if (krIds.length > 0) {
      await planNextTask(krIds);
    }
    return {
      // 步骤标识用简写 'plan'，区别于 LangGraph 内部节点名 'plan_next_task'
      completed_steps: [...state.completed_steps, 'plan'],
      errors: state.errors,
    };
  } catch (err) {
    console.warn('[consciousness-graph] planNextTask 失败（非致命）:', err.message);
    return {
      // 步骤标识用简写 'plan'，区别于 LangGraph 内部节点名 'plan_next_task'
      completed_steps: [...state.completed_steps, 'plan'],
      errors: [...state.errors, `plan: ${err.message}`],
    };
  }
}

export function buildConsciousnessGraph() {
  return new StateGraph(ConsciousnessState)
    .addNode('thalamus', thalamusNode)
    .addNode('decision', decisionNode)
    .addNode('rumination', ruminationNode)
    .addNode('plan_next_task', planNextTaskNode)
    .addEdge(START, 'thalamus')
    .addEdge('thalamus', 'decision')
    .addEdge('decision', 'rumination')
    .addEdge('rumination', 'plan_next_task')
    .addEdge('plan_next_task', END);
}

let _compiled = null;
let _initPromise = null;

/**
 * 进程级单例：编译 graph + pg checkpointer。首次调用时 lazy init。
 * 使用 _initPromise 锁防止并发调用重复编译。
 * @returns {Promise<CompiledStateGraph>}
 */
export async function getCompiledConsciousnessGraph() {
  if (_compiled) return _compiled;
  if (!_initPromise) {
    _initPromise = (async () => {
      const checkpointer = await getPgCheckpointer();
      _compiled = buildConsciousnessGraph().compile({ checkpointer });
    })();
  }
  await _initPromise;
  return _compiled;
}

/** 测试 hook：重置单例。仅 __tests__ 使用。 */
export function _resetCompiledGraphForTests() {
  _compiled = null;
  _initPromise = null;
}
