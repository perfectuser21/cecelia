/**
 * harness-judge-theater.test.js — 戏院错配闸 + 元验证补丁机械预检单测（TDD failing test 先行）
 *
 * Sprint: 建制W6（sprints/07161900-theater-mismatch-gate）
 * Task: b317ae29-9fbc-4d6f-abf0-016141d6c657
 *
 * 覆盖三核心场景（FR-05）：
 *   SC-01: GP 含「微信真机发送」+ target_environment=local_api → theater_mismatch
 *   SC-02: smoke 类标题 + contract 无 L3/THEATER 断言 → meta_verification_gap
 *   SC-03: 正常 local_api 服务端合同（无真机关键词）→ 不误伤（回归）
 *
 * 额外场景：
 *   SC-04: GP 含 adb + mac_web → theater_mismatch（mac_web 同样触发）
 *   SC-05: 验证脚本类 PRD + contract 含 verification_level: L3 → 不误判
 *   SC-06: THEATER_KEYWORDS_EXTRA env 扩展自定义关键词 → theater_mismatch
 *   SC-07: GP 含 UIA 关键词（大小写变体 uia）+ local_api → theater_mismatch（大小写不敏感）
 *
 * 债1 语境化（task d2567378）：SC-08 四象限——合同带「## 真机边界声明」段时，
 * 名词引用不再误杀，但 BEHAVIOR/Test 行命中动作词仍 FAIL（声明不能洗白真作弊）。
 */

import { describe, it, expect, afterEach } from 'vitest';
import { runMechanicalGate } from '../harness-judge.js';

// ── 桩工具 ─────────────────────────────────────────────────────────────────

/**
 * 构造最小合规 ctx（不含真机关键词，不含 smoke 标题）。
 * 用于各场景局部覆盖，避免其他检查项误触。
 */
function baseCtx(overrides = {}) {
  return {
    taskId: 'theater-test-task',
    worktreePath: '/tmp',
    sprintDir: 'test-sprint',
    brainResult: {
      verdict: 'PASS',
      behavior_tests: [{ command: 'npm test', exit_code: 0, log_tail: 'all tests passed' }],
    },
    ...overrides,
  };
}

/**
 * 构造依赖桩：
 *   - readFileFn: 按路径返回指定内容（sprint-prd.md / contract-draft.md）
 *   - listTestFilesFn: 返回一个虚拟测试文件（避免触发 contract_tests FAIL）
 *   - dbPool: 返回指定 target_environment
 */
function makeDeps({ prdContent = '', contractContent = '', env = 'local_api' } = {}) {
  return {
    readFileFn: async (p) => {
      if (String(p).includes('sprint-prd')) return prdContent;
      if (String(p).includes('contract-draft') || String(p).includes('contract-dod')) return contractContent;
      throw new Error('ENOENT');
    },
    listTestFilesFn: async () => ['a.test.ts'],
    dbPool: {
      query: async () => ({ rows: [{ target_environment: env }] }),
    },
  };
}

// ── SC-01: 戏院错配闸 — GP 含「微信真机发送」+ local_api → FAIL ────────────
describe('SC-01: theater_mismatch — 微信真机发送 + local_api', () => {
  it('应返回 pass:false，reasons 含 theater_mismatch', async () => {
    const ctx = baseCtx();
    const deps = makeDeps({
      prdContent: '## Golden Path\n\n1. 微信真机发送消息\n2. 验证送达\n',
      contractContent: '[BEHAVIOR] 发送微信消息\nTest: manual:检查消息是否送达',
      env: 'local_api',
    });

    const result = await runMechanicalGate(ctx, deps);

    // TDD failing test：实现前此断言应当 FAIL（runMechanicalGate 尚未有 theater_mismatch 闸）
    expect(result.pass).toBe(false);
    expect(result.reasons.join(' ')).toMatch(/theater_mismatch/);
  });

  it('feedback 应指明应路由 windows_wechat', async () => {
    const ctx = baseCtx();
    const deps = makeDeps({
      prdContent: '## Golden Path\n\n1. 微信真机发送消息\n',
      contractContent: '[BEHAVIOR] 微信发消息',
      env: 'local_api',
    });

    const result = await runMechanicalGate(ctx, deps);

    expect(result.pass).toBe(false);
    // feedback 中应包含正确路由提示
    const reasonsText = result.reasons.join(' ');
    expect(reasonsText).toMatch(/theater_mismatch/);
    expect(reasonsText).toMatch(/windows_wechat|真机/);
  });
});

