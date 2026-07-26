// preview-destroyer.test.js [BEHAVIOR] — 模块3 统一销毁器
// TDD Red 证据（vitest）。禁 mock 被测边：真连 cecelia_test Postgres，真 git worktree，真 createdb/dropdb。
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { execFileSync, execSync, spawn } from 'child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync, symlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { fileURLToPath } from 'url';

process.env.NODE_ENV = process.env.NODE_ENV || 'test';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const REPO_ROOT = execSync('git rev-parse --show-toplevel', { cwd: __dirname }).toString().trim();
const PG_ARGS = [
  '-h', process.env.DB_HOST || 'localhost',
  '-p', process.env.DB_PORT || '5432',
  '-U', process.env.DB_USER || 'cecelia',
];
const MAINTENANCE_DB = process.env.DB_NAME || 'cecelia_test';
const PG_ENV = {
  ...process.env,
  PGPASSWORD: process.env.DB_PASSWORD || process.env.PGPASSWORD || 'cecelia',
};

let pool;
let destroyPreview;
const seededPrs = [];
const seededDbs = [];
let previewBaseDir;

function testPr() {
  return 920000 + Math.floor(Math.random() * 9000);
}

function dbExists(name) {
  const out = execFileSync(
    'psql',
    [...PG_ARGS, '-d', MAINTENANCE_DB, '-t', '-A', '-c', `SELECT 1 FROM pg_database WHERE datname='${name}'`],
    { env: PG_ENV },
  ).toString().trim();
  return out === '1';
}

async function insertRow(pr, dbName, workDir, status = 'active') {
  await pool.query(
    `INSERT INTO preview_environments (pr_number, branch_name, base_repo, port, db_name, status)
     VALUES ($1, 'cp-fixture', 'cecelia', $2, $3, $4)`,
    [pr, 5300 + (pr % 90), dbName, status],
  );
}

beforeAll(async () => {
  pool = (await import('../../db.js')).default;
  ({ destroyPreview } = await import('../../preview-destroyer.js'));
});

afterEach(async () => {
  while (seededPrs.length) {
    const pr = seededPrs.pop();
    await pool.query('DELETE FROM preview_environments WHERE pr_number = $1', [pr]).catch(() => {});
  }
  while (seededDbs.length) {
    const db = seededDbs.pop();
    try {
      execFileSync(
        'dropdb',
        [...PG_ARGS, `--maintenance-db=${MAINTENANCE_DB}`, '--if-exists', db],
        { env: PG_ENV, stdio: 'pipe' },
      );
    } catch { /* best-effort */ }
  }
  try { execSync(`git -C "${REPO_ROOT}" worktree prune`, { stdio: 'pipe' }); } catch { /* best-effort */ }
  if (previewBaseDir) { rmSync(previewBaseDir, { recursive: true, force: true }); previewBaseDir = null; }
});

