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
  /^dashboard-release.*\.test\.sh$/,
];
// 仅纳入经核对的隔离 fixture 或只读部署守卫；不恢复整个历史 smoke glob。
const SAFE_SMOKES = [
  'brain-compose-envfile-authority', 'brain-deploy-service-isolation',
  'dashboard-sha-reconcile', 'deploy-chain-wounds', 'deploy-local-npm-cache', 'gate3-brain-deploy',
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

// 每个已发现入口必须有执行域；新类别未知时全量回退，不能随PR裁剪一起消失。
export function domainForTest(path) {
  if (path.startsWith('docker/cecelia-runner/') || path.endsWith('/runner-credential-single-chain-smoke.sh')) return 'runner';
  if (/\/(?:dispatch-worker|codex-request|codex-remote-launch)/.test(path)) return 'launcher';
  if (/\/preview-|\/preview-agent\//.test(path)) return 'preview';
  if (/\/dashboard-|\/deploy-chain-wounds-/.test(path)) return 'dashboard';
  if (/\/brain-image-|\/bluegreen-|\/brain-deploy-|\/brain-compose-|\/gate3-brain-|\/deploy-local-npm-cache-/.test(path)) return 'brain';
  if (/^scripts\/ops\/__tests__\/(?:credentials\/|janitor\/|opc[_-]|openclaw_)/.test(path)) return 'ops';
  return null;
}

export function domainsForChanges(paths) {
  if (paths === null) return null;
  if (!Array.isArray(paths) || !paths.length || paths.some(path => typeof path !== 'string' ||
      !path || path.includes('\0') || path.startsWith('/') || path.split('/').some(part => !part || part === '.' || part === '..'))) {
    throw new Error('Ops PR paths 路径列表无效');
  }
  const domains = new Set(['brain']);
  for (const path of paths) {
    // 构建配置、CI调度及未分类来源都必须保守全量；不能猜测公共文件的影响面。
    if (/^(?:\.github\/|scripts\/ci\/|config\/|package(?:-lock)?\.json$|\.npmrc$)/.test(path) ||
        /^packages\/brain\/(?:config\/|package(?:-lock)?\.json$)/.test(path)) return null;
    const ownTest = /\.test\.(?:mjs|cjs|sh)$|^scripts\/smoke\//.test(path) ? domainForTest(path) : null;
    if (ownTest) { domains.add(ownTest); continue; }
    if (/^scripts\/(?:dispatch-worker|codex-request|codex-remote-launch)/.test(path)) domains.add('launcher');
    else if (/^(?:scripts\/ops\/|tests\/ops\/)/.test(path) ||
        /^packages\/brain\/src\/(?:lib\/(?:infra-|existing-ops-)|.*company-kr)/.test(path)) domains.add('ops');
    else if (/^(?:scripts\/(?:preview-|request-preview-|wait-preview-|verify-preview-|lib\/preview-)|packages\/brain\/src\/(?:preview-|routes\/preview\.js|capacity-gate\.js))/.test(path)) domains.add('preview');
    else if (/^(?:apps\/dashboard\/|frontend-proxy\.js$|scripts\/(?:promote-dashboard|rollback-cecelia|dashboard-|dev-preview|lib\/(?:dashboard-|release-)))/.test(path)) domains.add('dashboard');
    else if (/^(?:docker\/cecelia-runner\/|docker\/build\.sh$|packages\/brain\/(?:scripts\/fleet-worker\/|src\/(?:orchestrator\/|app-server\/|executor|spawn\/)))/.test(path)) domains.add('runner');
    else if (/^scripts\/deploy-local\.sh$|^docker-compose.*\.ya?ml$/.test(path)) {
      for (const domain of ['runner', 'dashboard', 'preview']) domains.add(domain);
    } else if (/^scripts\/(?:brain-(?:deploy|build|rollback)|lib\/(?:brain-|bluegreen|internal-auth))/.test(path)) domains.add('runner');
    // 注册/回调、入口及脚本会跨执行面。尚未逐项证明的公共接口按全量处理。
    else if (/^packages\/brain\/(?:server\.js|scripts\/|src\/(?:routes\.js|cecelia-routes\.js|routes\/|.*(?:executor|worker|credentials|fleet)))/.test(path)) return null;
    else if (/^packages\/brain\/src\//.test(path)) continue;
    else return null;
  }
  return domains;
}

export function opsChecks(root, {paths: changedPaths = null} = {}) {
  if (typeof root !== 'string' || !root) throw new Error('Ops 回归需要仓库根目录');
  const cwd = resolve(root);
  const scripts = filesIn(cwd, 'scripts');
  const shell = filesIn(cwd, 'scripts/__tests__');
  const preview = filesIn(cwd, 'scripts/preview-agent/__tests__');
  const ops = filesIn(cwd, 'scripts/ops/__tests__', true);
  const smoke = filesIn(cwd, 'scripts/smoke');
  for (const file of [...SAFE_SMOKES, STAGING_SMOKE]) {
    if (!smoke.includes(file)) throw new Error(`Ops 隔离 smoke 缺失：${file}`);
  }
  const paths = [
    ...ROOT_NODE.flatMap(expression => select(scripts, expression, `scripts/${expression.source}`)),
    ...ROOT_SHELL.flatMap(expression => select(shell, expression, `scripts/__tests__/${expression.source}`)),
    ...select(preview, /\.test\.mjs$/, 'preview-agent Node'),
    ...select(ops, /\.test\.sh$/, 'Ops Shell（含子目录）'),
    ...select(shell, /^dashboard-release-bind.*\.test\.mjs$/, 'Dashboard 发布/回档真实fixture'),
    ...SAFE_SMOKES, STAGING_SMOKE,
  ];
  const allPaths = [...new Set(paths)].sort();
  const domains = domainsForChanges(changedPaths);
  const selected = domains && allPaths.every(path => domainForTest(path))
    ? allPaths.filter(path => domains.has(domainForTest(path))) : allPaths;
  return selected.map(path => path === STAGING_SMOKE ? {
    command: 'node', args: ['scripts/ci/run-isolated-staging-smoke.mjs', path], cwd,
  } : ({
    command: path.endsWith('.sh') ? 'bash' : 'node',
    args: path.endsWith('.mjs') ? ['--test', path] : [path],
    cwd,
  }));
}

// 旧镜像/attempt 兼容实现专用；现役默认与未知输入回退均不得调用本入口。
export function legacyRunnerChecks(root) {
  if (typeof root !== 'string' || !root) throw new Error('Runner 兼容回归需要仓库根目录');
  const cwd = resolve(root);
  const runner = filesIn(cwd, 'docker/cecelia-runner/__tests__');
  const smoke = 'scripts/smoke/runner-credential-single-chain-smoke.sh';
  if (!filesIn(cwd, 'scripts/smoke').includes(smoke)) throw new Error('Runner 兼容 smoke 缺失');
  return [
    ...select(runner, /\.test\.sh$/, '旧Runner Shell'),
    ...select(runner, /\.test\.cjs$/, '旧Runner CJS'), smoke,
  ].sort().map(path => ({command: path.endsWith('.sh') ? 'bash' : 'node', args: [path], cwd}));
}
