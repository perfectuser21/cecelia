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
  './src/routes/acceptance.js', './src/routes/strategy-tree.js',
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
  it('保留任务恢复、意识loop、Notion同步与健康扫描和既有队列调度', () => {
    for (const name of ['initTickLoop', 'initConsciousnessGuard', 'runStartupRecovery', 'reAttachActiveExecutors', 'syncOrphanTasksOnStartup', 'cleanupStaleClaims', 'scheduleLegacyNotionPush', 'startProjectionJobsLoop', 'createAttemptCleanupLoop', 'startScanLoop', 'scanEvolutionIfNeeded', 'startNightlyOrchestratorScheduler']) {
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
