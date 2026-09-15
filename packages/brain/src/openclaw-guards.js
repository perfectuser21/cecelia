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
const STATE = '/opt/openclaw/state';
const WORKSPACES = '/opt/openclaw/workspaces-root';
const MEM_LIMIT_MB = 1400;
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
export function memGuardDecision({ mb, minute }) {
  if (mb == null || mb < MEM_LIMIT_MB) return 'ok';
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

/** 返回 null=形状合规；否则返回漂移描述 */
export function checkConfigDrift(cfg) {
  const primary = cfg?.agents?.defaults?.model?.primary;
  if (primary !== 'openai/gpt-5.6-terra') return `primary回落:${primary}`;
  const a = findAppServer(cfg);
  if (!a || a.command !== '/usr/bin/ssh') return 'appServer非ssh下放形态';
  if (!(a.args || []).join(' ').includes('session-runner')) return 'appServer未走跑场池别名';
  return null;
}

export function restoreConfigShape(cfg) {
  const d = JSON.parse(JSON.stringify(cfg));
  d.agents.defaults.model.primary = 'openai/gpt-5.6-terra';
  d.agents.defaults.model.fallbacks = ['openai/gpt-5.6-sol'];
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

  return out;
}
