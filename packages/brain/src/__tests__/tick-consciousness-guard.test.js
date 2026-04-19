import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TICK_PATH = path.resolve(__dirname, '../tick.js');

describe('tick consciousness guard - static source enforcement', () => {
  let src;

  beforeEach(() => {
    src = fs.readFileSync(TICK_PATH, 'utf8');
  });

  // 静态分析：确保每个意识模块调用前 50 行内有 isConsciousnessEnabled() 守护
  const guardedCalls = [
    'generateDailyDiaryIfNeeded',
    'runConversationDigest',
    'runCaptureDigestion',
    'runRumination',
    'collectSelfReport',
    'feedDailyIfNeeded',
    'runSynthesisSchedulerIfNeeded',
    'runSuggestionCycle',
    'runConversationConsolidator',
    'runDesireSystem',
    'scanEvolutionIfNeeded',
    'synthesizeEvolutionIfNeeded',
  ];

  for (const fn of guardedCalls) {
    test(`${fn} 调用点被 isConsciousnessEnabled() 守护`, () => {
      const lines = src.split('\n');
      const callLines = lines
        .map((l, i) => (l.includes(fn + '(') && !l.trim().startsWith('import') ? i : -1))
        .filter(i => i >= 0);

      expect(callLines.length, `期望至少 1 处 ${fn}() 调用`).toBeGreaterThan(0);

      for (const idx of callLines) {
        const context = lines.slice(Math.max(0, idx - 50), idx + 1).join('\n');
        expect(
          context,
          `${fn} 在 tick.js line ${idx + 1} 必须在 isConsciousnessEnabled() 守护块内（前 50 行）`
        ).toMatch(/isConsciousnessEnabled\(\)/);
      }
    });
  }

  test('evaluateEmotion 不被守护（纯函数，派发依赖）', () => {
    // 反向断言：evaluateEmotion 调用前后 3 行内不应有 isConsciousnessEnabled()
    // 因为 spec §3.4 明确排除在守护清单外
    const lines = src.split('\n');
    const callLines = lines
      .map((l, i) => (l.includes('evaluateEmotion(') && !l.trim().startsWith('import') ? i : -1))
      .filter(i => i >= 0);

    if (callLines.length === 0) return; // 可能未被当前调用

    for (const idx of callLines) {
      // 只检查紧邻 3 行范围（避免和其它守护块的 isConsciousnessEnabled 重合）
      const near = lines.slice(Math.max(0, idx - 3), Math.min(lines.length, idx + 3)).join('\n');
      expect(
        near,
        `evaluateEmotion line ${idx + 1} 不应被直接包裹在 isConsciousnessEnabled 守护里（破坏 dispatch_rate_modifier 派发链）`
      ).not.toMatch(/if\s*\(\s*isConsciousnessEnabled\(\)\s*\)\s*\{\s*[\r\n]+\s*evaluateEmotion/);
    }
  });
});