// ── SC-02: 元验证补丁 — smoke 类标题 + 无 L3 断言 → meta_verification_gap ──
describe('SC-02: meta_verification_gap — smoke 类标题 + 无 L3 断言', () => {
  it('smoke 标题 + contract 无 L3/THEATER 断言 → pass:false + meta_verification_gap', async () => {
    const ctx = baseCtx();
    const deps = makeDeps({
      prdContent: '# Sprint PRD — smoke 验证脚本演习\n\n## Golden Path\n\n1. 验证脚本执行\n',
      contractContent: '[BEHAVIOR] curl localhost/api\nTest: manual:curl localhost/api\n[BEHAVIOR] 检查返回码',
      env: 'local_api',
    });

    const result = await runMechanicalGate(ctx, deps);

    // TDD failing test：实现前此断言应当 FAIL
    expect(result.pass).toBe(false);
    expect(result.reasons.join(' ')).toMatch(/meta_verification_gap/);
  });

  it('「验证脚本」类标题 + contract 无 L3 断言 → meta_verification_gap', async () => {
    const ctx = baseCtx();
    const deps = makeDeps({
      prdContent: '# 验证脚本健康度检查\n\n## Golden Path\n\n1. 执行验证脚本\n',
      contractContent: '[BEHAVIOR] bash verify.sh\nTest: manual:bash verify.sh',
      env: 'local_api',
    });

    const result = await runMechanicalGate(ctx, deps);

    expect(result.pass).toBe(false);
    expect(result.reasons.join(' ')).toMatch(/meta_verification_gap/);
  });

  it('「演习」类标题 + contract 无 L3 断言 → meta_verification_gap', async () => {
    const ctx = baseCtx();
    const deps = makeDeps({
      prdContent: '# Sprint PRD — 演习场景\n\n## Golden Path\n\n1. 演习执行\n',
      contractContent: '[BEHAVIOR] 执行演习\nTest: manual:run exercise',
      env: 'local_api',
    });

    const result = await runMechanicalGate(ctx, deps);

    expect(result.pass).toBe(false);
    expect(result.reasons.join(' ')).toMatch(/meta_verification_gap/);
  });
});

// ── SC-03: 正常 local_api 服务端合同 → 不误伤（回归保护）───────────────────
describe('SC-03: 正常 local_api 合同不误伤（回归）', () => {
  it('无真机关键词、无 smoke 标题 → pass:true', async () => {
    const ctx = baseCtx();
    const deps = makeDeps({
      prdContent: '## Golden Path\n\n1. 调用 API 返回 200\n2. 响应体含 status: ok\n',
      contractContent: '[BEHAVIOR] curl localhost/api\nTest: manual:curl localhost/api',
      env: 'local_api',
    });

    const result = await runMechanicalGate(ctx, deps);

    expect(result.pass).toBe(true);
    expect(result.reasons).toHaveLength(0);
  });
});

// ── SC-04: mac_web 环境同样触发 theater_mismatch ─────────────────────────────
describe('SC-04: theater_mismatch — adb + mac_web', () => {
  it('GP 含 adb + mac_web → theater_mismatch', async () => {
    const ctx = baseCtx();
    const deps = makeDeps({
      prdContent: '## Golden Path\n\n1. adb shell 截取屏幕\n',
      contractContent: '[BEHAVIOR] adb screenshot',
      env: 'mac_web',
    });

    const result = await runMechanicalGate(ctx, deps);

    expect(result.pass).toBe(false);
    expect(result.reasons.join(' ')).toMatch(/theater_mismatch/);
  });
});

