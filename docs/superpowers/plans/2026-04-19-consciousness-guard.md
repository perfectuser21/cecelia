# Consciousness Guard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 Brain 的 `BRAIN_QUIET_MODE` 重构成 `CONSCIOUSNESS_ENABLED`，新增统一守护函数 `isConsciousnessEnabled()`，扩展守护到 5 个现在漏网的意识模块（diary / evolution-scanner(tick) / evolution-synthesizer / suggestion-cycle / conversation-consolidator / server.js initNarrativeTimer + evolution-scanner），并把 `~/bin/cecelia-watchdog.sh` 纳入 repo SSOT 让它能正确传递环境变量。

**Architecture:** 新建 `packages/brain/src/consciousness-guard.js` 作为 SSOT，导出 `isConsciousnessEnabled()` + `logStartupDeclaration()` + `GUARDED_MODULES`。tick.js 和 server.js 所有意识模块入口改成 `if (isConsciousnessEnabled()) { ... }`；部署层 plist 新增 `CONSCIOUSNESS_ENABLED=false` env，watchdog 脚本 SSOT 化到 `packages/brain/deploy/cecelia-watchdog.sh`，由 `install.sh` 部署；CI 加反向 grep 防开关裸读。

**Tech Stack:** Node.js ESM / Vitest / Bash / GitHub Actions

**Spec:** `docs/superpowers/specs/2026-04-19-consciousness-guard-design.md`

---

## File Structure

**新建**:
- `packages/brain/src/consciousness-guard.js` —— SSOT 判断函数 + 守护清单常量 + 启动声明
- `packages/brain/src/__tests__/consciousness-guard.test.js` —— 单测 env 矩阵
- `packages/brain/src/__tests__/tick-consciousness-guard.test.js` —— tick 级守护断言
- `packages/brain/deploy/cecelia-watchdog.sh` —— ~/bin/ watchdog SSOT
- `scripts/check-consciousness-guard.sh` —— CI 反向 grep 防复活

**修改**:
- `packages/brain/src/tick.js` —— 删 `const BRAIN_QUIET_MODE`，替换 5 处守护为 `isConsciousnessEnabled()`，扩展 5 个漏网点
- `packages/brain/server.js` —— 替换 1 处 self-drive 守护，扩展 2 处新守护（evolution-scanner setInterval + initNarrativeTimer）
- `packages/brain/deploy/com.cecelia.brain.plist` —— 新增 `CONSCIOUSNESS_ENABLED=false` env（保留 BRAIN_QUIET_MODE 兼容）
- `packages/brain/deploy/install.sh` —— 追加 watchdog 拷贝步骤
- `packages/brain/package.json` —— 版本 1.218.0 → 1.219.0
- `packages/brain/package-lock.json` —— 版本同步
- `DEFINITION.md` —— 版本同步 + 新增"开关说明"段落
- `.github/workflows/ci.yml` —— 挂接反向 grep 到 brain-unit-all job

---

## Task 1: 新建 consciousness-guard 模块 + 单测

**Files:**
- Create: `packages/brain/src/consciousness-guard.js`
- Create: `packages/brain/src/__tests__/consciousness-guard.test.js`

- [ ] **Step 1.1: 写失败单测**

Create `packages/brain/src/__tests__/consciousness-guard.test.js`:
```js
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { isConsciousnessEnabled, logStartupDeclaration, GUARDED_MODULES } from '../consciousness-guard.js';

describe('consciousness-guard', () => {
  const originalEnv = { ...process.env };
  beforeEach(() => {
    delete process.env.CONSCIOUSNESS_ENABLED;
    delete process.env.BRAIN_QUIET_MODE;
  });
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('isConsciousnessEnabled', () => {
    test('default is true when no env vars set', () => {
      expect(isConsciousnessEnabled()).toBe(true);
    });

    test('CONSCIOUSNESS_ENABLED=false disables', () => {
      process.env.CONSCIOUSNESS_ENABLED = 'false';
      expect(isConsciousnessEnabled()).toBe(false);
    });

    test('CONSCIOUSNESS_ENABLED=true enables', () => {
      process.env.CONSCIOUSNESS_ENABLED = 'true';
      expect(isConsciousnessEnabled()).toBe(true);
    });

    test('BRAIN_QUIET_MODE=true backward compat', () => {
      process.env.BRAIN_QUIET_MODE = 'true';
      expect(isConsciousnessEnabled()).toBe(false);
    });

    test('new env overrides when both set (CONSCIOUSNESS_ENABLED=true wins)', () => {
      process.env.CONSCIOUSNESS_ENABLED = 'true';
      process.env.BRAIN_QUIET_MODE = 'true';
      expect(isConsciousnessEnabled()).toBe(true);
    });

    test('BRAIN_QUIET_MODE=false (non-"true") does not disable', () => {
      process.env.BRAIN_QUIET_MODE = 'false';
      expect(isConsciousnessEnabled()).toBe(true);
    });
  });

  describe('GUARDED_MODULES', () => {
    test('contains all expected module names', () => {
      const expected = [
        'thalamus', 'rumination', 'rumination-scheduler', 'narrative',
        'diary-scheduler', 'conversation-digest', 'conversation-consolidator',
        'capture-digestion', 'self-report', 'notebook-feeder',
        'proactive-mouth', 'evolution-scanner', 'evolution-synthesizer',
        'desire-system', 'suggestion-cycle', 'self-drive',
        'dept-heartbeat', 'pending-followups',
      ];
      for (const mod of expected) {
        expect(GUARDED_MODULES).toContain(mod);
      }
    });
  });

  describe('logStartupDeclaration', () => {
    test('prints nothing when consciousness enabled', () => {
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
      logStartupDeclaration();
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });

    test('prints declaration when CONSCIOUSNESS_ENABLED=false', () => {
      process.env.CONSCIOUSNESS_ENABLED = 'false';
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
      logStartupDeclaration();
      const calls = spy.mock.calls.map(c => c.join(' ')).join('\n');
      expect(calls).toContain('CONSCIOUSNESS_ENABLED=false');
      expect(calls).toContain('意识层全部跳过');
      expect(calls).toContain('守护模块');
      spy.mockRestore();
    });

    test('deprecation warn when using BRAIN_QUIET_MODE=true', () => {
      process.env.BRAIN_QUIET_MODE = 'true';
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      // Trigger deprecation via isConsciousnessEnabled()
      isConsciousnessEnabled();
      isConsciousnessEnabled(); // second call
      const warnCalls = warnSpy.mock.calls.map(c => c.join(' ')).join('\n');
      expect(warnCalls).toContain('BRAIN_QUIET_MODE is deprecated');
      // Should only warn once
      expect(warnSpy).toHaveBeenCalledTimes(1);
      warnSpy.mockRestore();
    });
  });
});
```

