// _lib.mjs — 手动验证脚本共享工具（真实 PG + 真实文件系统，禁 mock）
import { execFileSync, execSync } from 'child_process';
import { randomUUID } from 'crypto';

export const GIB = 1073741824;
export const REPO_ROOT = process.env.REPO_ROOT || execSync('git rev-parse --show-toplevel').toString().trim();

export function runCommand(command, args = [], options = {}) {
  const env = { ...process.env };
  // CI 统一注入 DB_PASSWORD；PostgreSQL CLI 只读取 PGPASSWORD，否则会卡在交互式密码提示。
  if (!env.PGPASSWORD && env.DB_PASSWORD) env.PGPASSWORD = env.DB_PASSWORD;
  return execFileSync(command, args, { ...options, env });
}

/** 动态手测无需保留命令输出；直接丢弃可避免 execSync 默认 maxBuffer 导致 ENOBUFS。 */
export function runQuietCommand(command, args = []) {
  runCommand(command, args, { stdio: 'ignore' });
}

/** 真实 pool（NODE_ENV=test 强制走 cecelia_test，db-config.js 的 guard 保证不会碰生产库） */
export async function realPool() {
  process.env.NODE_ENV = process.env.NODE_ENV || 'test';
  const mod = await import(`${REPO_ROOT}/packages/brain/src/db.js`);
  return mod.default;
}

export function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

export function ok(label) {
  console.log(`OK:${label}`);
}

/** 测试用唯一 PR 号，避开真实 preview_environments 数据 */
export function testPrNumber() {
  return 900000 + Math.floor(Math.random() * 90000);
}

export function uniqSuffix() {
  return randomUUID().slice(0, 8);
}

export async function cleanupPrRow(pool, prNumber) {
  await pool.query('DELETE FROM preview_environments WHERE pr_number = $1', [prNumber]);
}
