import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import yaml from 'js-yaml';
import { runInNewContext } from 'node:vm';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const worker = 'packages/brain/scripts/fleet-worker/';
const suites = ['resource-canaries'];
const workflow = name => yaml.load(readFileSync(join(root, '.github/workflows', name), 'utf8'));
for (const id of suites) {
  const name=id+'.yml';
  const job = workflow('ci.yml').jobs[id];
  test(`${name}: 资源专项按成功计划过滤，workflow不丢弃PR`, () => {
    assert.ok(job); assert.equal(workflow('ci.yml').on.pull_request.paths, undefined);
    assert.equal(job.if, "github.event_name != 'schedule' && github.event.action != 'closed' && contains(needs.plan.outputs.resource_plan, 'true')");
    assert.equal(job.needs, 'plan');
  });
  for (const step of job.steps.filter(s => s.run?.includes('| tee '))) {
    for (const exitCode of [0, 19]) test(`${name}: ${step.name} 真shell保留子进程退出${exitCode}`, () => {
      const temp = mkdtempSync(join(tmpdir(), 'resource-canary-shell-'));
      try {
        const node = join(temp, 'node');
        writeFileSync(node, `#!/bin/sh\nprintf '%s\\n' "$*" > "$MARKER"\nprintf 'canary-output\\n'\nexit ${exitCode}\n`);
        chmodSync(node, 0o755);
        const result = spawnSync('bash', ['-e', '-c', step.run], { cwd: temp, encoding: 'utf8',
          env: { PATH: `${temp}:${process.env.PATH}`, MARKER: join(temp, 'invoked') }, timeout: 10000 });
        assert.equal(result.status, exitCode, result.stdout + result.stderr);
        assert.match(readFileSync(join(temp, 'invoked'), 'utf8'), /packages\/brain\/scripts\/fleet-worker\/.+-canary\.cjs/);
        const log = step.run.match(/tee\s+([^\s]+)/)[1];
        assert.equal(readFileSync(join(temp, log), 'utf8'), 'canary-output\n');
      } finally { rmSync(temp, { recursive: true, force: true }); }
    });
  }
}

test('现役Linux观测保留不可变镜像、真实shell失败和独立证据', () => {
  const jobs = workflow('ci.yml').jobs, job = jobs['resource-canaries'];
  assert.ok(job);
  for (const old of ['linux-resource-canary']) assert.equal(jobs[old], undefined);
  assert.equal(job.steps.filter(step => step.uses === 'actions/checkout@v4').length, 1);
  assert.deepEqual(job.steps.filter(step => step.uses === 'actions/setup-node@v4').map(step => step.with['node-version']), ['24']);
  const canaries = job.steps.filter(step => step.run?.includes('| tee '));
  assert.equal(canaries.length, 1);
  for (const step of canaries) {
    const flag = step.id;
    assert.equal(step.if, `!cancelled() && fromJSON(needs.plan.outputs.resource_plan).${flag}`);
    assert.equal(job.outputs[step.id], '${{ steps.' + step.id + '.outcome }}');
    assert.equal(step['continue-on-error'], undefined);
    assert.match(step.run, /set -o pipefail/);
  }
  const preparation = job.steps.filter(step => step.run && !step.run.includes('| tee ')).map(step => step.run).join('\n');
  for (const variable of ['LINUX_RESOURCE_CANARY_IMAGE']) {
    assert.match(preparation, new RegExp(variable + '=\\$\\(docker image inspect'));
  }
  assert.equal(job.steps.some(step => step.uses === './.github/actions/dockerhub-mirror'), false, '共享runner不能热加载Docker导致host-gateway失效');
  assert.match(preparation, /node:24-bookworm-slim/);
  const artifacts = job.steps.filter(step => step.uses === 'actions/upload-artifact@v4');
  assert.deepEqual(artifacts.map(step => step.with.name).sort(), ['linux-resource-observation'].sort());
  for (const artifact of artifacts) assert.match(artifact.if, /^always\(\) && fromJSON\(needs.plan.outputs.resource_plan\)\.linux$/);
});

// 执行真实 canary 发给容器的采样程序；变异数据必须触发同一组断言。
const linuxSource = readFileSync(join(root, worker, 'linux-resource-canary.cjs'), 'utf8');
const linuxProgram = linuxSource.match(/const program = `([\s\S]*?)`;/)[1];
const observed = { status: 'observed', cpu_cores: 0.5, memory_limit_bytes: 134217728,
  memory_available_bytes: 67108864, execution: false, pool_verified: false, ancestry_visible: false };
for (const [field, value] of [[null, null], ['status', 'unknown'], ['cpu_cores', 1],
  ['memory_limit_bytes', 268435456], ['memory_available_bytes', -1],
  ['memory_available_bytes', 134217729], ['execution', true], ['pool_verified', true], ['ancestry_visible', true]]) {
  test(`Linux真实采样断言拒绝变异 ${field ?? '正常基线'}=${value}`, async () => {
    const report = { ...observed, ...(field ? { [field]: value } : {}) }, childProcess = { exitCode: 0 };
    await runInNewContext(linuxProgram, { process: childProcess, console: { log() {}, error() {} },
      require: name => name === 'node:assert/strict' ? assert : { sampleLinuxResources: async () => report } });
    assert.equal(childProcess.exitCode, field ? 1 : 0);
  });
}

test('实际YAML计划控制每个准备/执行/证据step，不允许job绿掩盖step跳过',()=>{
  const config=workflow('ci.yml'), job=config.jobs['resource-canaries'];
  assert.equal(config.jobs.plan.outputs.resource_plan,'${{ steps.resources.outputs.resource_plan }}');
  assert.deepEqual(config.on.workflow_dispatch.inputs.resource_canary.options,['none','linux']);
  const scope=config.jobs.plan.steps.find(step=>step.id==='resources');
  assert.match(scope.run,/--base "\$BASE_SHA" --head "\$HEAD_SHA" --manual "\$RESOURCE_CANARY"/);
  for(const flags of [{linux:false},{linux:true}]) {
    const ctx={github:{event_name:'pull_request',event:{action:'opened'}},needs:{plan:{outputs:{resource_plan:JSON.stringify(flags)}}},
      contains:(value,part)=>value.includes(part),fromJSON:JSON.parse,always:()=>true,cancelled:()=>false};
    assert.equal(runInNewContext(job.if,ctx),Object.values(flags).some(Boolean));
    for(const step of job.steps.filter(step=>step.run || step.uses==='actions/upload-artifact@v4')) {
      assert.ok(step.if,step.name);
      const flag=step.if.match(/\.(linux)$/)?.[1];assert.ok(flag,step.name);
      assert.equal(runInNewContext(step.if,ctx),flags[flag],step.name);
      assert.equal(step['continue-on-error'],undefined);
    }
  }
});
