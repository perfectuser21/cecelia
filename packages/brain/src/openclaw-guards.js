/**
 * openclaw-guards.js — us-vps 零执行守卫（决策 95477a66 收编版）
 *
 * 前身是三个宿主 crontab bash（mem-guard/config-guard/session-runner-router），
 * 散装脚本不进 repo、无测试、运行舱不可见——收编为 Brain scheduler job。
 * 职责：①网关内存泄漏回收 ②配置漂移还原（对话必须进跑场池）③agent 教义补种
 * ④会话跑场探活路由。全部纯函数内核 + 注入式 IO，可单测。
 */
import { execFileSync } from 'child_process';
import { readFileSync, writeFileSync, appendFileSync, existsSync, readdirSync } from 'fs';

export const DOCTRINE_MARK = '## 跑场下放铁律';
// docker top 的 ps args 必须含 pid，否则 daemon 报 "Couldn't find PID field in ps output"
// （2026-09-16 实证：-eo comm 导致观测线一直空跑，错误被 catch 吞掉）
export const MEMLOG_PS_ARGS = Object.freeze(['top', 'openclaw-gateway', '-eo', 'pid,comm']);
const STATE = '/opt/openclaw/state';
const WORKSPACES = '/opt/openclaw/workspaces-root';
// 2026-09-16 escort 误伤案校正：网关多会话正常工作态 1.4-1.7G（夜间值守更高），
// 旧阈值 1400 把正常体温当泄漏一天误摁 9 次、打断在跑 escort。默认抬到 2000，
// 容器 cgroup 硬顶同步抬 2.29G（阈值必须 < 硬顶，否则守卫永远抢不到 OOM 前面）。
// env 可调免发版；真泄漏判据改由 memlog 观测线甄别（会话归零后不回落=真漏）。
const MEM_LIMIT_MB = parseInt(process.env.OPENCLAW_MEM_LIMIT_MB || '2000', 10);
const RUNNERS = Object.freeze([
  { name: 'MMV', ip: '100.71.151.105', user: 'administrator' },
  { name: 'XIAN-M4', ip: '100.86.57.69', user: 'jinnuoshengyuan' },
  { name: 'XIAN-M1', ip: '100.88.166.55', user: 'xx-macmini' },
]);

export function parseMemMB(s) {
  const t = String(s).trim();
  if (t.endsWith('GiB')) return Math.round(parseFloat(t) * 1024);
  if (t.endsWith('MiB')) return Math.round(parseFloat(t));
  return null;
}

/** 判定 agent 的 cron 在整/半点执行（±3min）——该窗口内顺延重启 */
export function memGuardDecision({ mb, minute, limitMb = MEM_LIMIT_MB }) {
  if (mb == null || mb < limitMb) return 'ok';
  if (minute >= 57 || minute <= 3 || (minute >= 27 && minute <= 33)) return 'defer';
  return 'restart';
}

function findAppServer(o) {
  if (o && typeof o === 'object') {
    for (const [k, v] of Object.entries(o)) {
      if (k === 'codex' && v?.config?.appServer && typeof v.config.appServer === 'object') {
        return v.config.appServer;
      }
      const r = findAppServer(v);
      if (r) return r;
    }
  }
  return null;
}

// 本机 embedded runtime 的模型（无 agentRuntime:codex）= 会话在网关同机跑。
// 跑场池模型走 ssh 管子到 MMV/M4/M1。sol 只允许出现在 fallbacks（断池保命）。
const LOCAL_EMBEDDED_MODEL = 'openai/gpt-5.6-sol';
const POOL_MODEL = 'openai/gpt-5.6-terra';

function primaryOf(model) {
  if (!model) return null;
  return typeof model === 'string' ? model : model.primary ?? null;
}

/** 返回 null=形状合规；否则返回漂移描述 */
export function checkConfigDrift(cfg) {
  const primary = cfg?.agents?.defaults?.model?.primary;
  if (primary !== POOL_MODEL) return `primary回落:${primary}`;
  // agent 级覆盖会绕过 defaults（2026-09-16 实证 6 个 agent 仍在本机跑）——逐个点名
  const local = Object.entries(cfg?.agents?.entries || {})
    .filter(([, a]) => primaryOf(a.model) === LOCAL_EMBEDDED_MODEL)
    .map(([name]) => name);
  if (local.length > 0) return `agent本机embedded漏网:${local.join(',')}`;
  const a = findAppServer(cfg);
  if (!a || a.command !== '/usr/bin/ssh') return 'appServer非ssh下放形态';
  if (!(a.args || []).join(' ').includes('session-runner')) return 'appServer未走跑场池别名';
  return null;
}

