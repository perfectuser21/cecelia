import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync(new URL('../tick-runner.js', import.meta.url), 'utf8');
const guarded = [
  'generateDailyDiaryIfNeeded', 'runRumination', 'collectSelfReport', 'feedDailyIfNeeded',
  'runSynthesisSchedulerIfNeeded', 'runSuggestionCycle', 'runConversationConsolidator',
  'runDesireSystem', 'synthesizeEvolutionIfNeeded',
];

// 证明真实调用位于条件为真的语法分支，邻近注释/空if/else不能提供保护。
function callsIn(text, name) {
  const tree = ts.createSourceFile('tick.js', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  expect(tree.parseDiagnostics).toHaveLength(0);
  const calls = [];
  function walk(node) {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === name) {
      let protectedCall = false;
      for (let child = node, parent = node.parent; parent; child = parent, parent = parent.parent) {
        if (!ts.isIfStatement(parent) || parent.thenStatement !== child) continue;
        const condition = parent.expression;
        if (ts.isCallExpression(condition) && ts.isIdentifier(condition.expression)
          && condition.expression.text === 'isConsciousnessEnabled' && condition.arguments.length === 0) {
          protectedCall = true;
        }
      }
      calls.push(protectedCall);
    }
    ts.forEachChild(node, walk);
  }
  walk(tree);
  return calls;
}

describe('意识副作用的控制流保护', () => {
  it.each(guarded)('%s的全部真实调用位于启用分支', name => {
    const calls = callsIn(source, name);
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every(Boolean)).toBe(true);
  });

  it.each(['evaluateEmotion', 'scanEvolutionIfNeeded'])('%s按现行纯计算/非LLM政策保持可执行', name => {
    const calls = callsIn(source, name);
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every(value => !value)).toBe(true);
  });

  it('同一个保护块可以包含超过50行，也可包含异步回调', () => {
    expect(callsIn(`if (isConsciousnessEnabled()) { ${'\n'.repeat(60)} Promise.resolve().then(() => runRumination(pool)); }`, 'runRumination')).toEqual([true]);
  });

  it.each([
    'if (isConsciousnessEnabled()) {} runRumination(pool);',
    '// isConsciousnessEnabled()\nrunRumination(pool);',
    'if (isConsciousnessEnabled()) {} else { runRumination(pool); }',
    'if (!isConsciousnessEnabled()) { runRumination(pool); }',
  ])('空保护/注释/反向分支不能伪造已受保护：%s', text => {
    expect(callsIn(text, 'runRumination')).toEqual([false]);
  });
});