describe('destroyPreview [BEHAVIOR] — 7 步流程 / 安全防护 / 幂等 / 并发去重', () => {
  it('同 PR 有 inactive 历史行时只销毁最新 live 行，不把历史行改回非终态', async () => {
    previewBaseDir = mkdtempSync(join(tmpdir(), 'destroyer-history-'));
    const pr = testPr();
    seededPrs.push(pr);
    await insertRow(pr, `cecelia_preview_${pr}_old`, join(previewBaseDir, `preview-${pr}`), 'inactive');
    await insertRow(pr, `cecelia_preview_${pr}`, join(previewBaseDir, `preview-${pr}`), 'active');

    const result = await destroyPreview(
      pr,
      'test-history',
      'exec-history',
      pool,
      { previewBaseDir, repoRoot: REPO_ROOT },
    );

    expect(result).toEqual(expect.objectContaining({ destroyed: true, status: 'inactive' }));
    const { rows } = await pool.query(
      'SELECT status FROM preview_environments WHERE pr_number = $1 ORDER BY created_at',
      [pr],
    );
    expect(rows.map(({ status }) => status)).toEqual(['inactive', 'inactive']);
  });

  it('7 步流程完整执行：DB 已删 + worktree 已删 + 进程已杀 + 临时文件已清 + 终态 inactive', async () => {
    previewBaseDir = mkdtempSync(join(tmpdir(), 'destroyer-red-'));
    const pr = testPr();
    seededPrs.push(pr);
    const dbName = `cecelia_preview_${pr}`;
    seededDbs.push(dbName);
    execFileSync(
      'createdb',
      [...PG_ARGS, `--maintenance-db=${MAINTENANCE_DB}`, dbName],
      { env: PG_ENV, stdio: 'pipe' },
    );
    const workDir = join(previewBaseDir, `preview-${pr}`);
    execSync(`git -C "${REPO_ROOT}" worktree add "${workDir}" HEAD --detach`, { stdio: 'pipe' });
    const child = spawn('sleep', ['600'], { detached: true, stdio: 'ignore' });
    child.unref();
    writeFileSync(`/tmp/preview-${pr}.pid`, String(child.pid));
    await insertRow(pr, dbName, workDir, 'active');

    const r = await destroyPreview(pr, 'test-red', 'exec-red-full', pool, { previewBaseDir, repoRoot: REPO_ROOT });

    expect(r.destroyed).toBe(true);
    expect(r.status).toBe('inactive');
    expect(dbExists(dbName)).toBe(false);
    expect(existsSync(workDir)).toBe(false);
    expect(existsSync(`/tmp/preview-${pr}.pid`)).toBe(false);
    const { rows } = await pool.query('SELECT status FROM preview_environments WHERE pr_number=$1', [pr]);
    expect(rows[0]?.status).toBe('inactive');
  });

  it('DB 名不匹配 ^cecelia_preview_[0-9]+$ → 拒绝 DROP DATABASE，置 cleanup_failed，不误删邻近库', async () => {
    previewBaseDir = mkdtempSync(join(tmpdir(), 'destroyer-red-'));
    const pr = testPr();
    seededPrs.push(pr);
    const decoyPr = testPr();
    seededPrs.push(decoyPr);
    const decoyDb = `cecelia_preview_${decoyPr}`;
    seededDbs.push(decoyDb);
    execFileSync(
      'createdb',
      [...PG_ARGS, `--maintenance-db=${MAINTENANCE_DB}`, decoyDb],
      { env: PG_ENV, stdio: 'pipe' },
    );
    const maliciousDbName = `cecelia_preview_${pr}; DROP DATABASE ${decoyDb}`;
    await insertRow(pr, maliciousDbName, join(previewBaseDir, `preview-${pr}`), 'active');

    const r = await destroyPreview(pr, 'test-red', 'exec-red-dbguard', pool, { previewBaseDir, repoRoot: REPO_ROOT });

    expect(r.destroyed).toBe(false);
    expect(r.status).toBe('cleanup_failed');
    expect(r.cleanup_detail?.residual?.length).toBeGreaterThan(0);
    expect(dbExists(decoyDb)).toBe(true);
  });

  it('worktree 路径通过符号链接逃逸 preview 根目录 → realpath 校验 abort，不执行 rm -rf', async () => {
    previewBaseDir = mkdtempSync(join(tmpdir(), 'destroyer-red-'));
    const pr = testPr();
    seededPrs.push(pr);
    const dbName = `cecelia_preview_${pr}`;
    seededDbs.push(dbName);
    execFileSync(
      'createdb',
      [...PG_ARGS, `--maintenance-db=${MAINTENANCE_DB}`, dbName],
      { env: PG_ENV, stdio: 'pipe' },
    );

    const escapeTarget = mkdtempSync(join(tmpdir(), 'escape-target-'));
    const sentinel = join(escapeTarget, 'sentinel.txt');
    writeFileSync(sentinel, 'must-survive');
    const workDir = join(previewBaseDir, `preview-${pr}`);
    symlinkSync(escapeTarget, workDir);
    await insertRow(pr, dbName, workDir, 'active');

    const r = await destroyPreview(pr, 'test-red', 'exec-red-realpath', pool, { previewBaseDir, repoRoot: REPO_ROOT });

    expect(r.destroyed).toBe(false);
    expect(r.status).toBe('cleanup_failed');
    expect(existsSync(sentinel)).toBe(true);
    rmSync(escapeTarget, { recursive: true, force: true });
  });

  it('对已 inactive 的 PR 重复调用 → 幂等成功', async () => {
    previewBaseDir = mkdtempSync(join(tmpdir(), 'destroyer-red-'));
    const pr = testPr();
    seededPrs.push(pr);
    await insertRow(pr, `cecelia_preview_${pr}`, join(previewBaseDir, `preview-${pr}`), 'inactive');

    const r1 = await destroyPreview(pr, 'test-red', 'exec-red-idem-1', pool, { previewBaseDir, repoRoot: REPO_ROOT });
    const r2 = await destroyPreview(pr, 'test-red', 'exec-red-idem-2', pool, { previewBaseDir, repoRoot: REPO_ROOT });

    expect(r1.destroyed).toBe(true);
    expect(r2.destroyed).toBe(true);
  });

  it('同一 PR webhook + reaper 并发触发销毁 → per-PR advisory lock 保证只实际执行一次', async () => {
    previewBaseDir = mkdtempSync(join(tmpdir(), 'destroyer-red-'));
    const pr = testPr();
    seededPrs.push(pr);
    const dbName = `cecelia_preview_${pr}`;
    seededDbs.push(dbName);
    execFileSync(
      'createdb',
      [...PG_ARGS, `--maintenance-db=${MAINTENANCE_DB}`, dbName],
      { env: PG_ENV, stdio: 'pipe' },
    );
    const workDir = join(previewBaseDir, `preview-${pr}`);
    execSync(`git -C "${REPO_ROOT}" worktree add "${workDir}" HEAD --detach`, { stdio: 'pipe' });
    await insertRow(pr, dbName, workDir, 'active');

    const [r1, r2] = await Promise.all([
      destroyPreview(pr, 'webhook', 'exec-red-race-1', pool, { previewBaseDir, repoRoot: REPO_ROOT }),
      destroyPreview(pr, 'reaper', 'exec-red-race-2', pool, { previewBaseDir, repoRoot: REPO_ROOT }),
    ]);

    expect(r1.status).toBe('inactive');
    expect(r2.status).toBe('inactive');
    expect(dbExists(dbName)).toBe(false);
  });
});