export function restoreConfigShape(cfg) {
  const d = JSON.parse(JSON.stringify(cfg));
  d.agents.defaults.model.primary = POOL_MODEL;
  d.agents.defaults.model.fallbacks = [LOCAL_EMBEDDED_MODEL];
  // agent 级 sol 覆盖一并拉回池（保留原 fallbacks 作断池兜底）
  for (const a of Object.values(d.agents.entries || {})) {
    if (primaryOf(a.model) !== LOCAL_EMBEDDED_MODEL) continue;
    const prevFallbacks = (typeof a.model === 'object' && a.model.fallbacks) || [];
    a.model = {
      primary: POOL_MODEL,
      fallbacks: prevFallbacks.length ? prevFallbacks : [LOCAL_EMBEDDED_MODEL],
    };
  }
  const a = findAppServer(d);
  if (a) {
    a.command = '/usr/bin/ssh';
    a.args = ['-F', '/root/.openclaw/ssh-router.conf', 'session-runner',
      'env', 'CODEX_HOME=$HOME/.codex-gwremote',
      '/opt/homebrew/bin/codex', '-c', 'cli_auth_credentials_store="ephemeral"',
      'app-server', '--listen', 'stdio://'];
  }
  return d;
}

/** 缺教义的工作区 → 补种计划（content=null 表示无 AGENTS.md，整份新建） */
export function doctrineSeedPlan({ template, workspaces }) {
  const idx = template.indexOf(DOCTRINE_MARK);
  if (idx < 0) return [];
  const doctrine = template.slice(idx);
  return workspaces
    .filter((w) => !(w.content || '').includes(DOCTRINE_MARK))
    .map((w) => ({ dir: w.dir, append: `\n${doctrine}\n` }));
}

/**
 * 触达线活性判据（2026-09-16 空转 22h 静默案）：
 * 读 xian-m4 ~/outreach.log 尾部，看最近若干 tick 是否「只失败不出单」。
 * 拟人跳过/无待触达是正常态（idle），不得误报；有成功单即 healthy。
 */
export function parseOutreachHealth(logTail) {
  const lines = String(logTail || '').split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return { verdict: 'unknown', stalledTicks: 0, reason: null };
  let stalled = 0;
  let reason = null;
  for (const l of lines) {
    if (/单#\d+:/.test(l) || /已发送|发送成功/.test(l)) {
      return { verdict: 'healthy', stalledTicks: 0, reason: null };
    }
    const m = l.match(/话术缺失: (\S+)|发送失败|锁获取失败|异常/);
    if (m) { stalled += 1; reason = reason || (m[1] ? `NO_SCRIPT(${m[1].replace('NO_SCRIPT ', '')})` : m[0]); }
  }
  if (stalled >= 3) return { verdict: 'stalled', stalledTicks: stalled, reason };
  if (stalled > 0) return { verdict: 'degraded', stalledTicks: stalled, reason };
  return { verdict: 'idle', stalledTicks: 0, reason: null };
}

export function pickRunner(probeFn) {
  for (const r of RUNNERS) {
    if (probeFn(`${r.user}@${r.ip}`)) return r;
  }
  return null;
}

export function renderRouterConf({ name, ip, user }) {
  return `# 会话跑场路由（Brain openclaw-guards 自动改写; 当前=${name}）
Host session-runner
  HostName ${ip}
  User ${user}
  IdentityFile /root/.openclaw/mmv_key
  BatchMode yes
  StrictHostKeyChecking accept-new
  ServerAliveInterval 15
  ServerAliveCountMax 4
`;
}

// ——— 运行时组装（IO 全注入，默认真实现）———
const defaultIO = {
  exec: (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: 'utf8', timeout: 20_000, ...opts }),
  read: (p) => (existsSync(p) ? readFileSync(p, 'utf8') : null),
  write: writeFileSync,
  append: appendFileSync,
  listDirs: (p) => (existsSync(p) ? readdirSync(p).filter((n) => n.startsWith('clawd')) : []),
  now: () => new Date(),
  log: (m) => console.log(`[openclaw-guards] ${m}`),
};

let lastRunAt = 0;
const INTERVAL_MS = parseInt(process.env.OPENCLAW_GUARDS_INTERVAL_MS || String(5 * 60 * 1000), 10);

