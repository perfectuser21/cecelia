import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockQuery = vi.fn();
const mockIsConsciousnessEnabled = vi.fn(() => true);
const mockGetConsciousnessStatus = vi.fn(() => ({ enabled: true, env_override: false, last_toggled_at: null }));

const mockGetSelfDriveStatus = vi.fn(() => ({ running: true, interval_ms: 14400000, max_tasks_per_cycle: 3 }));
const mockStartSelfDriveLoop = vi.fn().mockResolvedValue(undefined);

vi.mock('../db.js', () => ({
  default: { query: mockQuery },
}));
vi.mock('../auto-fix.js', () => ({ shouldAutoFix: vi.fn(() => false), dispatchToDevSkill: vi.fn() }));
vi.mock('../executor.js', () => ({ getActiveProcessCount: vi.fn(() => 0), MAX_SEATS: 10 }));
vi.mock('../alerting.js', () => ({ sendAlert: vi.fn() }));
vi.mock('../cortex.js', () => ({ performRCA: vi.fn() }));
vi.mock('../monitor-loop.js', () => ({ getMonitorStatus: vi.fn(() => ({ running: true, interval_ms: 30000 })) }));
vi.mock('../consciousness-guard.js', () => ({
  isConsciousnessEnabled: () => mockIsConsciousnessEnabled(),
  getConsciousnessStatus: () => mockGetConsciousnessStatus(),
  setConsciousnessEnabled: vi.fn(),
  initConsciousnessGuard: vi.fn(),
  logStartupDeclaration: vi.fn(),
  _resetCacheForTest: vi.fn(),
  _resetDeprecationWarn: vi.fn(),
  GUARDED_MODULES: [],
}));
vi.mock('../self-drive.js', () => ({
  getSelfDriveStatus: () => mockGetSelfDriveStatus(),
  startSelfDriveLoop: () => mockStartSelfDriveLoop(),
}));

describe('capability-probe high-level probes', () => {
  it('should include rumination, evolution, consolidation, self_drive_health probes', async () => {
    const { PROBES } = await import('../capability-probe.js');
    const names = PROBES.map(p => p.name);
    expect(names).toContain('rumination');
    expect(names).toContain('evolution');
    expect(names).toContain('consolidation');
    expect(names).toContain('self_drive_health');
  });

  it('should have at least 10 probes total', async () => {
    const { PROBES } = await import('../capability-probe.js');
    expect(PROBES.length).toBeGreaterThanOrEqual(10);
  });
});

