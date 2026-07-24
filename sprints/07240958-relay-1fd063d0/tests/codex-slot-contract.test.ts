import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const repo = process.cwd();
const file = (relative: string) => join(repo, relative);

function readRequired(relative: string): string {
  const target = file(relative);
  expect(existsSync(target), `缺少合同要求的文件: ${relative}`).toBe(true);
  return readFileSync(target, 'utf8');
}

describe('完整 Codex Slot 安全硬切换 [BEHAVIOR]', () => {
  it('旧 codex-request 只返回 codex-slot start 迁移提示且不再描述 scp', () => {
    const result = spawnSync('bash', [file('scripts/codex-request.sh'), '--help'], {
      encoding: 'utf8',
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('codex-slot start');
    expect(result.stdout).not.toMatch(/\bscp\b|拉取.*token|--team/);
  });

  it('旧 codex-remote-launch 只返回 codex-slot start 迁移提示且不再描述推送 token', () => {
    const result = spawnSync('bash', [file('scripts/codex-remote-launch.sh'), '--help'], {
      encoding: 'utf8',
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('codex-slot start');
    expect(result.stdout).not.toMatch(/\bscp\b|推送 token|--team|--collect/);
  });

  it('新 client 拒绝 actor team host authority flags', () => {
    const result = spawnSync(
      process.execPath,
      [
        file('scripts/codex-slot-client.mjs'),
        'start',
        '--actor',
        'forged',
        '--team',
        'team1',
        '--host',
        'xian-m4',
      ],
      { encoding: 'utf8' },
    );
    expect(result.status).toBe(64);
    expect(`${result.stdout}\n${result.stderr}`).toContain('authority flags are forbidden');
  });

  it('Brain codex-slots 路由使用 fail-closed 鉴权且 wiring 存在', () => {
    const route = readRequired('packages/brain/src/routes/codex-slots.js');
    const wiring = readRequired('packages/brain/src/routes.js');
    expect(route).toContain('CODEX_SLOT_BROKER_TOKEN');
    expect(route).toContain('timingSafeEqual');
    expect(route).not.toContain('未设置时放行');
    expect(wiring).toContain("router.use('/codex-slots'");
  });

  it('数据库含 tenant_id 与单账号阻塞租约唯一约束', () => {
    const migration = readRequired('packages/brain/migrations/360_codex_slot.sql');
    expect(migration).toContain('tenant_id');
    expect(migration).toMatch(/UNIQUE INDEX[\s\S]*account_ref[\s\S]*active[\s\S]*quarantined[\s\S]*blocked/i);
    expect(migration).toContain('codex_slot_sessions');
    expect(migration).toContain('codex_slot_audit_events');
  });

  it('真实 PostgreSQL 已应用 tenant-scoped codex_slot schema', () => {
    const dbUrl = process.env.DB_URL || 'postgresql://localhost/cecelia';
    const result = spawnSync(
      'psql',
      [
        dbUrl,
        '-Atqc',
        `SELECT count(*)
           FROM information_schema.columns
          WHERE table_schema = current_schema()
            AND table_name IN (
              'codex_slot_actor_identities',
              'codex_slot_leases',
              'codex_slot_sessions',
              'codex_slot_agents',
              'codex_slot_rollout',
              'codex_slot_audit_events'
            )
            AND column_name = 'tenant_id'`,
      ],
      { encoding: 'utf8' },
    );
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.trim()).toBe('6');
  });

  it('agent 使用 root 配置的 mmv stable node ID 和允许 IP 而非 hostname', () => {
    const agent = readRequired('scripts/codex-slot-agent.mjs');
    expect(agent).toContain('stable_node_id');
    expect(agent).toContain('allowed_ips');
    expect(agent).toContain('ExitNodeStatus');
    expect(agent).not.toMatch(/HostName\s*===\s*['"]mmv['"]|DNSName\s*===/);
  });

  it('reaper 两轮扫描对不可达状态保持隔离而不释放', () => {
    const reaper = readRequired('packages/brain/src/codex-slot-reaper.js');
    expect(reaper).toContain('quarantined');
    expect(reaper).toContain('unreachable');
    expect(reaper).toContain('last_confirmed_stopped_at');
    expect(reaper).not.toMatch(/unreachable[\s\S]{0,160}released/i);
  });

  it('smoke 在 xian-m1 与 xian-m4 仅使用专用假 auth 并验证清理', () => {
    const smoke = readRequired('packages/brain/scripts/smoke/codex-slot-lifecycle-smoke.sh');
    expect(smoke).toContain('xian-m1');
    expect(smoke).toContain('xian-m4');
    expect(smoke).toContain('fake-auth.json');
    expect(smoke).toContain('auth_absent');
    expect(smoke).toContain('tmux_absent');
    expect(smoke).toContain('temp_absent');
    expect(smoke).not.toMatch(/\.codex-team[1-5]\/auth\.json/);
  });
});