export async function runOpenclawGuards(_pool, opts = {}) {
  const now = opts.nowMs ?? Date.now();
  if (now - lastRunAt < INTERVAL_MS) return { skipped: true };
  lastRunAt = now;
  const io = { ...defaultIO, ...(opts.io || {}) };
  const out = {};

  // ① 内存守卫
  try {
    const raw = io.exec('docker', ['stats', '--no-stream', '--format', '{{.MemUsage}}', 'openclaw-gateway']);
    const mb = parseMemMB(String(raw).split('/')[0]);
    const decision = memGuardDecision({ mb, minute: io.now().getMinutes() });
    // 泄漏甄别观测线（escort 案后立）：会话数归零后 mem 不回落基线才是真泄漏。
    try {
      const ps = io.exec('docker', MEMLOG_PS_ARGS);
      const lines = String(ps).split('\n');
      const sessions = lines.filter((l) => /^openclaw$/.test(l.trim())).length;
      const mcp = lines.filter((l) => l.includes('node')).length;
      io.log(`memlog mem=${mb}MB sessions=${sessions} nodeprocs=${mcp} decision=${decision}`);
    } catch { /* 观测失败不影响守卫 */ }
    if (decision === 'restart') {
      io.log(`gateway 内存 ${mb}MB 超阈，温和重启回收泄漏`);
      io.exec('docker', ['restart', 'openclaw-gateway'], { timeout: 120_000 });
    }
    out.mem = { mb, decision };
  } catch (e) { out.mem = { error: e.message }; }

  // ② 配置漂移
  try {
    const confPath = `${STATE}/clawdbot.json`;
    const cfg = JSON.parse(io.read(confPath));
    const drift = checkConfigDrift(cfg);
    if (drift && !io.read(`${STATE}/.allow-local-primary`)) {
      io.log(`配置漂移(${drift})，自动还原铁律形状并重启网关`);
      io.write(confPath, JSON.stringify(restoreConfigShape(cfg), null, 2));
      io.exec('docker', ['restart', 'openclaw-gateway'], { timeout: 120_000 });
    }
    out.config = { drift: drift || null };
  } catch (e) { out.config = { error: e.message }; }

  // ③ 教义补种
  try {
    const template = io.read(`${WORKSPACES}/clawd/AGENTS.md`) || '';
    const workspaces = io.listDirs(WORKSPACES).map((n) => ({
      dir: `${WORKSPACES}/${n}`, content: io.read(`${WORKSPACES}/${n}/AGENTS.md`),
    }));
    const plan = doctrineSeedPlan({ template, workspaces });
    for (const p of plan) {
      io.append(`${p.dir}/AGENTS.md`, p.append);
      io.log(`教义补种 -> ${p.dir}`);
    }
    out.doctrine = { seeded: plan.length };
  } catch (e) { out.doctrine = { error: e.message }; }

  // ④ 跑场路由
  try {
    const probe = (target) => {
      try {
        io.exec('ssh', ['-i', `${STATE}/mmv_key`, '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5',
          '-o', 'StrictHostKeyChecking=accept-new', target, 'true'], { timeout: 10_000 });
        return true;
      } catch { return false; }
    };
    const runner = pickRunner(opts.probeFn || probe);
    if (runner) {
      const confPath = `${STATE}/ssh-router.conf`;
      const cur = io.read(confPath) || '';
      if (!cur.includes(`HostName ${runner.ip}`)) {
        io.write(confPath, renderRouterConf(runner));
        io.log(`跑场切换 -> ${runner.name} (${runner.ip})`);
      }
      out.router = { runner: runner.name };
    } else {
      out.router = { runner: null };
      io.log('全部跑场不可达，保持现状');
    }
  } catch (e) { out.router = { error: e.message }; }

  // ⑤ 触达线活性（空转必须上浮，不再静默）
  try {
    const target = 'jinnuoshengyuan@100.86.57.69';
    const tail = io.exec('ssh', ['-i', `${STATE}/mmv_key`, '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8',
      '-o', 'StrictHostKeyChecking=accept-new', target, 'tail -12 ~/outreach.log 2>/dev/null || true']);
    const health = parseOutreachHealth(tail);
    out.outreach = health;
    if (health.verdict === 'stalled') {
      io.log(`触达线空转 ${health.stalledTicks} 轮（${health.reason}）——告警上浮`);
      if (opts.raiseFn) {
        await opts.raiseFn('P1', 'outreach_stalled',
          `触达线空转 ${health.stalledTicks} 轮：${health.reason}。检查飞书话术表「启用状态」。`,
          { debounce: { windowMin: 180, threshold: 1 } });
      }
    }
  } catch (e) { out.outreach = { error: e.message }; }

  return out;
}
