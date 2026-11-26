import { readFileSync } from 'node:fs';
import { parse } from 'acorn';
import { describe, expect, it } from 'vitest';

// 解析真实入口装配；不导入server，不启动HTTP/定时器/数据库。
function assembly(source) {
  const tree = parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
  const bindings = new Map(), modules = new Set(), calls = [], mounts = [];
  function visit(node, fn) {
    if (!node || typeof node !== 'object') return;
    if (node.type) fn(node);
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(child => visit(child, fn));
      else if (value && typeof value === 'object') visit(value, fn);
    }
  }
  visit(tree, node => {
    if (node.type === 'ImportDeclaration') {
      modules.add(node.source.value);
      for (const spec of node.specifiers) bindings.set(spec.local.name, node.source.value);
    }
    if (node.type === 'ImportExpression' && node.source.type === 'Literal') modules.add(node.source.value);
    if (node.type === 'VariableDeclarator') {
      const init = node.init?.type === 'AwaitExpression' ? node.init.argument : node.init;
      if (init?.type === 'ImportExpression' && init.source.type === 'Literal' && node.id.type === 'ObjectPattern') {
        for (const property of node.id.properties) if (property.value?.type === 'Identifier') bindings.set(property.value.name, init.source.value);
      }
    }
  });
  visit(tree, node => {
    if (node.type !== 'CallExpression') return;
    if (node.callee.type === 'Identifier') calls.push({ name: node.callee.name, module: bindings.get(node.callee.name) });
    if (node.callee.type === 'MemberExpression' && ['app', 'router'].includes(node.callee.object.name) && ['use', 'get', 'post', 'patch'].includes(node.callee.property.name)) {
      const [path, ...handlers] = node.arguments;
      const pathValue = path?.type === 'Literal' ? path.value : null;
      const middleware = pathValue === null ? node.arguments : handlers;
      mounts.push({ path: pathValue, handlers: middleware.map(h => bindings.get(h.name ?? h.callee?.name)).filter(Boolean) });
    }
  });
  return { modules, calls, mounts };
}
const dormantModules = [
  './src/emotion.js', './src/emotion-system.js', './src/dopamine.js',
  './src/task-generator-scheduler.js', './src/acceptance-public-server.js',
  './src/routes/acceptance.js', './src/routes/strategy-tree.js', './src/capability-scanner.js',
];
function violations(model) {
  return [
    ...dormantModules.filter(module => model.modules.has(module)).map(module => `loaded:${module}`),
    ...model.calls.filter(call => dormantModules.includes(call.module)).map(call => `called:${call.module}`),
    ...model.mounts.filter(mount => ['/api/brain/acceptance', '/api/brain/strategy-tree', '/api/brain/scan-status'].includes(mount.path)).map(mount => `mounted:${mount.path}`),
  ];
}
const source = readFileSync(new URL('../../server.js', import.meta.url), 'utf8');
const model = assembly(source);

