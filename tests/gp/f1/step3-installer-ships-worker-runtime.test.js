/**
 * GP F1 step3 —— installer 复制清单覆盖本地 require；公共 Workflow 的两项固定 checkout 依赖单独验收。
 *
 * 回归背景（2026-09-13，PR #5300 部署缺件）：fleet-worker.cjs 新增
 * require('./orchestrator-runner.cjs')，但 install-fleet-worker.sh 的固定复制
 * 清单没跟上——照旧安装 worker 启动即 MODULE_NOT_FOUND，崩掉 primary 的整个
 * 执行面（attempt + orchestrator 一起）。本守卫机械枚举 require 清单与 installer
 * 覆盖面比对，任何新 require 漏进 installer 都在 CI 变红，不再靠人记。
 *
 * 守卫在真实的边上：读真 fleet-worker.cjs / 真 install-fleet-worker.sh 文件内容
 * （不 mock），installer（install-fleet-worker）的 SOURCE/cp/MOVE 三段都必须
 * 覆盖每个安装包内 .cjs 模块。仅 loadWorkflowModules 中两项已批准模块来自
 * 固定 checkout；AST 核对精确 fallback，真实安装布局验证可选加载及缺件拒绝。
 */
import { describe, it, expect, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, mkdtempSync, mkdirSync, copyFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { parse } = require('acorn');
const { probeFleetWorkerHealth } = require('../../../packages/brain/scripts/fleet-worker/node-probe.cjs');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const WORKER_DIR = join(ROOT, 'packages/brain/scripts/fleet-worker');
const workerSource = readFileSync(join(WORKER_DIR, 'fleet-worker.cjs'), 'utf8');
const installerSource = readFileSync(
  join(WORKER_DIR, 'install-fleet-worker.sh'),
  'utf8',
);

const CHECKOUT_MODULES = ['workflow-profile', 'workflow-runner'];

/** Only the two approved literals in the direct loader function scope belong to the checkout. */
function dependencyLayout(source = workerSource) {
  const ast = parse(source, { ecmaVersion: 'latest', sourceType: 'script', allowHashBang: true });
  const shipped = new Set(), checkout = [], fallback = [], helperRequires = [], helpers = [];
  function walk(node, scope = null) {
    if (!node || typeof node !== 'object') return;
    if (/^(?:FunctionDeclaration|FunctionExpression|ArrowFunctionExpression)$/.test(node.type)) scope = node;
    if (node.type === 'FunctionDeclaration' && node.id?.name === 'loadWorkflowModules') helpers.push(node);
    if (node.type === 'CallExpression' && node.callee.type === 'Identifier' && node.callee.name === 'require') {
      const inLoader = scope?.type === 'FunctionDeclaration' && scope.id?.name === 'loadWorkflowModules';
      if (inLoader) helperRequires.push(node);
      const argument = node.arguments[0];
      if (argument?.type === 'Literal' && typeof argument.value === 'string' && /^\.\/.+\.cjs$/.test(argument.value)) {
        const module = argument.value.slice(2, -4);
        if (inLoader && CHECKOUT_MODULES.includes(module)) checkout.push(module);
        else shipped.add(module);
      } else if (inLoader) {
        const call = argument;
        fallback.push(call?.type === 'CallExpression' && call.callee.type === 'MemberExpression'
          && !call.callee.computed && call.callee.object.name === 'path' && call.callee.property.name === 'join'
          && call.arguments.length === 2 && call.arguments[0].type === 'Identifier' && call.arguments[0].name === 'root'
          && call.arguments[1].type === 'Literal' ? call.arguments[1].value : null);
      }
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(child => walk(child, scope));
      else if (value && typeof value === 'object') walk(value, scope);
    }
  }
  walk(ast);
  return { shipped: [...shipped], checkout, fallback, helperRequires, helpers };
}
const localRequires = () => dependencyLayout().shipped;

function installedLayout() {
  const root = mkdtempSync(join(tmpdir(), 'fleet-worker-installed-layout-'));
  const installed = join(root, 'installed'); mkdirSync(installed);
  for (const entry of readdirSync(WORKER_DIR, { withFileTypes: true })) {
    if (entry.isFile() && /\.(?:cjs|json)$/.test(entry.name)
      && !CHECKOUT_MODULES.some(module => entry.name === `${module}.cjs`)) copyFileSync(join(WORKER_DIR, entry.name), join(installed, entry.name));
  }
  const token = join(root, 'worker-token');
  writeFileSync(token, 'fixture-worker-control-token-32-bytes-only\n', { mode: 0o600 });
  const runCommand = vi.fn(() => { throw Error('fixture_must_not_run_commands'); });
  const probeCredentialHome = vi.fn(() => ({ root, uid: process.getuid?.() }));
  const { createFleetWorkerRuntime } = require(join(installed, 'fleet-worker.cjs'));
  const env = { CECELIA_MACHINE_ID: 'us-mac-m4', CECELIA_RUNNER_DIGEST: `sha256:${'a'.repeat(64)}`,
    CECELIA_FLEET_WORKER_TOKEN_FILE: token, CECELIA_FLEET_DATA_ROOT: join(root, 'data'),
    CECELIA_DRAIN_MARKER: join(root, 'drain'), CECELIA_ORCHESTRATOR_RUNNER_ROOT: join(root, 'missing-checkout') };
  return { root, installed, env, runCommand, probeCredentialHome,
    create: overrides => createFleetWorkerRuntime({ env: { ...env, ...overrides }, runCommand, probeCredentialHome }) };
}

describe('GP F1 step3 — installer 覆盖 worker 运行时依赖', () => {
  it('已打包的本机资源闸拒绝维护期间真实 Docker 启动边界，inspect 保留', async () => {
    const { createLocalLaunchAdmission } = require('../../../packages/brain/scripts/fleet-worker/local-resource-admission.cjs');
    const gate = createLocalLaunchAdmission({ lstat: () => ({}) });
    const commands = [];
    const run = gate.guardCommand(async (cmd, args) => { commands.push(args); });
    await expect(run('docker', ['start', 'owned-container'])).rejects.toThrow('worker_draining');
    await run('docker', ['inspect', 'owned-container']);
    expect(commands).toEqual([['inspect', 'owned-container']]);
    expect(gate.snapshot()).toMatchObject({ draining: true, in_flight_launches: 0 });
  });

  it('真实 install-fleet-worker 升级保留配置、凭据引用和他人安装锁', () => {
    const output = execFileSync('bash', [join(WORKER_DIR, 'install-fleet-worker.test.sh')], {
      encoding: 'utf8', timeout: 120000,
    });
    expect(output).toContain('PASS: Fleet Worker installer behavioral contract');
  }, 125000);

  it('真实健康模块只读 OrbStack bundle，服务账号不触碰管理员目录', async () => {
    for (const readable of [true, false]) {
      const calls = [];
      const report = await probeFleetWorkerHealth({ machineId: 'xian-mac-m1', platform: 'darwin',
        execFileFn: async (file, args, options) => {
          calls.push(file);
          if (file !== '/usr/libexec/PlistBuddy' || !readable) throw Error('EPERM');
          expect(args).toEqual(['-c', 'Print :CFBundleShortVersionString', '/Applications/OrbStack.app/Contents/Info.plist']);
          expect(options.shell).toBe(false);
          return { stdout: '2.2.1\n' };
        },
        makeTempDirFn: async () => { throw Error('no probe container'); },
        statFn: async () => { throw Error('missing'); }, fetchFn: async () => ({ ok: false }),
      });
      expect(report.orbstack.version).toBe(readable ? '2.2.1' : 'unavailable');
      expect(calls).not.toContain('orbctl');
      expect(report.docker.available).toBe(false);
      expect(report.container.probe_succeeded).toBe(false);
    }
  });

  const modules = localRequires();

  it('只有精确的两个公共模块来自固定 checkout，且同一 loader 各有固定路径 fallback', () => {
    const layout = dependencyLayout();
    expect(layout.helpers).toHaveLength(1);
    expect(layout.helpers[0].params.map(parameter => parameter.name)).toEqual(['root']);
    expect(layout.helperRequires).toHaveLength(4);
    expect(layout.checkout.sort()).toEqual(CHECKOUT_MODULES);
    expect(layout.fallback.sort()).toEqual(CHECKOUT_MODULES.map(module => `packages/brain/scripts/fleet-worker/${module}.cjs`));
  });

  it('AST分类不豁免 loader 中新增模块，也不豁免作用域外的同名模块', () => {
    const extra = workerSource.replace("...require('./workflow-runner.cjs'),", "...require('./workflow-runner.cjs'),...require('./unexpected-runtime.cjs'),");
    expect(dependencyLayout(extra).shipped).toContain('unexpected-runtime');
    expect(dependencyLayout(`${workerSource}\nrequire('./workflow-runner.cjs');`).shipped).toContain('workflow-runner');
  });

  it('真实安装布局不含公共模块且未配置 profile 时，现有 Worker 运行面仍可构造', () => {
    const fixture = installedLayout(); let runtime;
    try {
      expect(existsSync(join(fixture.installed, 'workflow-runner.cjs'))).toBe(false);
      expect(existsSync(join(fixture.installed, 'workflow-profile.cjs'))).toBe(false);
      runtime = fixture.create({});
      expect(runtime.workflowRunner).toBeNull();
      expect(runtime.attemptRunner.start).toBeTypeOf('function');
      expect(runtime.orchestratorRunner.start).toBeTypeOf('function');
      expect(fixture.probeCredentialHome).toHaveBeenCalledTimes(1);
      expect(fixture.runCommand).not.toHaveBeenCalled();
    } finally { runtime?.scriptRunner.close(); runtime?.appServerRunner.close(); rmSync(fixture.root, { recursive: true, force: true }); }
  });

  it('真实安装布局配置 profile 后只从指定 checkout 加载公共 Runner', () => {
    const fixture = installedLayout(); let runtime;
    const profiles = join(fixture.root, 'profiles.json');
    writeFileSync(profiles, JSON.stringify({ schema_version: 1, profiles: { demo: {} } }), { mode: 0o600 });
    try {
      runtime = fixture.create({ CECELIA_WORKFLOW_PROFILES_FILE: profiles, CECELIA_ORCHESTRATOR_RUNNER_ROOT: ROOT });
      expect(runtime.workflowRunner.capabilities()).toMatchObject({ protocol: 'common-workflow-runner/v1', profiles: { demo: expect.stringMatching(/^[a-f0-9]{64}$/) } });
      expect(fixture.runCommand).not.toHaveBeenCalled();
    } finally { runtime?.workflowRunner?.close(); runtime?.scriptRunner.close(); runtime?.appServerRunner.close(); rmSync(fixture.root, { recursive: true, force: true }); }
  });

  it('真实安装布局启用 profile 但指定 checkout 缺失时必须拒绝启动', () => {
    const fixture = installedLayout();
    const profiles = join(fixture.root, 'profiles.json');
    writeFileSync(profiles, JSON.stringify({ schema_version: 1, profiles: { demo: {} } }), { mode: 0o600 });
    try {
      expect(() => fixture.create({ CECELIA_WORKFLOW_PROFILES_FILE: profiles })).toThrow(/Cannot find module/);
      expect(fixture.runCommand).not.toHaveBeenCalled();
    } finally { rmSync(fixture.root, { recursive: true, force: true }); }
  });

  it('fleet-worker.cjs 的本地 require 清单非空（解析器自证）', () => {
    expect(modules.length).toBeGreaterThanOrEqual(5);
    expect(modules).toContain('orchestrator-runner');
    expect(modules).toContain('attempt-runner');
  });

  it.each(localRequires())(
    'installer 完整搬运 %s.cjs（SOURCE 声明 + cp staging + MOVE 落位）',
    (mod) => {
      const array = installerSource.match(/^AUXILIARY_FILES=\(([^)]*)\)/m);
      if (array?.[1].split(/\s+/).includes(`${mod}.cjs`)) {
        expect(installerSource).toContain('mktemp "$RUNTIME_DIR/.${AUXILIARY_FILES[$index]}.XXXXXX"');
        expect(installerSource).toContain('cp "$SCRIPT_DIR/${AUXILIARY_FILES[$index]}" "${STAGED_AUXILIARY_FILES[$index]}"');
        expect(installerSource).toMatch(/"\$MOVE" "\$\{STAGED_AUXILIARY_FILES\[\$index\]\}"\s*\\\s*"\$RUNTIME_DIR\/\$\{AUXILIARY_FILES\[\$index\]\}"/);
        return;
      }
      // SOURCE 声明：installer 把它列为必需源文件
      expect(installerSource).toMatch(
        new RegExp(`_SOURCE="\\$SCRIPT_DIR/${mod}\\.cjs"`),
      );
      // cp staging：真的复制进 staging 区
      expect(installerSource).toMatch(
        new RegExp(`cp "\\$[A-Z_]+_SOURCE" "\\$STAGED_[A-Z_]+"[\\s\\S]{0,400}`),
      );
      expect(installerSource).toContain(`${mod}.cjs.XXXXXX`);
      // MOVE 落位：staging → runtime 目录
      expect(installerSource).toContain(`${mod}.cjs"`);
    },
  );

  it('installer 行为契约自测存在且断言 orchestrator-runner 安装', () => {
    const testSh = readFileSync(
      join(WORKER_DIR, 'install-fleet-worker.test.sh'),
      'utf8',
    );
    expect(testSh).toContain('installed_orchestrator_runner');
  });
});