// ── SC-05: 元验证补丁豁免 — smoke 类 + contract 含 L3 → 不误判 ──────────────
describe('SC-05: meta_verification_gap 豁免 — contract 含 verification_level: L3', () => {
  it('验证脚本类 PRD + contract 含 verification_level: L3 → pass:true（不误判）', async () => {
    const ctx = baseCtx();
    const deps = makeDeps({
      prdContent: '# 验证脚本演习\n\n## Golden Path\n\n1. 执行真机验证\n',
      contractContent: '[BEHAVIOR] adb check device\nverification_level: L3\nTest: manual:adb check',
      env: 'local_api',
    });

    const result = await runMechanicalGate(ctx, deps);

    // contract 含 verification_level: L3 → 满足元验证要求，不触发 meta_verification_gap
    // 注意：adb 是真机关键词，但 local_api 环境下若 contract 明确声明 L3 也应豁免 theater check？
    // 保守语义：smoke+L3 仅豁免 meta_verification_gap；若同时含真机关键词+local_api 仍触发 theater_mismatch。
    // 本测试用 local_api + smoke 标题 + L3 且无 GP 真机关键词：只检查 meta_verification_gap 豁免。
    expect(result.reasons.join(' ')).not.toMatch(/meta_verification_gap/);
  });
});

// ── SC-06: THEATER_KEYWORDS_EXTRA env 扩展关键词 ─────────────────────────────
describe('SC-06: THEATER_KEYWORDS_EXTRA env 可扩展', () => {
  const ORIG_EXTRA = process.env.THEATER_KEYWORDS_EXTRA;

  afterEach(() => {
    if (ORIG_EXTRA === undefined) delete process.env.THEATER_KEYWORDS_EXTRA;
    else process.env.THEATER_KEYWORDS_EXTRA = ORIG_EXTRA;
  });

  it('THEATER_KEYWORDS_EXTRA=海外渠道，GP 含「海外渠道投放」→ theater_mismatch', async () => {
    process.env.THEATER_KEYWORDS_EXTRA = '海外渠道';

    const ctx = baseCtx();
    const deps = makeDeps({
      prdContent: '## Golden Path\n\n1. 海外渠道投放消息\n',
      contractContent: '[BEHAVIOR] push msg to overseas',
      env: 'local_api',
    });

    const result = await runMechanicalGate(ctx, deps);

    expect(result.pass).toBe(false);
    expect(result.reasons.join(' ')).toMatch(/theater_mismatch/);
  });

  it('THEATER_KEYWORDS_EXTRA 为空，GP 无默认真机关键词 → 不误触发', async () => {
    process.env.THEATER_KEYWORDS_EXTRA = '';

    const ctx = baseCtx();
    const deps = makeDeps({
      prdContent: '## Golden Path\n\n1. 推送通知到海外渠道\n',
      contractContent: '[BEHAVIOR] push notification',
      env: 'local_api',
    });

    const result = await runMechanicalGate(ctx, deps);

    // 「海外渠道」不在默认关键词列表，不应触发 theater_mismatch
    expect(result.reasons.join(' ')).not.toMatch(/theater_mismatch/);
  });
});

// ── SC-07: 大小写不敏感匹配 ─────────────────────────────────────────────────
describe('SC-07: 大小写不敏感匹配', () => {
  it('GP 含小写 uia → theater_mismatch（大小写不敏感）', async () => {
    const ctx = baseCtx();
    const deps = makeDeps({
      prdContent: '## Golden Path\n\n1. uia 自动化点击按钮\n',
      contractContent: '[BEHAVIOR] uia click',
      env: 'local_api',
    });

    const result = await runMechanicalGate(ctx, deps);

    expect(result.pass).toBe(false);
    expect(result.reasons.join(' ')).toMatch(/theater_mismatch/);
  });

  it('GP 含混合大小写 Adb Shell → theater_mismatch', async () => {
    const ctx = baseCtx();
    const deps = makeDeps({
      prdContent: '## Golden Path\n\n1. Adb Shell 安装 APK\n',
      contractContent: '[BEHAVIOR] install apk',
      env: 'local_api',
    });

    const result = await runMechanicalGate(ctx, deps);

    expect(result.pass).toBe(false);
    expect(result.reasons.join(' ')).toMatch(/theater_mismatch/);
  });
});

