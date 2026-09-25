/**
 * [BEHAVIOR] task_runs 单一写口守卫（链 bf5088a3 棒1，任务 66db3dfb）。
 *
 * 铁律：全仓只有 lib/task-run.js 能写 task_runs（INSERT / UPDATE / DELETE）。
 * 任何执行路径绕过 startRun/finishRun 直插直改 = 「同一次执行不止一行 / 留痕口径分叉」，
 * 本测试机械扫 packages/brain/src 与 packages/brain/scripts，违规即红。
 *
 * proven-to-fire：扫描函数本身用内存里造出来的违规文本断言「会报红」，
 * 并断言真实仓库扫描确实扫到了写口文件（防扫描根目录写错导致永远绿）。
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BRAIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const WRITER = path.join('src', 'lib', 'task-run.js');

// 只关心 task_runs 表的写语句；task_runs_xxx 之类别名/别表不算（\b 边界 + 后随非标识符字符）。
const WRITE_PATTERNS = [
  /INSERT\s+INTO\s+task_runs(?![A-Za-z0-9_])/i,
  /UPDATE\s+task_runs(?![A-Za-z0-9_])/i,
  /DELETE\s+FROM\s+task_runs(?![A-Za-z0-9_])/i,
];

function findTaskRunsWrites(text) {
  return WRITE_PATTERNS.some((re) => re.test(text));
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '__tests__' || name === 'migrations') continue;
    const full = path.join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (/\.(js|mjs|cjs|sh|ts)$/.test(name) && !/\.test\.[jt]s$/.test(name)) out.push(full);
  }
  return out;
}

function scanRepo() {
  const files = [...walk(path.join(BRAIN_ROOT, 'src')), ...walk(path.join(BRAIN_ROOT, 'scripts'))];
  const violations = [];
  for (const f of files) {
    const rel = path.relative(BRAIN_ROOT, f);
    if (rel === WRITER) continue;
    if (findTaskRunsWrites(readFileSync(f, 'utf8'))) violations.push(rel);
  }
  return { files, violations };
}

describe('task_runs 单一写口守卫', () => {
  it('除 lib/task-run.js 外，src 与 scripts 里没有任何对 task_runs 的 INSERT/UPDATE/DELETE', () => {
    const { violations } = scanRepo();
    expect(violations).toEqual([]);
  });

  it('proven-to-fire：扫描器对各类违规写法都会报红', () => {
    expect(findTaskRunsWrites('await pool.query(`INSERT INTO task_runs (task_id) VALUES ($1)`)')).toBe(true);
    expect(findTaskRunsWrites('UPDATE   task_runs SET status = $1')).toBe(true);
    expect(findTaskRunsWrites('delete from task_runs where id = $1')).toBe(true);
    expect(findTaskRunsWrites("INSERT INTO\n   task_runs\n(a)")).toBe(true);
  });

  it('proven-to-fire：读 task_runs 与写别的表不算违规（无误报）', () => {
    expect(findTaskRunsWrites('SELECT task_id FROM task_runs WHERE status = $1')).toBe(false);
    expect(findTaskRunsWrites('INSERT INTO task_runs_archive (a) VALUES (1)')).toBe(false);
    expect(findTaskRunsWrites('UPDATE tasks SET status = $1')).toBe(false);
  });

  it('扫描确实覆盖到写口文件与执行路径文件（防扫描根目录写错永远绿）', () => {
    const { files } = scanRepo();
    const rels = files.map((f) => path.relative(BRAIN_ROOT, f));
    expect(rels).toContain(WRITER);
    expect(rels).toContain(path.join('src', 'executor.js'));
    expect(rels).toContain(path.join('src', 'dispatcher.js'));
    expect(rels).toContain(path.join('scripts', 'cecelia-run.sh'));
  });
});