describe('真实Brain启动装配的退役边界', () => {
  it('不加载或启动情绪/奖赏/旧扫描生产者与独立验收门户', () => {
    expect(violations(model)).toEqual([]);
  });
  it('保留任务、Notion工作面与公共执行目录的真实router绑定', () => {
    const expected = [
      ['/api/brain/tasks', './src/routes/task-tasks.js'],
      ['/api/brain', './src/routes/notes.js'],
      ['/api/brain/map', './src/routes/capability-system.js'],
      ['/api/brain/map', './src/routes/map.js'],
      ['/api/brain/map/manifests', './src/routes/map-manifests.js'],
      ['/api/brain/workflow-authoring', './src/routes/workflow-authoring.js'],
      ['/api/brain/invocations', './src/routes/invocations.js'],
      ['/api/brain/llm-service', './src/middleware/internal-auth.js'],
    ];
    for (const [path, module] of expected) expect(model.mounts.some(m => m.path === path && m.handlers.includes(module)), `${path} 必须绑定 ${module}`).toBe(true);
  });
  it('保留任务恢复、意识loop、Notion同步与必要健康诊断与既有队列调度', () => {
    for (const name of ['initTickLoop', 'initConsciousnessGuard', 'runStartupRecovery', 'reAttachActiveExecutors', 'syncOrphanTasksOnStartup', 'cleanupStaleClaims', 'scheduleLegacyNotionPush', 'startProjectionJobsLoop', 'createAttemptCleanupLoop', 'startProbeLoop', 'scanEvolutionIfNeeded']) {
      expect(model.calls.some(call => call.name === name && call.module), `${name} 必须调用实际导入绑定`).toBe(true);
    }
  });
  it('公共map写入与manifest激活仍绑定内部鉴权', () => {
    const map = assembly(readFileSync(new URL('../routes/map.js', import.meta.url), 'utf8'));
    const manifests = assembly(readFileSync(new URL('../routes/map-manifests.js', import.meta.url), 'utf8'));
    const authModule = '../middleware/internal-auth.js';
    for (const path of ['/implementation-impact', '/rebuild']) {
      expect(map.mounts.some(m => m.path === path && m.handlers.includes(authModule)), path).toBe(true);
    }
    expect(manifests.mounts.some(m => m.path === null && m.handlers.includes(authModule))).toBe(true);
  });
  it('识别别名动态启动与真实挂载，注释和文案不算执行入口', () => {
    expect(violations(assembly(`// import './src/dopamine.js';\nconst text="/api/brain/acceptance";`))).toEqual([]);
    const sample = assembly(`const {initDopamineListeners: start} = await import('./src/dopamine.js'); start(); app.use('/api/brain/acceptance', router);`);
    expect(violations(sample)).toContain('called:./src/dopamine.js');
    expect(violations(sample)).toContain('mounted:/api/brain/acceptance');
  });
});

it('执行真实非隔离启动函数时只接线现役调度，不启动旧夜间写标记器', async () => {
  const entry = parse(source, {ecmaVersion: 'latest', sourceType: 'module'}).body
    .find(node => node.type === 'FunctionDeclaration' && node.id.name === 'onBrainListening');
  // 只替换动态import的传输边界，真实启动控制流直接执行；时钟与全部外部模块为隔离依赖。
  let body = source.slice(entry.body.start + 1, entry.body.end - 1);
  const calls = [], timers = [], loads = [];
  let nightlyStarts = 0;
  const imports = [];
  function collect(node) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'ImportExpression') imports.push(node);
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(collect);
      else if (value && typeof value === 'object') collect(value);
    }
  }
  collect(entry.body);
  for (const node of imports.sort((a, b) => b.start - a.start)) {
    const start = node.start - entry.body.start - 1, end = node.end - entry.body.start - 1;
    body = body.slice(0, start) + `load(${source.slice(node.source.start, node.source.end)})` + body.slice(end);
  }
  const owned = name => (...args) => { calls.push(name); return undefined; };
  const modules = new Proxy({}, {get: (_target, name) => {
    if (name === 'then') return undefined;
    if (name === 'startNightlyOrchestratorScheduler') return () => {nightlyStarts++;};
    if (name === 'reAttachActiveExecutors') return async () => ({reattached: 0, touched: 0, errors: []});
    if (name === 'syncOrphanTasksOnStartup') return async () => ({});
    if (name === 'cleanupStaleClaims') return async () => ({cleaned: 0, errors: []});
    return owned(name);
  }});
  const environment = {
    PORT: 0, server: {}, pool: {}, process: {env: {}, execPath: '/isolated/node'}, __dirname: '/isolated',
    console: {log(){}, warn(){}, error(){}},
    isIsolatedRuntime: () => false, shouldStartAttemptCleanupLoop: () => false, isConsciousnessEnabled: () => false,
    initWebSocketServer: owned('websocket'), startFleetRefresh: owned('fleet'), initTickLoop: owned('tick'),
    setTimeout: (_fn, ms) => {timers.push(ms); return 1;}, setInterval: (_fn, ms) => {timers.push(ms); return 1;},
    join: (...parts) => parts.join('/'),
    spawn: owned('spawn'),
    load: async path => {loads.push(path); return modules;},
  };
  const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
  await new AsyncFunction(...Object.keys(environment), body)(...Object.values(environment));
  expect(nightlyStarts).toBe(0);
  expect(calls).toContain('tick');
  expect(calls).toContain('scheduleLegacyNotionPush');
  expect(calls).toContain('startProjectionJobsLoop');
  expect(loads).toContain('./src/executor.js');
  expect(timers.length).toBeGreaterThan(0);
});