// ── SC-08: 真机边界声明四象限（债1 语境化，task d2567378）────────────────────
describe('SC-08: 真机边界声明四象限', () => {
  // 固定标题段：名词清单 + 零真机动作承诺 + 理由，三样缺一不可（人写给人看，机器只认标题）
  const DECLARATION = [
    '## 真机边界声明',
    '',
    '- 引用的真机名词：line02-android.yaml（配置文件名）、android 格号语义',
    '- 承诺：本合同零真机动作，全部断言在 local_api 内完成',
    '- 理由：本 sprint 只改调度器对格号字符串的解析，不驱动任何设备',
  ].join('\n');

  it('象限①无声明 + 名词引用 → 仍 FAIL（存量合同零行为变化）', async () => {
    const ctx = baseCtx();
    const deps = makeDeps({
      prdContent: '## Golden Path\n\n1. 解析 line02-android.yaml 的格号语义\n',
      contractContent: '[BEHAVIOR] node parse.js line02-android.yaml\nTest: tests/parse.test.js',
      env: 'local_api',
    });

    const result = await runMechanicalGate(ctx, deps);

    expect(result.pass).toBe(false);
    expect(result.reasons.join(' ')).toMatch(/theater_mismatch/);
  });

  it('象限②有声明 + 纯名词引用 → PASS 且 theater_declared:true 留痕', async () => {
    const ctx = baseCtx();
    const deps = makeDeps({
      prdContent: '## Golden Path\n\n1. 解析 line02-android.yaml 的格号语义\n',
      contractContent: `${DECLARATION}\n\n[BEHAVIOR] node parse.js line02-android.yaml\nTest: tests/parse.test.js`,
      env: 'local_api',
    });

    const result = await runMechanicalGate(ctx, deps);

    expect(result.reasons.join(' ')).not.toMatch(/theater_mismatch/);
    expect(result.pass).toBe(true);
    expect(result.theater_declared).toBe(true);
  });

  it('象限③有声明 + BEHAVIOR 命中动作词 → 仍 FAIL 且注明命中的动作词', async () => {
    const ctx = baseCtx();
    const deps = makeDeps({
      prdContent: '## Golden Path\n\n1. 解析 line02-android.yaml 的格号语义\n',
      contractContent: `${DECLARATION}\n\n[BEHAVIOR] adb shell input tap 100 200\nTest: manual:adb shell 截图比对`,
      env: 'local_api',
    });

    const result = await runMechanicalGate(ctx, deps);

    expect(result.pass).toBe(false);
    const reasonsText = result.reasons.join(' ');
    expect(reasonsText).toMatch(/theater_mismatch/);
    expect(reasonsText).toMatch(/声明存在但动作词命中/);
    expect(reasonsText).toMatch(/adb shell/);
    expect(result.theater_declared).not.toBe(true);
  });

  it('象限④无真机关键词 → PASS 且 theater_declared:false（回归）', async () => {
    const ctx = baseCtx();
    const deps = makeDeps({
      prdContent: '## Golden Path\n\n1. 调用 API 返回 200\n',
      contractContent: '[BEHAVIOR] curl localhost/api\nTest: manual:curl localhost/api',
      env: 'local_api',
    });

    const result = await runMechanicalGate(ctx, deps);

    expect(result.pass).toBe(true);
    expect(result.theater_declared).toBe(false);
  });

  it('声明段自带的「真机」二字不得顺手洗白 meta_verification_gap', async () => {
    // 声明段按写法必然含 android/真机 这类名词，而 ⑤ 闸认的就是「contract 里出现真机关键词」。
    // 不把声明段从 ⑤ 的扫描面里摘掉，加一段声明就等于白送一张 smoke 类交付的免检章。
    const ctx = baseCtx();
    const deps = makeDeps({
      prdContent: '# Sprint PRD — smoke 验证脚本演习\n\n## Golden Path\n\n1. 验证脚本执行\n',
      contractContent: `${DECLARATION}\n\n[BEHAVIOR] curl localhost/api\nTest: manual:curl localhost/api`,
      env: 'local_api',
    });

    const result = await runMechanicalGate(ctx, deps);

    expect(result.pass).toBe(false);
    expect(result.reasons.join(' ')).toMatch(/meta_verification_gap/);
  });

  it('声明只在轻量环境的名词象限生效：动作词表与名词表是两张表', async () => {
    // 名词表保留 android/真机 这类"提到即命中"的词，动作表只收真机上的实际操作，
    // 两表若合一，声明要么洗白一切、要么什么都洗不白。
    const { THEATER_REAL_MACHINE_KEYWORDS, THEATER_ACTION_KEYWORDS } = await import('../harness-judge.js');
    expect(THEATER_REAL_MACHINE_KEYWORDS).toContain('android');
    expect(THEATER_ACTION_KEYWORDS).not.toContain('android');
    expect(THEATER_ACTION_KEYWORDS.some((k) => k.toLowerCase().includes('adb shell'))).toBe(true);
  });
});

