/**
 * capability-probe CI 门测试：CI 沙箱环境下 startProbeLoop() 必须直接 return，
 * 不建立 30s 首跑 + 1h interval 定时器。
 *
 * 根因：CI real-env-smoke 的半真环境里 probe 30s 首跑必产生失败探针
 * （PROBE_FAIL_EVOLUTION），自驱创建 Auto-Fix 任务抢占派发，
 * 导致 harness-pre-merge-gate-smoke.sh L3 的任务 3 分钟内 spawn 不出容器。
 *
 * 取舍说明：本文件不 mock capability-probe.js 本体（要验证真实门逻辑），
 * 而是 mock 其依赖（db/auto-fix/alerting/consciousness-guard）避免真实 DB 连接。
 * 门必须在 startProbeLoop() 最开头短路，CI=true 时不得进入
 * setInterval/setTimeout 分支，否则会在测试进程留下悬挂 timer。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../db.js', () => ({ default: { query: vi.fn().mockResolvedValue({ rows: [] }), connect: vi.fn() } }));
vi.mock('../auto-fix.js', () => ({ shouldAutoFix: vi.fn(), dispatchToDevSkill: vi.fn() }));
vi.mock('../alerting.js', () => ({ raise: vi.fn() }));
vi.mock('../consciousness-guard.js', () => ({
  isConsciousnessEnabled: vi.fn().mockResolvedValue(true),
  setConsciousnessEnabled: vi.fn(),
  getConsciousnessStatus: vi.fn(),
}));

import { startProbeLoop, getProbeStatus } from '../capability-probe.js';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('capability-probe CI 门', () => {
  it('CI=true 时 startProbeLoop() 不启动定时器，getProbeStatus().running 为 false', () => {
    vi.stubEnv('CI', 'true');

    startProbeLoop();

    expect(getProbeStatus().running).toBe(false);
  });

  // real-env-smoke 的 brain 跑在 docker 容器里（ci.yml `docker run -e NODE_ENV=test`），
  // 容器内没有 CI 变量、只有 NODE_ENV=test，门条件必须也认这个信号，否则 probe 照跑。
  // 注意：vitest 进程本身 NODE_ENV 就是 test，此用例其实一直被"环境本身就是 test"兜底，
  // 但仍显式 stub 以固化契约，防止将来 vitest 配置变化导致门失效而无感知。
  it('NODE_ENV=test 时 startProbeLoop() 不启动定时器，getProbeStatus().running 为 false', () => {
    vi.stubEnv('NODE_ENV', 'test');

    startProbeLoop();

    expect(getProbeStatus().running).toBe(false);
  });
});