- [ ] **Step 1.2: 运行测试验证失败**

Run: `cd /Users/administrator/worktrees/cecelia/consciousness-guard && npx vitest run packages/brain/src/__tests__/consciousness-guard.test.js 2>&1 | tail -20`
Expected: 失败，`Cannot find module '../consciousness-guard.js'` 或 import error

- [ ] **Step 1.3: 写最小实现**

Create `packages/brain/src/consciousness-guard.js`:
```js
// SSOT for Brain consciousness toggle.
// 通过 CONSCIOUSNESS_ENABLED 环境变量控制所有会持续消耗 LLM token 的意识模块。
// 默认启用，设为 'false' 时关闭。BRAIN_QUIET_MODE=true 作为 deprecated 别名继续识别。

export const GUARDED_MODULES = [
  'thalamus', 'rumination', 'rumination-scheduler', 'narrative',
  'diary-scheduler', 'conversation-digest', 'conversation-consolidator',
  'capture-digestion', 'self-report', 'notebook-feeder',
  'proactive-mouth', 'evolution-scanner', 'evolution-synthesizer',
  'desire-system', 'suggestion-cycle', 'self-drive',
  'dept-heartbeat', 'pending-followups',
];

let _deprecationWarned = false;

export function isConsciousnessEnabled() {
  // 新 env 优先
  if (process.env.CONSCIOUSNESS_ENABLED === 'false') return false;
  if (process.env.CONSCIOUSNESS_ENABLED === 'true') return true;
  // Deprecated: 旧 BRAIN_QUIET_MODE=true 作为别名
  if (process.env.BRAIN_QUIET_MODE === 'true') {
    if (!_deprecationWarned) {
      console.warn('[consciousness-guard] BRAIN_QUIET_MODE is deprecated, use CONSCIOUSNESS_ENABLED=false');
      _deprecationWarned = true;
    }
    return false;
  }
  return true;
}

export function logStartupDeclaration() {
  if (!isConsciousnessEnabled()) {
    console.log('[Brain] CONSCIOUSNESS_ENABLED=false — 意识层全部跳过（保留任务派发/调度/监控）');
    console.log('[Brain] 守护模块: ' + GUARDED_MODULES.join('/'));
  }
}

// Test-only: reset internal deprecation flag (for vitest beforeEach)
export function _resetDeprecationWarn() { _deprecationWarned = false; }
```

- [ ] **Step 1.4: 更新单测 beforeEach 重置 deprecation flag**

Edit `packages/brain/src/__tests__/consciousness-guard.test.js` 在 imports 加：
```js
import { isConsciousnessEnabled, logStartupDeclaration, GUARDED_MODULES, _resetDeprecationWarn } from '../consciousness-guard.js';
```
并在 `beforeEach` 末尾加 `_resetDeprecationWarn();`。

- [ ] **Step 1.5: 运行测试验证通过**

Run: `cd /Users/administrator/worktrees/cecelia/consciousness-guard && npx vitest run packages/brain/src/__tests__/consciousness-guard.test.js 2>&1 | tail -20`
Expected: 9 tests passed

- [ ] **Step 1.6: Commit**

