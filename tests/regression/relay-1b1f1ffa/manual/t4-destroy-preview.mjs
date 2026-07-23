// t4-destroy-preview.mjs — 模块3 destroyPreview() 7 步流程 + 幂等 + DB名正则 + realpath 逃逸防护 + 并发去重
// 用法: node t4-destroy-preview.mjs full-flow|dbname-guard|realpath-guard|idempotent|concurrent-dedup
import { execSync } from 'child_process';
import { existsSync, mkdtempSync, rmSync, mkdirSync, writeFileSync, symlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { spawn } from 'child_process';
import { REPO_ROOT, realPool, fail, ok, testPrNumber, cleanupPrRow, runQuietCommand } from './_lib.mjs';

const mode = process.argv[2];
const PSQL_ARGS = ['-h', 'localhost', '-U', 'cecelia'];
const previewBaseDir = mkdtempSync(join(tmpdir(), 'preview-base-'));
const seededPrs = [];
let seededDbs = [];

function shDb(cmd, ...args) {
  runQuietCommand(cmd, [...PSQL_ARGS, ...args]);
}

async function dbExists(dbName) {
  const out = execSync(
    `psql ${PSQL_ARGS.join(' ')} -t -A -c "SELECT 1 FROM pg_database WHERE datname='${dbName}'"`,
  ).toString().trim();
  return out === '1';
}

async function insertRow(pool, pr, dbName, workDir, status = 'active') {
  await pool.query(
    `INSERT INTO preview_environments (pr_number, branch_name, base_repo, port, db_name, status)
     VALUES ($1, 'cp-fixture', 'cecelia', $2, $3, $4)`,
    [pr, 5300 + (pr % 90), dbName, status],
  );
}

function spawnFixtureProcess(pr) {
  const child = spawn('sleep', ['600'], { detached: true, stdio: 'ignore' });
  child.unref();
  writeFileSync(`/tmp/preview-${pr}.pid`, String(child.pid));
  writeFileSync(`/tmp/preview-${pr}.branch`, 'cp-fixture');
  writeFileSync(`/tmp/preview-${pr}.log`, 'fixture log\n');
  return child.pid;
}

try {
  const { destroyPreview } = await import(`${REPO_ROOT}/packages/brain/src/preview-destroyer.js`);
  const pool = await realPool();

  if (mode === 'full-flow') {
    const pr = testPrNumber();
    seededPrs.push(pr);
    const dbName = `cecelia_preview_${pr}`;
    seededDbs.push(dbName);
    shDb('createdb', dbName);
    const workDir = join(previewBaseDir, `preview-${pr}`);
    execSync(`git -C "${REPO_ROOT}" worktree add "${workDir}" HEAD --detach`, { stdio: 'pipe' });
    const pid = spawnFixtureProcess(pr);
    await insertRow(pool, pr, dbName, workDir, 'active');

    const r = await destroyPreview(pr, 'test-full-flow', 'exec-t4-full', pool, { previewBaseDir, repoRoot: REPO_ROOT });

    if (r.destroyed !== true || r.status !== 'inactive') fail(`full-flow 应 destroyed:true status:inactive，实际 ${JSON.stringify(r)}`);
    if (await dbExists(dbName)) fail(`full-flow 后数据库 ${dbName} 仍存在（DROP DATABASE 未执行）`);
    if (existsSync(workDir)) fail(`full-flow 后 worktree 目录 ${workDir} 仍存在`);
    if (existsSync(`/tmp/preview-${pr}.pid`)) fail(`full-flow 后 pid 文件仍存在`);
    let processAlive = true;
    try { process.kill(pid, 0); } catch { processAlive = false; }
    if (processAlive) fail(`full-flow 后 fixture 进程 pid=${pid} 仍存活`);
    const { rows } = await pool.query('SELECT status FROM preview_environments WHERE pr_number=$1', [pr]);
    if (rows[0]?.status !== 'inactive') fail(`DB 行终态应为 inactive，实际 ${rows[0]?.status}`);
    seededDbs = seededDbs.filter((d) => d !== dbName); // 已被函数自己删除，不用再 cleanup
    ok('destroy-full-flow');

  } else if (mode === 'dbname-guard') {
    // 目标行 db_name 被污染为不匹配 ^cecelia_preview_[0-9]+$ 的值，函数必须拒绝 DROP DATABASE
    const pr = testPrNumber();
    seededPrs.push(pr);
    const decoyPr = testPrNumber();
    seededPrs.push(decoyPr);
    const decoyDb = `cecelia_preview_${decoyPr}`;
    seededDbs.push(decoyDb);
    shDb('createdb', decoyDb); // 邻近的合法数据库，验证未被误删

    const maliciousDbName = `cecelia_preview_${pr}; DROP DATABASE ${decoyDb}`; // 含非法字符，不匹配正则
    await insertRow(pool, pr, maliciousDbName, join(previewBaseDir, `preview-${pr}`), 'active');

    const r = await destroyPreview(pr, 'test-dbname-guard', 'exec-t4-dbguard', pool, { previewBaseDir, repoRoot: REPO_ROOT });

    if (r.destroyed !== false || r.status !== 'cleanup_failed') fail(`非法 db_name 应导致 cleanup_failed，实际 ${JSON.stringify(r)}`);
    if (!r.cleanup_detail || !Array.isArray(r.cleanup_detail.residual) || r.cleanup_detail.residual.length === 0) {
      fail(`cleanup_detail.residual 应记录非法 db_name 残留项，实际 ${JSON.stringify(r.cleanup_detail)}`);
    }
    if (!(await dbExists(decoyDb))) fail(`邻近合法数据库 ${decoyDb} 被误删——DB 名正则校验未生效，存在注入风险`);
    ok('destroy-dbname-guard');

  } else if (mode === 'realpath-guard') {
    // worktree 路径通过符号链接逃逸到 PREVIEW_BASE_DIR 之外，fallback rm -rf 前必须 realpath 校验并 abort
    const pr = testPrNumber();
    seededPrs.push(pr);
    const dbName = `cecelia_preview_${pr}`;
    seededDbs.push(dbName);
    shDb('createdb', dbName);

    const escapeTarget = mkdtempSync(join(tmpdir(), 'escape-target-'));
    const sentinelFile = join(escapeTarget, 'sentinel.txt');
    writeFileSync(sentinelFile, 'must-survive');

    const workDir = join(previewBaseDir, `preview-${pr}`);
    symlinkSync(escapeTarget, workDir); // 不是真实 git worktree，git worktree remove 会失败 → 触发 rm -rf fallback

    await insertRow(pool, pr, dbName, workDir, 'active');

    const r = await destroyPreview(pr, 'test-realpath-guard', 'exec-t4-realpath', pool, { previewBaseDir, repoRoot: REPO_ROOT });

    if (r.destroyed !== false || r.status !== 'cleanup_failed') fail(`路径逃逸场景应导致 cleanup_failed，实际 ${JSON.stringify(r)}`);
    if (!existsSync(sentinelFile)) fail(`realpath 逃逸防护失效：escapeTarget 外部目录被删除，sentinel 文件丢失`);
    ok('destroy-realpath-guard');

  } else if (mode === 'idempotent') {
    const pr = testPrNumber();
    seededPrs.push(pr);
    await insertRow(pool, pr, `cecelia_preview_${pr}`, join(previewBaseDir, `preview-${pr}`), 'inactive');

    const r1 = await destroyPreview(pr, 'test-idempotent', 'exec-t4-idem-1', pool, { previewBaseDir, repoRoot: REPO_ROOT });
    const r2 = await destroyPreview(pr, 'test-idempotent', 'exec-t4-idem-2', pool, { previewBaseDir, repoRoot: REPO_ROOT });

    if (r1.destroyed !== true || r2.destroyed !== true) fail(`对已 inactive 的 PR 重复调用应均返回 destroyed:true，实际 r1=${JSON.stringify(r1)} r2=${JSON.stringify(r2)}`);
    ok('destroy-idempotent');

  } else if (mode === 'concurrent-dedup') {
    // 模拟 webhook + reaper 同时触发同一 PR 的销毁 —— per-PR advisory lock 应保证只真正执行一次
    const pr = testPrNumber();
    seededPrs.push(pr);
    const dbName = `cecelia_preview_${pr}`;
    seededDbs.push(dbName);
    shDb('createdb', dbName);
    const workDir = join(previewBaseDir, `preview-${pr}`);
    execSync(`git -C "${REPO_ROOT}" worktree add "${workDir}" HEAD --detach`, { stdio: 'pipe' });
    spawnFixtureProcess(pr);
    await insertRow(pool, pr, dbName, workDir, 'active');

    const [r1, r2] = await Promise.all([
      destroyPreview(pr, 'test-concurrent', 'exec-t4-race-1', pool, { previewBaseDir, repoRoot: REPO_ROOT }),
      destroyPreview(pr, 'test-concurrent', 'exec-t4-race-2', pool, { previewBaseDir, repoRoot: REPO_ROOT }),
    ]);

    if (r1.status !== 'inactive' || r2.status !== 'inactive') {
      fail(`并发销毁两次调用最终都应观测到 inactive 终态，实际 r1=${JSON.stringify(r1)} r2=${JSON.stringify(r2)}`);
    }
    if (await dbExists(dbName)) fail(`并发销毁后数据库 ${dbName} 仍存在`);
    if (existsSync(workDir)) fail(`并发销毁后 worktree 目录仍存在`);
    seededDbs = seededDbs.filter((d) => d !== dbName);
    ok('destroy-concurrent-dedup');

  } else {
    fail(`未知 mode: ${mode}`);
  }
} catch (err) {
  fail(`执行异常: ${err.message}\n${err.stack || ''}`);
} finally {
  try {
    const pool = await realPool();
    for (const pr of seededPrs) await cleanupPrRow(pool, pr);
  } catch { /* best-effort */ }
  for (const dbName of seededDbs) {
    try { shDb('dropdb', '--if-exists', dbName); } catch { /* best-effort */ }
  }
  try {
    execSync(`git -C "${REPO_ROOT}" worktree prune`, { stdio: 'pipe' });
  } catch { /* best-effort */ }
  rmSync(previewBaseDir, { recursive: true, force: true });
}
// 同 t3-admit-preview.mjs：realPool() 是共享 pool（idleTimeoutMillis=30000），
// 不主动退出会空等 30s 才让事件循环清空。成功路径主动 exit(0)。
process.exit(0);
