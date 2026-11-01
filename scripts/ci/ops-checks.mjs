import {readdirSync} from 'node:fs';
import {join, resolve} from 'node:path';

// 原 CI 的实际 fixture 测试类别；新增同类测试自动接入，不读取生产脚本或执行工作流材料。
const ROOT_NODE = [
  /^dispatch-worker.*\.test\.mjs$/,
  /^brain-image-retention.*\.test\.mjs$/,
  /^brain-image-deploy.*\.test\.mjs$/,
  /^brain-image-rollback.*\.test\.mjs$/,
  /^bluegreen-sidecar.*\.test\.mjs$/,
  /^preview-cache.*\.test\.mjs$/,
];
const ROOT_SHELL = [
  /^bluegreen-.*\.test\.sh$/,
  /^brain-deploy-.*\.test\.sh$/,
  /^preview-.*\.test\.sh$/,
  /^codex-remote-launch.*\.test\.sh$/,
  /^codex-request.*\.test\.sh$/,
];
// 仅纳入经核对的隔离 fixture 或只读部署守卫；不恢复整个历史 smoke glob。
const SAFE_SMOKES = [
  'bluegreen-bark-nojq', 'brain-compose-envfile-authority', 'brain-deploy-service-isolation',
  'dashboard-sha-reconcile', 'deploy-chain-wounds', 'deploy-local-npm-cache', 'gate3-brain-deploy',
  'runner-credential-single-chain',
].map(name => `scripts/smoke/${name}-smoke.sh`);
const STAGING_SMOKE = 'scripts/smoke/dashboard-staging-gate-smoke.sh';

function filesIn(root, directory, recursive = false) {
  let entries;
  try { entries = readdirSync(join(root, directory), {withFileTypes: true}); }
  catch { throw new Error(`Ops 回归目录不存在或不可读：${directory}`); }
  return entries.flatMap(entry => {
    const path = `${directory}/${entry.name}`;
    if (entry.isFile()) return [path];
    // 不跟随符号链接到测试树外；只有明确的测试目录允许递归。
    return recursive && entry.isDirectory() ? filesIn(root, path, true) : [];
  });
}

function select(files, expression, group) {
  const selected = files.filter(path => expression.test(path.slice(path.lastIndexOf('/') + 1)));
  if (!selected.length) throw new Error(`Ops 回归集合为空：${group}`);
  return selected;
}

export function opsChecks(root) {
  if (typeof root !== 'string' || !root) throw new Error('Ops 回归需要仓库根目录');
  const cwd = resolve(root);
  const scripts = filesIn(cwd, 'scripts');
  const shell = filesIn(cwd, 'scripts/__tests__');
  const preview = filesIn(cwd, 'scripts/preview-agent/__tests__');
  const ops = filesIn(cwd, 'scripts/ops/__tests__', true);
  const runner = filesIn(cwd, 'docker/cecelia-runner/__tests__');
  const smoke = filesIn(cwd, 'scripts/smoke');
  for (const file of [...SAFE_SMOKES, STAGING_SMOKE]) {
    if (!smoke.includes(file)) throw new Error(`Ops 隔离 smoke 缺失：${file}`);
  }
  const paths = [
    ...ROOT_NODE.flatMap(expression => select(scripts, expression, `scripts/${expression.source}`)),
    ...ROOT_SHELL.flatMap(expression => select(shell, expression, `scripts/__tests__/${expression.source}`)),
    ...select(preview, /\.test\.mjs$/, 'preview-agent Node'),
    ...select(ops, /\.test\.sh$/, 'Ops Shell（含子目录）'),
    ...select(runner, /\.test\.sh$/, 'Runner Shell'),
    ...select(runner, /\.test\.cjs$/, 'Runner CJS'),
    ...select(shell, /^dashboard-release-bind.*\.test\.mjs$/, 'Dashboard 发布/回档真实fixture'),
    ...SAFE_SMOKES, STAGING_SMOKE,
  ];
  return [...new Set(paths)].sort().map(path => path === STAGING_SMOKE ? {
    command: 'node', args: ['scripts/ci/run-isolated-staging-smoke.mjs', path], cwd,
  } : ({
    command: path.endsWith('.sh') ? 'bash' : 'node',
    args: path.endsWith('.mjs') ? ['--test', path] : [path],
    cwd,
  }));
}
