import {execFileSync} from 'node:child_process';
import {appendFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const ORDER = ['brain-unit', 'brain-integration', 'image', 'engine', 'quality', 'mcp', 'api', 'dashboard', 'frontend', 'android', 'ops', 'scripts'];
// ci/routing-map.yml 将 frontend 标为 Legacy/deploy:false；现役发布入口为 apps/dashboard。
// 保留旧目录自身变更的验证，但现役全量不隐含重新发布旧应用。
// Android 客户端自身修改必须运行 Gradle；服务端全量不重复构建未变更的移动客户端。
const ACTIVE = ORDER.filter(component => !['frontend', 'android'].includes(component));
const SHARED_RUNTIME = ['brain-unit', 'brain-integration', 'image', 'engine', 'api', 'ops'];
const DOCUMENT = /\.(?:md|mdx|txt|rst|png|jpe?g|gif|svg|webp|pdf)$/i;
const CONFIG = /(?:^|\/)(?:(?:vitest|vite|eslint)(?:\.[^/]+)*\.config(?:\.[^/]+)?|tsconfig(?:\.[^/]+)?\.json|\.eslintrc(?:\.[^/]+)?)$/;

function assertPaths(paths, full) {
  if (!Array.isArray(paths) || (!full && paths.length === 0)) {
    throw new Error('CI scope requires nonempty paths，路径列表不能为空');
  }
  for (const path of paths) {
    if (typeof path !== 'string' || !path || path.includes('\0') || path.startsWith('/') ||
      path.split('/').some(part => !part || part === '.' || part === '..')) {
      throw new Error(`Invalid repository path: ${JSON.stringify(path)}`);
    }
  }
}

function matrixFor(selected) {
  return ORDER.filter(component => selected.has(component)).flatMap(component =>
    component === 'brain-unit'
      ? Array.from({length: 6}, (_, index) => ({component, shard: index + 1}))
      : [{component}]);
}

/** Select whole component suites; dynamic file reads make import-only selection unsafe. */
export function planChecks(paths, {full = false} = {}) {
  assertPaths(paths, full);
  const selected = new Set(['scripts']);
  let all = full;
  for (const path of paths) {
    if (/\.(md|mdx)$/i.test(path) || (path.startsWith('docs/') && DOCUMENT.test(path))) continue;
    if (path.startsWith('frontend/')) selected.add('frontend');
    if (path.startsWith('apps/android-agent/')) selected.add('android');
    if (CONFIG.test(path) || /^(?:\.github|scripts|config)\//.test(path) ||
      /^(?:package(?:-lock)?\.json|npm-shrinkwrap\.json|\.npmrc|\.skills-source\.json)$/.test(path)) {
      all = true;
    } else if (path.startsWith('apps/android-agent/')) selected.add('android');
    else if (/^(?:packages\/(?:brain|engine)|apps\/api)\//.test(path)) {
      for (const component of SHARED_RUNTIME) selected.add(component);
    } else if (path.startsWith('packages/quality/')) selected.add('quality');
    else if (path.startsWith('packages/mcp-readonly/')) selected.add('mcp');
    else if (path.startsWith('apps/dashboard/')) selected.add('dashboard');
    else if (path.startsWith('frontend/')) selected.add('frontend');
    else all = true;
  }
  return matrixFor(all ? new Set([...ACTIVE, ...selected]) : selected);
}

function revision(value) {
  if (typeof value !== 'string' || !value || value.startsWith('-')) throw new Error('Invalid Git revision');
  return execFileSync('git', ['rev-parse', '--verify', '--end-of-options', `${value}^{commit}`],
    {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim();
}

export function main(argv = process.argv.slice(2)) {
  let base, head, full = false;
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--full') full = true;
    else if (arg === '--base' || arg === '--head') {
      const value = argv[++index];
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${arg}`);
      if (arg === '--base') {
        if (base !== undefined) throw new Error('Duplicate --base');
        base = value;
      } else {
        if (head !== undefined) throw new Error('Duplicate --head');
        head = value;
      }
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!full && (!base || !head)) throw new Error('--base and --head are required without --full');
  const resolvedHead = revision(head ?? 'HEAD');
  const resolvedBase = base === undefined ? undefined : revision(base);
  const raw = full && resolvedBase === undefined ? '' : execFileSync('git', [
    'diff', '--no-ext-diff', '--no-textconv', '--name-only', '--no-renames', '-z', resolvedBase, resolvedHead, '--',
  ], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 16 * 1024 * 1024});
  const paths = raw ? raw.slice(0, -1).split('\0') : [];
  const matrix = {include: planChecks(paths, {full})};
  const encoded = JSON.stringify(matrix);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `matrix=${encoded}\n`);
  process.stdout.write(`${encoded}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); }
  catch (error) {
    process.stderr.write(`CI scope failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}