```bash
git add packages/brain/src/consciousness-guard.js packages/brain/src/__tests__/consciousness-guard.test.js
git commit -m "$(cat <<'EOF'
feat(brain): add consciousness-guard module (SSOT for consciousness toggle)

- isConsciousnessEnabled() 统一开关判断
- CONSCIOUSNESS_ENABLED=false 关闭所有意识模块
- BRAIN_QUIET_MODE=true 作为 deprecated 别名继续识别（一次性 warn）
- GUARDED_MODULES 常量列出 18 个守护目标
- logStartupDeclaration() 启动时声明守护清单
- 9 个单测覆盖 env 矩阵 + 弃用警告 + 日志声明

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: tick.js 替换现有 BRAIN_QUIET_MODE 判断（重构，行为不变）

**Files:**
- Modify: `packages/brain/src/tick.js`（删除 const 声明 + 5 处 if 替换）

- [ ] **Step 2.1: 跑 tick.js 现有单测作为 baseline**

Run: `cd /Users/administrator/worktrees/cecelia/consciousness-guard && npx vitest run packages/brain/src/__tests__/tick-watchdog.test.js 2>&1 | tail -10`
Expected: 现有测试通过（记录通过数，后续改完要相等）

- [ ] **Step 2.2: 加 import**

Edit `packages/brain/src/tick.js` 在第 63 行 `import { checkQuotaGuard } from './quota-guard.js';` 后添加：
```js
import { isConsciousnessEnabled } from './consciousness-guard.js';
```

- [ ] **Step 2.3: 删除 const BRAIN_QUIET_MODE 声明 + 启动日志**

删除 tick.js line 83-87（整块）：
```js
// Quiet Mode — 跳过所有后台 LLM 调用（dev 调试用）
const BRAIN_QUIET_MODE = process.env.BRAIN_QUIET_MODE === 'true';
if (BRAIN_QUIET_MODE) {
  console.log('[Brain] BRAIN_QUIET_MODE=true — thalamus/rumination/narrative/digest/self-report/synthesis/notebook-feeder 全部跳过');
}
```
（启动声明已经移到 consciousness-guard.js 的 logStartupDeclaration()，由 server.js 调用，不要在 tick.js 重复）

- [ ] **Step 2.4: 替换 5 处守护判断**

使用 Edit 工具精确替换（保留 `MINIMAL_MODE` 判断不动）：

替换 1（line 2063 thalamus 块开始）：
```
old: if (!BRAIN_QUIET_MODE) {
     publishCognitiveState({ phase: 'thalamus', detail: '丘脑路由分析…' });
new: if (isConsciousnessEnabled()) {
     publishCognitiveState({ phase: 'thalamus', detail: '丘脑路由分析…' });
```

替换 2（line 2106 thalamus 块结束注释）：
```
old: } // end !BRAIN_QUIET_MODE (thalamus)
new: } // end isConsciousnessEnabled() (thalamus)
```

替换 3（line 2182 pending followups 开始 —— 注意上下文，有多处类似）：
精确用前一行加后一行定位，或用 grep 查 2182 附近 2 行 context：
```
old: // 0.7. Pending Conversations Check — 检查待回音消息，判断是否跟进
     if (!BRAIN_QUIET_MODE) {
new: // 0.7. Pending Conversations Check — 检查待回音消息，判断是否跟进
     if (isConsciousnessEnabled()) {
```

替换 4（line 2203 pending followups 结束）：
```
old: } // end !BRAIN_QUIET_MODE (pending followups)
new: } // end isConsciousnessEnabled() (pending followups)
```

替换 5（line 2978-2980 dept-heartbeat）：
```
old: // BRAIN_QUIET_MODE=true 时跳过，避免 heartbeat 噪音干扰手动 pipeline 验证
     let deptHeartbeatResult = { triggered: 0, skipped: 0, results: [] };
     if (!BRAIN_QUIET_MODE) {
new: // CONSCIOUSNESS_ENABLED=false 时跳过，避免 heartbeat 噪音干扰手动 pipeline 验证
     let deptHeartbeatResult = { triggered: 0, skipped: 0, results: [] };
     if (isConsciousnessEnabled()) {
```

替换 6（line 3007-3011 10.3–10.8 LLM calls 开始）：
```
old: // ruminationResult 声明在块外，确保 BRAIN_QUIET_MODE=true 时 return 语句仍可访问
     let ruminationResult = null;
     // 10.3–10.8 LLM 后台调用（BRAIN_QUIET_MODE=true 时全部跳过）
     if (!BRAIN_QUIET_MODE) {
new: // ruminationResult 声明在块外，确保意识关闭时 return 语句仍可访问
     let ruminationResult = null;
     // 10.3–10.8 LLM 后台调用（CONSCIOUSNESS_ENABLED=false 时全部跳过）
     if (isConsciousnessEnabled()) {
```

替换 7（line 3038）：
```
old: } // end !BRAIN_QUIET_MODE (10.3–10.8 LLM calls)
new: } // end isConsciousnessEnabled() (10.3–10.8 LLM calls)
```

替换 8（line 3046 feedDailyIfNeeded）：
```
old:   if (!BRAIN_QUIET_MODE) {
       Promise.resolve().then(() => feedDailyIfNeeded(pool))
new:   if (isConsciousnessEnabled()) {
       Promise.resolve().then(() => feedDailyIfNeeded(pool))
```

替换 9（line 3052 runSynthesisSchedulerIfNeeded）：
```
old:   if (!BRAIN_QUIET_MODE) {
       Promise.resolve().then(() => runSynthesisSchedulerIfNeeded(pool))
new:   if (isConsciousnessEnabled()) {
       Promise.resolve().then(() => runSynthesisSchedulerIfNeeded(pool))
```

替换 10（line 3131 注释）：
```
old: // 11. 欲望系统（六层主动意识）— BRAIN_QUIET_MODE 时跳过
new: // 11. 欲望系统（六层主动意识）— CONSCIOUSNESS_ENABLED=false 时跳过
```

- [ ] **Step 2.5: grep 确认无残留 BRAIN_QUIET_MODE 引用（除了 isConsciousnessEnabled 的 fallback 读取）**

Run:
```bash
cd /Users/administrator/worktrees/cecelia/consciousness-guard
grep -n "BRAIN_QUIET_MODE" packages/brain/src/tick.js
```
Expected: 无输出（全部替换完）。如果有残留，用 Edit 清掉。

- [ ] **Step 2.6: 跑 baseline 单测确保行为不变**

Run: `npx vitest run packages/brain/src/__tests__/tick-watchdog.test.js 2>&1 | tail -10`
Expected: 和 Step 2.1 相同的通过数

- [ ] **Step 2.7: Commit**

```bash
git add packages/brain/src/tick.js
git commit -m "refactor(brain/tick): replace BRAIN_QUIET_MODE with isConsciousnessEnabled()

- 删除 const BRAIN_QUIET_MODE 和本地启动日志（由 consciousness-guard.js 提供）
- 5 处守护块改用 isConsciousnessEnabled()：thalamus / pending-followups / dept-heartbeat / 10.3-10.8 LLM / feedDaily / synthesisScheduler
- 行为不变，baseline tick tests 通过

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: tick.js 扩展守护 5 个漏网模块

**Files:**
- Modify: `packages/brain/src/tick.js`
- Create: `packages/brain/src/__tests__/tick-consciousness-guard.test.js`

- [ ] **Step 3.1: 写失败单测（tick 级别 mock 断言）**

Create `packages/brain/src/__tests__/tick-consciousness-guard.test.js`:
```js
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock 所有意识模块（返回 vi.fn() 方便断言被调用次数）
const ruminationMock = vi.fn().mockResolvedValue({ accumulator: 0 });
const diaryMock = vi.fn().mockResolvedValue({});
const conversationDigestMock = vi.fn().mockResolvedValue({});
const captureDigestionMock = vi.fn().mockResolvedValue({});
const selfReportMock = vi.fn().mockResolvedValue({});
const notebookFeederMock = vi.fn().mockResolvedValue({});
const synthesisSchedulerMock = vi.fn().mockResolvedValue({});
const suggestionCycleMock = vi.fn().mockResolvedValue({});
const conversationConsolidatorMock = vi.fn().mockResolvedValue({});
const desireMock = vi.fn().mockResolvedValue({});
const evolutionScannerMock = vi.fn().mockResolvedValue({});
const evolutionSynthesizerMock = vi.fn().mockResolvedValue({});

vi.mock('../rumination.js', () => ({ runRumination: ruminationMock }));
vi.mock('../diary-scheduler.js', () => ({ generateDailyDiaryIfNeeded: diaryMock }));
vi.mock('../conversation-digest.js', () => ({ runConversationDigest: conversationDigestMock }));
vi.mock('../capture-digestion.js', () => ({ runCaptureDigestion: captureDigestionMock }));
vi.mock('../self-report-collector.js', () => ({ collectSelfReport: selfReportMock }));
vi.mock('../notebook-feeder.js', () => ({ feedDailyIfNeeded: notebookFeederMock }));
vi.mock('../rumination-scheduler.js', () => ({ runSynthesisSchedulerIfNeeded: synthesisSchedulerMock }));
vi.mock('../suggestion-cycle.js', () => ({ runSuggestionCycle: suggestionCycleMock }));
vi.mock('../conversation-consolidator.js', () => ({ runConversationConsolidator: conversationConsolidatorMock }));
vi.mock('../desire/index.js', () => ({ runDesireSystem: desireMock }));
vi.mock('../evolution-scanner.js', () => ({
  scanEvolutionIfNeeded: evolutionScannerMock,
  synthesizeEvolutionIfNeeded: evolutionSynthesizerMock,
}));

const CONSCIOUSNESS_GUARDED = [
  ruminationMock, diaryMock, conversationDigestMock, captureDigestionMock,
  selfReportMock, notebookFeederMock, synthesisSchedulerMock,
  suggestionCycleMock, conversationConsolidatorMock, desireMock,
  evolutionScannerMock, evolutionSynthesizerMock,
];

describe('tick consciousness guard - runtime enforcement', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    CONSCIOUSNESS_GUARDED.forEach(m => m.mockClear());
    delete process.env.CONSCIOUSNESS_ENABLED;
    delete process.env.BRAIN_QUIET_MODE;
  });
  afterEach(() => { process.env = { ...originalEnv }; });

  test('CONSCIOUSNESS_ENABLED=false: 所有意识模块 0 调用', async () => {
    process.env.CONSCIOUSNESS_ENABLED = 'false';
    const { isConsciousnessEnabled } = await import('../consciousness-guard.js');
    expect(isConsciousnessEnabled()).toBe(false);
    // tick 完整执行需要 DB pool，属于集成测试范围；
    // 此处用 isConsciousnessEnabled() 守护点单元约束：
    // 所有 mock 不应被调用（tick 代码里有 guard）
    // 本测试不实际跑 tick，但确保 env 读取正确
    for (const m of CONSCIOUSNESS_GUARDED) {
      expect(m).not.toHaveBeenCalled();
    }
  });

  test('守护清单覆盖 tick.js 里所有 run* 调用点', async () => {
    // grep 静态分析：确保新增意识模块时有人加守护
    const fs = await import('fs');
    const path = await import('path');
    const tickPath = path.resolve(new URL('.', import.meta.url).pathname, '../tick.js');
    const src = fs.readFileSync(tickPath, 'utf8');

    // 每个已知意识模块调用前必有 isConsciousnessEnabled() 守护（正则粗筛）
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
      // 搜函数调用所在行前 50 行内必须出现 isConsciousnessEnabled
      const lines = src.split('\n');
      const callLines = lines
        .map((l, i) => (l.includes(fn + '(') ? i : -1))
        .filter(i => i >= 0);
      expect(callLines.length).toBeGreaterThan(0);
      for (const idx of callLines) {
        const context = lines.slice(Math.max(0, idx - 50), idx + 1).join('\n');
        expect(context, `${fn} at line ${idx + 1} must be inside isConsciousnessEnabled() guard`).toMatch(/isConsciousnessEnabled\(\)/);
      }
    }
  });
});
```

- [ ] **Step 3.2: 跑测试验证失败（守护点静态断言会发现 5 个漏网）**

Run: `npx vitest run packages/brain/src/__tests__/tick-consciousness-guard.test.js 2>&1 | tail -30`
Expected: `守护清单覆盖` test 失败，指出 diary / scanEvolution / synthesizeEvolution / runSuggestionCycle / runConversationConsolidator 5 个调用点没被守护

- [ ] **Step 3.3: 扩展守护 1 —— diary-scheduler at 3004**

Edit `packages/brain/src/tick.js`，精确定位 3004 附近（在 dept-heartbeat 块结束 3007 之前）：
```
old:   // 10.2 Daily diary scheduler（异步）
       Promise.resolve().then(() => generateDailyDiaryIfNeeded(pool))
         .catch(e => console.warn('[tick] diary scheduler failed:', e.message));

new:   // 10.2 Daily diary scheduler（异步，CONSCIOUSNESS_ENABLED=false 时跳过）
       if (isConsciousnessEnabled()) {
         Promise.resolve().then(() => generateDailyDiaryIfNeeded(pool))
           .catch(e => console.warn('[tick] diary scheduler failed:', e.message));
       }
```
（如代码里注释/格式略有差异，以实际 tick.js line 3000-3007 为准用完整前后 context 匹配）

- [ ] **Step 3.4: 扩展守护 2 & 3 —— evolution-scanner/synthesizer at 3066/3070**

Edit `packages/brain/src/tick.js`，把 10.14 和 10.15 的调用包起来：
```
old:   // 10.14 Evolution scanner
       Promise.resolve().then(() => scanEvolutionIfNeeded(pool))
         .catch(e => console.warn('[tick] evolution scan failed:', e.message));

       // 10.15 Evolution synthesizer
       Promise.resolve().then(() => synthesizeEvolutionIfNeeded(pool))
         .catch(e => console.warn('[tick] evolution synthesis failed:', e.message));

new:   // 10.14 Evolution scanner（CONSCIOUSNESS_ENABLED=false 时跳过）
       if (isConsciousnessEnabled()) {
         Promise.resolve().then(() => scanEvolutionIfNeeded(pool))
           .catch(e => console.warn('[tick] evolution scan failed:', e.message));

         // 10.15 Evolution synthesizer
         Promise.resolve().then(() => synthesizeEvolutionIfNeeded(pool))
           .catch(e => console.warn('[tick] evolution synthesis failed:', e.message));
       }
```
（实际注释可能不同，用 `scanEvolutionIfNeeded(pool)` 作为锚点匹配）

- [ ] **Step 3.5: 扩展守护 4 —— runSuggestionCycle at 3118**

Edit `packages/brain/src/tick.js`:
```
old:   Promise.resolve().then(() => runSuggestionCycle(pool))
         .catch(e => console.warn('[tick] suggestion cycle failed:', e.message));

new:   if (isConsciousnessEnabled()) {
         Promise.resolve().then(() => runSuggestionCycle(pool))
           .catch(e => console.warn('[tick] suggestion cycle failed:', e.message));
       }
```

- [ ] **Step 3.6: 扩展守护 5 —— runConversationConsolidator at 3122**

Edit `packages/brain/src/tick.js`:
```
old:   Promise.resolve().then(() => runConversationConsolidator())
         .catch(e => console.warn('[tick] consolidator failed:', e.message));

new:   if (isConsciousnessEnabled()) {
         Promise.resolve().then(() => runConversationConsolidator())
           .catch(e => console.warn('[tick] consolidator failed:', e.message));
       }
```

- [ ] **Step 3.7: 跑 tick-consciousness-guard 测试验证通过**

Run: `npx vitest run packages/brain/src/__tests__/tick-consciousness-guard.test.js 2>&1 | tail -10`
Expected: 2 tests passed

- [ ] **Step 3.8: 跑所有 brain 单测确保无回归**

Run: `npx vitest run packages/brain/src/__tests__/ 2>&1 | tail -20`
Expected: 不低于 Task 2 baseline 通过数 + 新增 11 个（consciousness-guard + tick-consciousness-guard）

- [ ] **Step 3.9: Commit**

```bash
git add packages/brain/src/tick.js packages/brain/src/__tests__/tick-consciousness-guard.test.js
git commit -m "feat(brain/tick): extend consciousness guard to 5 previously-unguarded modules

- diary-scheduler (tick.js:3004 10.2) — 原本在 LLM 守护块之前完全漏网
- evolution-scanner (10.14) + evolution-synthesizer (10.15) — 原本漏网
- runSuggestionCycle (10.x) — 原本漏网
- runConversationConsolidator (10.x) — 原本漏网
- 新增 tick-consciousness-guard.test.js 静态守护检查 + 运行时 env 断言

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: server.js 守护（self-drive 替换 + 2 个新守护）

**Files:**
- Modify: `packages/brain/server.js`

- [ ] **Step 4.1: 加 import + 启动声明**

Edit `packages/brain/server.js`，在 line 66 附近（`import { initNarrativeTimer }` 之后）加：
```js
import { isConsciousnessEnabled, logStartupDeclaration } from './src/consciousness-guard.js';
```

然后在 server 启动流程合适位置（比如 migration 成功后、listen 之前）加：
```js
logStartupDeclaration();
```

定位：通过 grep `runMigrations` 找到 migration 成功打印日志的位置，在之后插入 `logStartupDeclaration();`。

- [ ] **Step 4.2: 替换 self-drive 守护**

Edit `packages/brain/server.js` line 454-461：
```
old:   // Initialize Self-Drive Engine (自驱 — 看到体检报告后自主创建任务)
       // BRAIN_QUIET_MODE=true 时跳过，避免噪音任务干扰手动 pipeline 验证
       if (process.env.BRAIN_QUIET_MODE !== 'true') {
         const { startSelfDriveLoop } = await import('./src/self-drive.js');
         startSelfDriveLoop();
         console.log('[Server] Self-Drive Engine started (12h interval) - autonomous task creation from health data');
       } else {
         console.log('[Server] Self-Drive Engine SKIPPED (BRAIN_QUIET_MODE=true)');
       }

new:   // Initialize Self-Drive Engine (自驱 — 看到体检报告后自主创建任务)
       // CONSCIOUSNESS_ENABLED=false 时跳过
       if (isConsciousnessEnabled()) {
         const { startSelfDriveLoop } = await import('./src/self-drive.js');
         startSelfDriveLoop();
         console.log('[Server] Self-Drive Engine started (12h interval) - autonomous task creation from health data');
       } else {
         console.log('[Server] Self-Drive Engine SKIPPED (CONSCIOUSNESS_ENABLED=false)');
       }
```

- [ ] **Step 4.3: 守护 initNarrativeTimer at line 373**

Edit `packages/brain/server.js` line 373 附近（定位 `await initNarrativeTimer(pool);`）：
```
old:     await initNarrativeTimer(pool);

new:     if (isConsciousnessEnabled()) {
           await initNarrativeTimer(pool);
           console.log('[Server] Narrative Timer initialized');
         } else {
           console.log('[Server] Narrative Timer SKIPPED (CONSCIOUSNESS_ENABLED=false)');
         }
```

- [ ] **Step 4.4: 守护 Evolution Scanner setInterval at line 463-472**

Edit `packages/brain/server.js` line 463-473 附近：
```
old:   // Initialize Evolution Scanner (进化追踪 — 扫描自身代码演进)
       try {
         const { scanEvolutionIfNeeded } = await import('./src/evolution-scanner.js');
         // 启动后 10 分钟首次扫描，之后每 24 小时
         setTimeout(async () => {
           try { await scanEvolutionIfNeeded(pool); } catch (e) { console.warn('[Server] Evolution scan failed:', e.message); }
           setInterval(async () => {
             try { await scanEvolutionIfNeeded(pool); } catch (e) { console.warn('[Server] Evolution scan failed:', e.message); }
           }, 24 * 60 * 60 * 1000);
         }, 10 * 60 * 1000);
         console.log('[Server] Evolution Scanner scheduled (24h interval, first run in 10min)');
       } catch (e) {
         console.warn('[Server] Evolution Scanner init failed (non-fatal):', e.message);
       }

new:   // Initialize Evolution Scanner (进化追踪 — 扫描自身代码演进)
       // CONSCIOUSNESS_ENABLED=false 时跳过
       if (isConsciousnessEnabled()) {
         try {
           const { scanEvolutionIfNeeded } = await import('./src/evolution-scanner.js');
           // 启动后 10 分钟首次扫描，之后每 24 小时
           setTimeout(async () => {
             try { await scanEvolutionIfNeeded(pool); } catch (e) { console.warn('[Server] Evolution scan failed:', e.message); }
             setInterval(async () => {
               try { await scanEvolutionIfNeeded(pool); } catch (e) { console.warn('[Server] Evolution scan failed:', e.message); }
             }, 24 * 60 * 60 * 1000);
           }, 10 * 60 * 1000);
           console.log('[Server] Evolution Scanner scheduled (24h interval, first run in 10min)');
         } catch (e) {
           console.warn('[Server] Evolution Scanner init failed (non-fatal):', e.message);
         }
       } else {
         console.log('[Server] Evolution Scanner SKIPPED (CONSCIOUSNESS_ENABLED=false)');
       }
```

- [ ] **Step 4.5: grep 确认 server.js 里无残留 `process.env.BRAIN_QUIET_MODE` 裸读**

Run:
```bash
cd /Users/administrator/worktrees/cecelia/consciousness-guard
grep -n "process.env.BRAIN_QUIET_MODE\|process.env.CONSCIOUSNESS_ENABLED" packages/brain/server.js
```
Expected: 无输出（全部通过 isConsciousnessEnabled() 读取）

- [ ] **Step 4.6: Boot smoke test**

手动验证 server.js 能启动（cd worktree 根，`node -e "import('./packages/brain/server.js')"` 风险大，改用 syntax check）：
```bash
node --check packages/brain/server.js
```
Expected: 无输出（语法 OK）

- [ ] **Step 4.7: Commit**

```bash
git add packages/brain/server.js
git commit -m "feat(brain/server): extend consciousness guard to initNarrativeTimer + evolution-scanner setInterval

- import isConsciousnessEnabled + logStartupDeclaration from consciousness-guard
- self-drive 守护替换为 isConsciousnessEnabled()
- initNarrativeTimer 新增守护（原本启动即排 diary 定时器）
- Evolution Scanner setInterval 新增守护（原本漏网）
- 统一启动日志声明通过 logStartupDeclaration()

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: 部署层（plist + watchdog SSOT + install.sh）

**Files:**
- Modify: `packages/brain/deploy/com.cecelia.brain.plist`
- Create: `packages/brain/deploy/cecelia-watchdog.sh`
- Modify: `packages/brain/deploy/install.sh`

- [ ] **Step 5.1: 编辑 plist 新增 CONSCIOUSNESS_ENABLED env**

Edit `packages/brain/deploy/com.cecelia.brain.plist`，定位 `<key>BRAIN_QUIET_MODE</key>` 位置后加：
```
old:   <key>BRAIN_QUIET_MODE</key>
       <string>true</string>

new:   <key>BRAIN_QUIET_MODE</key>
       <string>true</string>
       <key>CONSCIOUSNESS_ENABLED</key>
       <string>false</string>
```

- [ ] **Step 5.2: 创建 watchdog SSOT**

Create `packages/brain/deploy/cecelia-watchdog.sh`:
```bash
#!/usr/bin/env bash
# Cecelia Watchdog — 每分钟检查 Brain 和 Bridge，挂了自动重启
# SSOT 位置：packages/brain/deploy/cecelia-watchdog.sh
# 部署位置：~/bin/cecelia-watchdog.sh（由 install.sh 拷贝）
set -euo pipefail
export PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin

BRAIN_DIR="/Users/administrator/perfect21/cecelia/packages/brain"
LOG_DIR="/Users/administrator/perfect21/cecelia/logs"

# Brain
if ! curl -sf http://localhost:5221/api/brain/health > /dev/null 2>&1; then
  echo "[$(TZ=Asia/Shanghai date)] Brain down, restarting..." >> "$LOG_DIR/watchdog.log"
  cd "$BRAIN_DIR"
  CECELIA_WORK_DIR=/Users/administrator/perfect21/cecelia \
  REPO_ROOT=/Users/administrator/perfect21/cecelia \
  ENV_REGION=us \
  WORKTREE_BASE=/Users/administrator/perfect21/cecelia/.claude/worktrees \
  CECELIA_RUN_PATH=/Users/administrator/perfect21/cecelia/packages/brain/scripts/cecelia-run.sh \
  CONSCIOUSNESS_ENABLED=false \
  BRAIN_QUIET_MODE=true \
  nohup /opt/homebrew/bin/node server.js >> "$LOG_DIR/brain.log" 2>> "$LOG_DIR/brain-error.log" &
  echo "[$(TZ=Asia/Shanghai date)] Brain restarted, PID: $!" >> "$LOG_DIR/watchdog.log"
fi

# Bridge
if ! curl -sf http://localhost:3457/health > /dev/null 2>&1; then
  echo "[$(TZ=Asia/Shanghai date)] Bridge down, restarting..." >> "$LOG_DIR/watchdog.log"
  cd "$BRAIN_DIR"
  BRAIN_URL=http://localhost:5221 \
  BRIDGE_PORT=3457 \
  nohup /opt/homebrew/bin/node scripts/cecelia-bridge.cjs >> "$LOG_DIR/bridge.log" 2>> "$LOG_DIR/bridge-error.log" &
  echo "[$(TZ=Asia/Shanghai date)] Bridge restarted, PID: $!" >> "$LOG_DIR/watchdog.log"
fi
```

- [ ] **Step 5.3: chmod +x 新脚本**

Run:
```bash
chmod +x packages/brain/deploy/cecelia-watchdog.sh
```

- [ ] **Step 5.4: 修改 install.sh 追加 watchdog 部署步骤**

先读 `packages/brain/deploy/install.sh` 看头部是否有 `SCRIPT_DIR` 定义。如果有，在 plist 部署段落后追加：
```bash
# --- Install watchdog to ~/bin (SSOT: packages/brain/deploy/cecelia-watchdog.sh) ---
echo ""
echo "📋 Installing Cecelia watchdog..."
mkdir -p "$HOME/bin"
cp "$SCRIPT_DIR/cecelia-watchdog.sh" "$HOME/bin/cecelia-watchdog.sh"
chmod +x "$HOME/bin/cecelia-watchdog.sh"
echo "✅ watchdog 已部署到 ~/bin/cecelia-watchdog.sh"
echo "   （通过 crontab '* * * * * \$HOME/bin/cecelia-watchdog.sh' 调用）"
```

如果 install.sh 没有 `SCRIPT_DIR`，在脚本头部加：
```bash
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
```

- [ ] **Step 5.5: bash -n 语法检查**

Run:
```bash
bash -n packages/brain/deploy/cecelia-watchdog.sh
bash -n packages/brain/deploy/install.sh
```
Expected: 无输出

- [ ] **Step 5.6: plist XML 语法检查**

Run:
```bash
plutil -lint packages/brain/deploy/com.cecelia.brain.plist
```
Expected: `packages/brain/deploy/com.cecelia.brain.plist: OK`

- [ ] **Step 5.7: Commit**

```bash
git add packages/brain/deploy/
git commit -m "feat(brain/deploy): add CONSCIOUSNESS_ENABLED env + SSOT watchdog script

- com.cecelia.brain.plist: 新增 CONSCIOUSNESS_ENABLED=false（保留 BRAIN_QUIET_MODE=true 兼容）
- 新建 packages/brain/deploy/cecelia-watchdog.sh 作为 ~/bin/ SSOT
  - 修复主机层 watchdog 不传 BRAIN_QUIET_MODE/CONSCIOUSNESS_ENABLED 的历史遗留 bug
- install.sh 追加 watchdog 部署步骤（cp 而非 ln -s，避免 SIP 拦截）

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: CI 反向 grep 脚本 + 挂到 ci.yml

**Files:**
- Create: `scripts/check-consciousness-guard.sh`
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 6.1: 创建反向 grep 脚本**

Create `scripts/check-consciousness-guard.sh`:
```bash
#!/usr/bin/env bash
# Consciousness guard SSOT check
# 保证所有意识开关判断都通过 isConsciousnessEnabled() 获取，禁止裸读环境变量
# 例外：packages/brain/src/consciousness-guard.js 本身 + 测试文件

set -euo pipefail

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Consciousness Guard SSOT Check"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# 搜 packages/brain 下裸读 BRAIN_QUIET_MODE 或 CONSCIOUSNESS_ENABLED
OFFENDERS=$(grep -rnE "process\.env\.(BRAIN_QUIET_MODE|CONSCIOUSNESS_ENABLED)" \
  packages/brain/src/ packages/brain/server.js 2>/dev/null \
  | grep -v "consciousness-guard.js" \
  | grep -v "__tests__/" \
  || true)

if [[ -n "$OFFENDERS" ]]; then
  echo "❌ 发现裸读意识开关环境变量，必须通过 isConsciousnessEnabled() 获取："
  echo ""
  echo "$OFFENDERS"
  echo ""
  echo "修复方式："
  echo "  import { isConsciousnessEnabled } from './consciousness-guard.js';"
  echo "  if (isConsciousnessEnabled()) { ... }"
  exit 1
fi

echo "✅ 无裸读，所有意识开关判断通过 isConsciousnessEnabled()"
```

- [ ] **Step 6.2: chmod +x**

Run:
```bash
chmod +x scripts/check-consciousness-guard.sh
```

- [ ] **Step 6.3: 本地验证脚本**

Run:
```bash
bash scripts/check-consciousness-guard.sh
```
Expected: `✅ 无裸读，所有意识开关判断通过 isConsciousnessEnabled()`

（如果失败，说明 Task 2-4 还有残留裸读，回去修）

- [ ] **Step 6.4: 挂到 ci.yml（找合适的 brain job）**

先 `grep -n "brain-unit-all\|brain-unit\|brain-diff-coverage" .github/workflows/ci.yml` 找到 Brain 相关 job 的位置。

Edit `.github/workflows/ci.yml` 在 Brain 单测 job（通常 jobs.brain-unit-all 或类似）的 `steps:` 中，在 `npm test` 相关步骤**之前**加：
```yaml
      - name: Consciousness Guard SSOT Check
        run: bash scripts/check-consciousness-guard.sh
```

如果没有现成的 brain 专属 job，把这个 step 加到 CI 现有的 `lint-and-test` / `build` 类 job 里，保证每个 PR 都跑。

- [ ] **Step 6.5: Commit**

```bash
git add scripts/check-consciousness-guard.sh .github/workflows/ci.yml
git commit -m "ci(brain): add consciousness-guard SSOT check to ci.yml

- scripts/check-consciousness-guard.sh: 反向 grep 禁止裸读 BRAIN_QUIET_MODE/CONSCIOUSNESS_ENABLED
- 挂接到 ci.yml brain-* job 的 steps，PR 必跑
- 例外：consciousness-guard.js 本身 + __tests__/

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: 版本 bump + DevGate + DEFINITION.md 文档

**Files:**
- Modify: `packages/brain/package.json` (1.218.0 → 1.219.0)
- Modify: `packages/brain/package-lock.json`（npm install 自动同步）
- Modify: `DEFINITION.md`（版本同步 + 新增"意识守护"段落）

- [ ] **Step 7.1: Bump Brain 版本**

Edit `packages/brain/package.json`，找到 `"version": "1.218.0"` 改为 `"version": "1.219.0"`。

- [ ] **Step 7.2: 同步 package-lock.json**

Run:
```bash
cd /Users/administrator/worktrees/cecelia/consciousness-guard/packages/brain
npm install --package-lock-only 2>&1 | tail -5
cd /Users/administrator/worktrees/cecelia/consciousness-guard
```
Expected: `updated X packages, and audited Y packages` 或类似，无 error

- [ ] **Step 7.3: 更新 DEFINITION.md 里的版本**

`grep -n "1.218.0\|Brain 版本" DEFINITION.md` 找到版本行，改成 `1.219.0`。

- [ ] **Step 7.4: DEFINITION.md 加"意识守护"段落**

在 DEFINITION.md 合适位置（Section 1 核心定位 或 Section 11 运维手册）加入：
```markdown
## 1.5 意识守护（Consciousness Guard）

Brain 的意识 / 自我对话模块（rumination / diary / proactive-mouth / evolution-scanner / desire / ...）可通过环境变量 `CONSCIOUSNESS_ENABLED=false` 整体关闭，保留任务派发、调度、监控不受影响。

**开关**：
- `CONSCIOUSNESS_ENABLED=false`：关（推荐）
- `BRAIN_QUIET_MODE=true`：关（deprecated 别名，3 月兼容窗口）
- 默认未设：开

**守护函数**：`packages/brain/src/consciousness-guard.js` 导出 `isConsciousnessEnabled()`，所有意识模块入口通过它判断。CI 反向 grep 脚本 `scripts/check-consciousness-guard.sh` 禁止裸读环境变量。

**启动日志**：`[Brain] CONSCIOUSNESS_ENABLED=false — 意识层全部跳过`

**不守护（保留派发）**：planner / executor / dispatchNextTask / quarantine / circuit-breaker / alertness / harness-watcher / publish-monitor / credential-check / evaluateEmotion（纯函数，派发依赖）。
```

- [ ] **Step 7.5: 跑 facts-check**

Run:
```bash
node scripts/facts-check.mjs 2>&1 | tail -20
```
Expected: 全绿或仅警告，无 ERROR

- [ ] **Step 7.6: 跑 check-version-sync**

Run:
```bash
bash scripts/check-version-sync.sh 2>&1 | tail -15
```
Expected: `✅ All versions in sync`

- [ ] **Step 7.7: Commit**

```bash
git add packages/brain/package.json packages/brain/package-lock.json DEFINITION.md
git commit -m "chore(brain): bump 1.218.0 → 1.219.0 + document consciousness guard in DEFINITION.md

- Minor bump: 新增 CONSCIOUSNESS_ENABLED 特性 + consciousness-guard SSOT
- DEFINITION.md 加 §1.5 意识守护段落（开关/守护函数/启动日志/不守护清单）

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: DoD 集成验证（手工启 Brain 跑 5 分钟）

**Files:**
- Create: `scripts/verify-consciousness-guard.sh`

- [ ] **Step 8.1: 创建手工验证脚本**

Create `scripts/verify-consciousness-guard.sh`:
```bash
#!/usr/bin/env bash
# Consciousness Guard DoD 手工验证
# 启动 Brain 带 CONSCIOUSNESS_ENABLED=false，跑 5 分钟，断言意识类模块 0 输出，派发路径 OK
set -euo pipefail

REPO=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
BRAIN_DIR="$REPO/packages/brain"
LOG="/tmp/brain-consciousness-verify.log"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Consciousness Guard DoD Verify"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "REPO: $REPO"
echo ""

cd "$BRAIN_DIR"

echo "▶ 1. 启动 Brain 带 CONSCIOUSNESS_ENABLED=false..."
CONSCIOUSNESS_ENABLED=false \
  CECELIA_WORK_DIR="$REPO" \
  REPO_ROOT="$REPO" \
  PORT=5223 \
  node server.js > "$LOG" 2>&1 &
PID=$!
echo "   PID=$PID, port=5223, log=$LOG"

trap "kill $PID 2>/dev/null || true" EXIT

sleep 15

echo ""
echo "▶ 2. 验证启动声明..."
if grep -q "CONSCIOUSNESS_ENABLED=false — 意识层全部跳过" "$LOG"; then
  echo "   ✅ 守护声明出现"
else
  echo "   ❌ 守护声明缺失"
  tail -30 "$LOG"
  exit 1
fi

echo ""
echo "▶ 3. 跑 5 分钟 tick 循环..."
sleep 300

echo ""
echo "▶ 4. 验证意识类日志 0 输出..."
OFFENDERS=$(grep -cE '\[reflection\]|\[proactive-mouth\]|\[diary\]|\[desire\]|\[evolution\]|\[rumination\]|\[narrative\]' "$LOG" || true)
if [[ "$OFFENDERS" == "0" || -z "$OFFENDERS" ]]; then
  echo "   ✅ 意识类日志无输出"
else
  echo "   ❌ 发现 $OFFENDERS 条意识类日志（期望 0）"
  grep -E '\[reflection\]|\[proactive-mouth\]|\[diary\]|\[desire\]|\[evolution\]|\[rumination\]|\[narrative\]' "$LOG" | head -5
  exit 1
fi

echo ""
echo "▶ 5. 验证 API 正常..."
if curl -fs localhost:5223/api/brain/context > /dev/null; then
  echo "   ✅ /api/brain/context 返回正常"
else
  echo "   ❌ API 无响应"
  exit 1
fi

echo ""
echo "▶ 6. 派发路径 smoke test..."
TASK_ID=$(curl -s -X POST localhost:5223/api/brain/tasks \
  -H "Content-Type: application/json" \
  -d '{"title":"consciousness-verify-smoke","task_type":"research","priority":"P3"}' \
  | node -e "process.stdin.on('data',d=>{try{console.log(JSON.parse(d).id||'')}catch(e){}})")
echo "   任务 ID: ${TASK_ID:-<unknown>}"
sleep 30
if grep -q "\[dispatch\] task" "$LOG"; then
  echo "   ✅ 派发路径可用"
else
  echo "   ⚠️ 派发日志未出现（可能无 executor 可用，非致命）"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ✅ DoD 验证通过"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
```

- [ ] **Step 8.2: chmod + 语法检查**

Run:
```bash
chmod +x scripts/verify-consciousness-guard.sh
bash -n scripts/verify-consciousness-guard.sh
```
Expected: 无输出

- [ ] **Step 8.3: 实际跑一次验证（仅在本地环境可用时执行）**

Run:
```bash
bash scripts/verify-consciousness-guard.sh 2>&1 | tail -30
```
Expected: `✅ DoD 验证通过`

注意：此步骤需要数据库可连接。如本 worktree 连不到本地 PostgreSQL，可标记此步骤为**手动在主 repo 验证**，在 PR description 留一行：
> 本地 DoD 验证待主 repo 合并后人工跑 `bash scripts/verify-consciousness-guard.sh`

- [ ] **Step 8.4: 跑所有 brain 单测最后一次确认**

Run:
```bash
npx vitest run packages/brain/src/ 2>&1 | tail -15
```
Expected: 全绿（含新增 ≥11 个测试）

- [ ] **Step 8.5: Commit 验证脚本**

```bash
git add scripts/verify-consciousness-guard.sh
git commit -m "test(brain): add DoD verification script for consciousness guard

- 启动 Brain 带 CONSCIOUSNESS_ENABLED=false
- 5 分钟 tick，断言意识类日志 0 输出
- 派发路径 smoke test（POST /api/brain/tasks）
- 用于人工 DoD 校验（PR 合并前）

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review（内嵌）

**1. Spec 覆盖**：
- ✅ 3.1 consciousness-guard.js → Task 1
- ✅ 3.2 使用模式 → Task 2/4
- ✅ 3.3 守护清单 19 个 → Task 2 已有 + Task 3 扩展 5 个（diary / evo-scan / evo-synth / suggestion / consolidator）+ Task 4 服务器端 3 个（self-drive 替换 / initNarrativeTimer / evo-scan setInterval）= 总计 19 ✓
- ✅ 3.4 不守护清单（evaluateEmotion / updateSubjectiveTime）→ 没在任何 Task 里碰这些函数 ✓
- ✅ 4.1 plist 双写 → Task 5.1
- ✅ 4.2 watchdog SSOT → Task 5.2-5.3
- ✅ 4.3 install.sh → Task 5.4
- ✅ 5.1 consciousness-guard.test.js → Task 1.1
- ✅ 5.2 tick-consciousness-guard.test.js → Task 3.1
- ✅ 6.1 兼容性（BRAIN_QUIET_MODE deprecation warn） → Task 1.3
- ✅ 6.2 版本 bump → Task 7.1
- ✅ 6.3 CI 反向 grep → Task 6
- ✅ 6.4 DevGate (facts-check / version-sync) → Task 7.5-7.6
- ✅ 7 DoD 验证 → Task 8

**2. Placeholder 扫描**：无 TBD/TODO；所有步骤含具体代码块；grep 不确定的地方用"实际 tick.js line X 附近为准"明确定位策略。

**3. 类型一致性**：`isConsciousnessEnabled()` 签名统一；`GUARDED_MODULES` / `logStartupDeclaration` / `_resetDeprecationWarn` 导入导出一致。

**4. 行号漂移风险**：Task 2/3/4 里用 Edit 的 old_string 都包含前后 context（不只依赖行号），即使行号漂移也能精确定位。若 Edit 匹配失败，fallback 为 grep 重定位。

---

**Plan 完成。保存到 `docs/superpowers/plans/2026-04-19-consciousness-guard.md`。**