// ── 与 PRD [BEHAVIOR] 验收命令对齐的快速冒烟场景 ─────────────────────────────
describe('PRD BEHAVIOR 验收场景（与 sprint-prd.md 验收标准对齐）', () => {
  it('[BEHAVIOR-1] theater_mismatch: GP 含微信真机发送 + local_api → FAIL', async () => {
    const ctx = baseCtx({ taskId: 't1', sprintDir: 'x' });
    const deps = {
      readFileFn: async (p) => {
        if (p.includes('sprint-prd')) return '## Golden Path\n1. 微信真机发送消息\n';
        if (p.includes('contract')) return '[BEHAVIOR] cmd\nTest: adb shell send';
        throw new Error('ENOENT');
      },
      listTestFilesFn: async () => ['a.test.ts'],
      dbPool: { query: async () => ({ rows: [{ target_environment: 'local_api' }] }) },
    };

    const r = await runMechanicalGate(ctx, deps);
    expect(r.pass).toBe(false);
    expect(r.reasons.join(' ')).toMatch(/theater_mismatch/);
  });

  it('[BEHAVIOR-2] meta_verification_gap: smoke 标题 + 无 L3 断言 → FAIL', async () => {
    const ctx = baseCtx({ taskId: 't2', sprintDir: 'y' });
    const deps = {
      readFileFn: async (p) => {
        if (p.includes('sprint-prd')) return '# Sprint PRD — smoke 验证脚本演习\n## Golden Path\n1. 验证脚本执行\n';
        if (p.includes('contract')) return '[BEHAVIOR] curl localhost/api\nTest: manual:curl localhost/api';
        throw new Error('ENOENT');
      },
      listTestFilesFn: async () => ['a.test.ts'],
      dbPool: { query: async () => ({ rows: [{ target_environment: 'local_api' }] }) },
    };

    const r = await runMechanicalGate(ctx, deps);
    expect(r.pass).toBe(false);
    expect(r.reasons.join(' ')).toMatch(/meta_verification_gap/);
  });

  it('[BEHAVIOR-3] 正常 local_api 服务端合同不被误伤', async () => {
    const ctx = baseCtx({ taskId: 't3', sprintDir: 'z' });
    const deps = {
      readFileFn: async (p) => {
        if (p.includes('sprint-prd')) return '## Golden Path\n1. 调用 API 返回 200\n';
        if (p.includes('contract')) return '[BEHAVIOR] curl localhost/api\nTest: manual:curl localhost/api';
        throw new Error('ENOENT');
      },
      listTestFilesFn: async () => ['a.test.ts'],
      dbPool: { query: async () => ({ rows: [{ target_environment: 'local_api' }] }) },
    };

    const r = await runMechanicalGate(ctx, deps);
    expect(r.pass).toBe(true);
  });
});
