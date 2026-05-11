/**
 * idempotency-guards.test.js — LangGraph 节点幂等门审计 [BEHAVIOR]
 *
 * 背景：LangGraph durable execution 节点重放（brain 重启从 checkpoint 恢复）会
 * 重新执行节点头部代码。JavaScript 没 @task 装饰器，必须每个 node function 入口
 * 加 `if (state.alreadyDone) return {};` 形式的 short circuit，避免副作用累积。
 *
 * 测试策略：源码级静态扫描 — 解析每个 node function 的前 30 行，检测是否含
 * 形如 `if (...) return {...}` 或 `if (...) { ... return {...} }` 的入口幂等门。
 *
 * 严格不动：
 *   - spawnGeneratorNode（A1 重构留给 Layer 3）—— 该节点本 sprint 不审
 *   - inferTaskPlanNode（已有 short circuit `existing.length >= 1`，被 Stream 3 改主体）
 *
 * Spec: docs/superpowers/specs/2026-05-08-langgraph-fix-sprint.md Stream 4
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GRAPH_FILE = resolve(__dirname, '../harness-initiative.graph.js');
const SOURCE = readFileSync(GRAPH_FILE, 'utf8');

/**
 * 提取一个 export node function 的函数体（不含 signature 行）。
 *
 * 实现：从 `export function ${name}` 起首截到下一个 `^export ` 或文件末尾。
 * 不做严格 brace counting（函数内含模板字符串/注释中的 `{` `}` 会误导计数）。
 * 这对"前 30 行扫 short circuit"足够，准确性 > 完美性。
 */
function getFunctionBody(src, name) {
  const sigRe = new RegExp(`^export (?:async )?function ${name}\\s*\\(`, 'm');
  const m = sigRe.exec(src);
  if (!m) return null;
  const start = m.index + m[0].length;
  // 找下一个 ^export 或下一个 ^function（顶层声明）作为终止
  const tailRe = /\n(?:export\s+|function\s+|const\s+|let\s+|var\s+|class\s+|\/\/\s*━+|\/\/\s*─+)/g;
  tailRe.lastIndex = start;
  const tailMatch = tailRe.exec(src);
  const end = tailMatch ? tailMatch.index : src.length;
  return src.slice(start, end);
}

/**
 * 检测函数体前 30 行内是否含入口 short circuit。
 * 接受形式：
 *   - `if (cond) return {...};`
 *   - `if (cond) { return {...}; }`
 *   - `if (cond) ... return {`（同行 brace 之间含其它）
 */
function hasEntryShortCircuit(body) {
  if (!body) return false;
  const head = body.split('\n').slice(0, 30).join('\n');
  // 同行匹配：if (...) ... return {
  const inlineRe = /if\s*\([^)]+\)\s*(?:\{[^}]*)?return\s*[{(]/;
  if (inlineRe.test(head)) return true;
  // 跨行匹配：if (...) {\n   return {  （宽松的多行 if-block）
  const multilineRe = /if\s*\([^)]+\)\s*\{\s*\n\s*[^\n]*return\s*[{(]/;
  return multilineRe.test(head);
}

// 节点清单 — 必须有入口幂等门（除豁免）
const NODES_NEED_GUARD = [
  'prepInitiativeNode',
  'runPlannerNode',
  'parsePrdNode',
  'runGanLoopNode',
  'dbUpsertNode',
  'runSubTaskNode',
  'joinSubTasksNode',
  'finalE2eNode',
  'reportNode',
  'pickSubTaskNode',
  'terminalFailNode',
  'finalEvaluateDispatchNode',
];

// 豁免：advance/retry 是 counter 节点，按设计每次 +1，不加 short circuit
// fanoutSubTasksNode 是 router（返 Send[]），fanoutPassthroughNode 直接 return {}（天然幂等）
const NODES_EXEMPT_COUNTER = ['advanceTaskIndexNode', 'retryTaskNode'];

describe('LangGraph 节点幂等门审计 [BEHAVIOR]', () => {
  for (const name of NODES_NEED_GUARD) {
    it(`${name} 入口含 short circuit 防止重放副作用`, () => {
      const body = getFunctionBody(SOURCE, name);
      expect(body, `节点 ${name} 必须存在`).not.toBeNull();
      expect(
        hasEntryShortCircuit(body),
        `节点 ${name} 必须在前 30 行内有 \`if (...) return {...}\` 入口幂等门`
      ).toBe(true);
    });
  }

  it('inferTaskPlanNode 已有 short circuit（Stream 3 不动）', () => {
    const body = getFunctionBody(SOURCE, 'inferTaskPlanNode');
    expect(body).not.toBeNull();
    // 现有的判断条件 `existing.length >= 1`
    expect(body).toMatch(/existing.*length\s*>=?\s*1/);
  });

  it('counter 节点 advance/retry 不加 short circuit（按设计每次 +1）', () => {
    for (const name of NODES_EXEMPT_COUNTER) {
      const body = getFunctionBody(SOURCE, name);
      expect(body, `${name} 必须存在`).not.toBeNull();
      // 必须含 +1 推进
      expect(body, `${name} 必须有 +1 counter 推进`).toMatch(/\+\s*1/);
    }
  });

  it('fanoutSubTasksNode router 返回 Send[]（不在 graph node 注册中，本审计豁免）', () => {
    expect(SOURCE).toContain('export function fanoutSubTasksNode');
    expect(SOURCE).toMatch(/new Send\(/);
  });

  it('spawnGeneratorNode 不存在或未被本 sprint 改动（A1 重构留给 Layer 3）', () => {
    // 该名字本 sprint 不引入也不改；写明意图 — 确保未被本 sprint 误碰
    const body = getFunctionBody(SOURCE, 'spawnGeneratorNode');
    // 当前代码不存在该节点；若以后 Layer 3 重构引入，本断言可放宽
    expect(body).toBeNull();
  });
});