describe('self_drive_health probe logic', () => {
  beforeEach(() => {
    vi.resetModules();
    mockQuery.mockReset();
    mockIsConsciousnessEnabled.mockReturnValue(true);
    mockGetConsciousnessStatus.mockReturnValue({ enabled: true, env_override: false, last_toggled_at: null });
    mockGetSelfDriveStatus.mockReset();
    mockGetSelfDriveStatus.mockReturnValue({ running: true, interval_ms: 14400000, max_tasks_per_cycle: 3 });
    mockStartSelfDriveLoop.mockReset();
    mockStartSelfDriveLoop.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('should return ok:true when cycle_complete events exist in 24h', async () => {
    // 有 cycle_complete 事件 → 探针应成功
    mockQuery.mockResolvedValue({
      rows: [{
        success_cnt: '2',
        error_cnt: '1',
        last_success: new Date().toISOString(),
        total_tasks_created: '3',
      }],
    });

    const { PROBES } = await import('../capability-probe.js');
    const probe = PROBES.find(p => p.name === 'self_drive_health');
    expect(probe).toBeDefined();
    const result = await probe.fn();
    expect(result.ok).toBe(true);
    expect(result.detail).toContain('successful_cycles=2');
    expect(result.detail).toContain('errors=1');
  });

  it('should return ok:true when only no_action events exist (LLM healthy but no tasks needed)', async () => {
    // 只有 no_action 事件（LLM 正常但判断无需行动）→ 探针应成功（不误判为失败）
    mockQuery.mockResolvedValue({
      rows: [{
        success_cnt: '3',
        error_cnt: '0',
        last_success: new Date().toISOString(),
        total_tasks_created: '0',
      }],
    });

    const { PROBES } = await import('../capability-probe.js');
    const probe = PROBES.find(p => p.name === 'self_drive_health');
    const result = await probe.fn();
    expect(result.ok).toBe(true);
    expect(result.detail).toContain('successful_cycles=3');
  });

  it('should return ok:false when all cycles are errors (LLM consistently failing)', async () => {
    // 全部 cycle_error（LLM 调用失败）→ 探针应失败
    mockQuery.mockResolvedValue({
      rows: [{
        success_cnt: '0',
        error_cnt: '8',
        last_success: null,
        total_tasks_created: '0',
      }],
    });

    const { PROBES } = await import('../capability-probe.js');
    const probe = PROBES.find(p => p.name === 'self_drive_health');
    const result = await probe.fn();
    expect(result.ok).toBe(false);
    expect(result.detail).toContain('successful_cycles=0');
    expect(result.detail).toContain('errors=8');
    expect(result.detail).toContain('last_success=never');
  });

  it('should return ok:false when no self_drive events in 24h', async () => {
    // 24h 内无任何事件 → 探针应失败
    mockQuery.mockResolvedValue({
      rows: [{
        success_cnt: '0',
        error_cnt: '0',
        last_success: null,
        total_tasks_created: '0',
        last_loop_started: null,
      }],
    });

    const { PROBES } = await import('../capability-probe.js');
    const probe = PROBES.find(p => p.name === 'self_drive_health');
    const result = await probe.fn();
    expect(result.ok).toBe(false);
  });

  it('should return ok:true when loop_started within 6h and no errors (grace period)', async () => {
    // loop_started 30 分钟前，无 cycle → ok: true（宽限期，等待首次 cycle）
    const recentStart = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    mockQuery.mockResolvedValue({
      rows: [{
        success_cnt: '0',
        error_cnt: '0',
        last_success: null,
        total_tasks_created: '0',
        last_loop_started: recentStart,
      }],
    });

    const { PROBES } = await import('../capability-probe.js');
    const probe = PROBES.find(p => p.name === 'self_drive_health');
    const result = await probe.fn();
    expect(result.ok).toBe(true);
    expect(result.detail).toContain('awaiting_first_cycle');
  });

  it('should return ok:false when loop_started within 6h but has errors', async () => {
    // loop_started 10 分钟前，但已有 cycle_error → 宽限期不宽恕错误，探针应失败
    const recentStart = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    mockQuery.mockResolvedValue({
      rows: [{
        success_cnt: '0',
        error_cnt: '2',
        last_success: null,
        total_tasks_created: '0',
        last_loop_started: recentStart,
      }],
    });

    const { PROBES } = await import('../capability-probe.js');
    const probe = PROBES.find(p => p.name === 'self_drive_health');
    const result = await probe.fn();
    expect(result.ok).toBe(false);
    expect(result.detail).toContain('errors=2');
  });

  it('should return ok:false when loop_started over 6h ago with no cycles (truly stuck)', async () => {
    // loop_started 7 小时前，无 cycle → 超过宽限期，探针应失败
    const oldStart = new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString();
    mockQuery.mockResolvedValue({
      rows: [{
        success_cnt: '0',
        error_cnt: '0',
        last_success: null,
        total_tasks_created: '0',
        last_loop_started: oldStart,
      }],
    });

    const { PROBES } = await import('../capability-probe.js');
    const probe = PROBES.find(p => p.name === 'self_drive_health');
    const result = await probe.fn();
    expect(result.ok).toBe(false);
    expect(result.detail).toContain('successful_cycles=0');
  });

  it('should return ok:true when consciousness is disabled via env (self-drive intentionally inactive)', async () => {
    // CONSCIOUSNESS_ENABLED=false → self-drive 从不启动，探针不应触发 auto-fix 循环
    mockIsConsciousnessEnabled.mockReturnValue(false);
    mockGetConsciousnessStatus.mockReturnValue({ enabled: false, env_override: true, last_toggled_at: null });

    const { PROBES } = await import('../capability-probe.js');
    const probe = PROBES.find(p => p.name === 'self_drive_health');
    const result = await probe.fn();
    expect(result.ok).toBe(true);
    expect(result.detail).toContain('consciousness_disabled');
    expect(result.detail).toContain('env_override');
    // 不应进行 DB 查询（probe 在 consciousness 检查后立即返回）
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('should return ok:true when consciousness is disabled via DB (self-drive intentionally inactive)', async () => {
    // DB 存储的 consciousness=false → 同上，探针应通过
    mockIsConsciousnessEnabled.mockReturnValue(false);
    mockGetConsciousnessStatus.mockReturnValue({ enabled: false, env_override: false, last_toggled_at: null });

    const { PROBES } = await import('../capability-probe.js');
    const probe = PROBES.find(p => p.name === 'self_drive_health');
    const result = await probe.fn();
    expect(result.ok).toBe(true);
    expect(result.detail).toContain('consciousness_disabled');
    expect(result.detail).toContain('db');
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('should return ok:true and restart loop when consciousness enabled but self-drive loop not running', async () => {
    // 场景：consciousness 运行时被重新启用（如 rumination 探针自愈 setConsciousnessEnabled(true)）
    // 但 startSelfDriveLoop 只在 server.js 启动时调用，loop 永远不会重启
    // 探针应检测到 loop 未运行，自动重启，返回 ok:true
    mockIsConsciousnessEnabled.mockReturnValue(true);
    mockGetSelfDriveStatus.mockReturnValue({ running: false, interval_ms: 14400000, max_tasks_per_cycle: 3 });

    const { PROBES } = await import('../capability-probe.js');
    const probe = PROBES.find(p => p.name === 'self_drive_health');
    const result = await probe.fn();

    expect(result.ok).toBe(true);
    expect(result.detail).toContain('self_heal=loop_restarted');
    // 确认 startSelfDriveLoop 被调用
    expect(mockStartSelfDriveLoop).toHaveBeenCalledOnce();
    // 自愈直接返回，不应查询 DB
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('should fall through to DB check when loop-not-running self-heal fails', async () => {
    // 自愈失败时（如 startSelfDriveLoop 本身抛异常），探针继续走正常路径查询 DB
    mockIsConsciousnessEnabled.mockReturnValue(true);
    mockGetSelfDriveStatus.mockReturnValue({ running: false, interval_ms: 14400000, max_tasks_per_cycle: 3 });
    mockStartSelfDriveLoop.mockRejectedValue(new Error('DB connection lost'));

    // DB 查询返回 0 事件
    mockQuery.mockResolvedValue({
      rows: [{
        success_cnt: '0',
        error_cnt: '0',
        last_success: null,
        total_tasks_created: '0',
        last_loop_started: null,
      }],
    });

    const { PROBES } = await import('../capability-probe.js');
    const probe = PROBES.find(p => p.name === 'self_drive_health');
    const result = await probe.fn();

    // 自愈失败 → 走 DB 查询 → 0 事件 → ok:false
    expect(result.ok).toBe(false);
    expect(mockQuery).toHaveBeenCalled();
  });

  it('should not self-heal when loop is already running', async () => {
    // loop 已在运行，不应触发 self-heal（避免干扰正常运行中的 loop）
    mockIsConsciousnessEnabled.mockReturnValue(true);
    mockGetSelfDriveStatus.mockReturnValue({ running: true, interval_ms: 14400000, max_tasks_per_cycle: 3 });

    // DB 查询返回正常事件
    mockQuery.mockResolvedValue({
      rows: [{
        success_cnt: '2',
        error_cnt: '0',
        last_success: new Date().toISOString(),
        total_tasks_created: '1',
        last_loop_started: null,
      }],
    });

    const { PROBES } = await import('../capability-probe.js');
    const probe = PROBES.find(p => p.name === 'self_drive_health');
    const result = await probe.fn();

    expect(result.ok).toBe(true);
    // 不应调用 startSelfDriveLoop（loop 已运行）
    expect(mockStartSelfDriveLoop).not.toHaveBeenCalled();
  });

  it('startProbeLoop should establish setInterval before first cycle (loop survives hung first run)', async () => {
    // 验证 startProbeLoop 修复：setInterval 应在 setTimeout 之前建立
    // 即使首次 cycle 挂起，_probeTimer 也已设置，后续探测可继续
    vi.useFakeTimers();
    const { startProbeLoop, getProbeStatus } = await import('../capability-probe.js');

    startProbeLoop();
    // setInterval 应立即建立（不等 30s 初始延迟）
    expect(getProbeStatus().running).toBe(true);

    vi.useRealTimers();
  });

  it('should return ok:true via in-memory grace when loop running but DB events missing (transient DB write failure)', async () => {
    // 场景：Brain 启动后 loop 开始运行，loop_started DB 写入失败（DB 短暂不可用）
    // 2min 首次 cycle 的 no_action 事件也未写入 DB
    // 但 loop 在内存中 IS 运行中，started_at = 30min 前
    // 探针应通过（in-memory grace），而不是误报失败触发无限 auto-fix 循环
    const recentInMemStart = new Date(Date.now() - 30 * 60 * 1000);
    mockGetSelfDriveStatus.mockReturnValue({
      running: true,
      interval_ms: 14400000,
      max_tasks_per_cycle: 3,
      started_at: recentInMemStart,
    });

    mockQuery.mockResolvedValue({
      rows: [{
        success_cnt: '0',
        error_cnt: '0',
        last_success: null,
        total_tasks_created: '0',
        last_loop_started: null, // DB write failed — event not recorded
      }],
    });

    const { PROBES } = await import('../capability-probe.js');
    const probe = PROBES.find(p => p.name === 'self_drive_health');
    const result = await probe.fn();

    expect(result.ok).toBe(true);
    expect(result.detail).toContain('db_event_missing');
    expect(result.detail).toContain('awaiting_first_cycle');
  });

  it('should return ok:false when in-memory started_at is over 6h ago with no DB events (genuinely stuck)', async () => {
    // loop 在内存中运行，但 started_at = 7h 前，无任何 DB 事件
    // 超过宽限期 → 应报告失败（真实的 cycle 未执行）
    const oldInMemStart = new Date(Date.now() - 7 * 60 * 60 * 1000);
    mockGetSelfDriveStatus.mockReturnValue({
      running: true,
      interval_ms: 14400000,
      max_tasks_per_cycle: 3,
      started_at: oldInMemStart,
    });

    mockQuery.mockResolvedValue({
      rows: [{
        success_cnt: '0',
        error_cnt: '0',
        last_success: null,
        total_tasks_created: '0',
        last_loop_started: null,
      }],
    });

    const { PROBES } = await import('../capability-probe.js');
    const probe = PROBES.find(p => p.name === 'self_drive_health');
    const result = await probe.fn();

    expect(result.ok).toBe(false);
    expect(result.detail).toContain('successful_cycles=0');
    expect(result.detail).toContain('last_success=never');
  });

  it('should return ok:false when in-memory started_at is recent but cycle errors exist (real failure)', async () => {
    // loop 在内存中刚启动（30min 前），但已有 cycle_error → 不应使用 in-memory grace
    // 有错误表明 LLM/系统真实失败，不是 DB 写入问题
    const recentInMemStart = new Date(Date.now() - 30 * 60 * 1000);
    mockGetSelfDriveStatus.mockReturnValue({
      running: true,
      interval_ms: 14400000,
      max_tasks_per_cycle: 3,
      started_at: recentInMemStart,
    });

    mockQuery.mockResolvedValue({
      rows: [{
        success_cnt: '0',
        error_cnt: '3',
        last_success: null,
        total_tasks_created: '0',
        last_loop_started: null,
      }],
    });

    const { PROBES } = await import('../capability-probe.js');
    const probe = PROBES.find(p => p.name === 'self_drive_health');
    const result = await probe.fn();

    expect(result.ok).toBe(false);
    expect(result.detail).toContain('errors=3');
  });
});
