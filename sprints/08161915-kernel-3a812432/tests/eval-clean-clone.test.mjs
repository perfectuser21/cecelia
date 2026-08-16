import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);

const RUN_A = 'e64c335a-63a0-457e-bd58-02b43ed2ad83';
const ATT_1 = '41457bc7-a28e-48a9-aa1d-eb052a151ee3';

function loadRunContainer() {
  return require('../../../packages/brain/scripts/fleet-worker/run-container.cjs');
}
function loadQuarantine() {
  // TDD Red: candidate-quarantine.cjs 尚不存在 → require 抛错，整组 RED。
  return require('../../../packages/brain/scripts/fleet-worker/candidate-quarantine.cjs');
}

describe('Fleet eval container routing [BEHAVIOR]', () => {
  it('evaluator role gets an attempt-scoped, clean, non-reused eval container', () => {
    const m = loadRunContainer();
    const t = m.resolveContainerTarget({ role: 'evaluator', runId: RUN_A, attemptId: ATT_1 });
    expect(t.name).toBe('cecelia-fleet-eval-41457bc7');
    expect(t.scope).toBe('attempt');
    expect(t.reuse).toBe(false);
    expect(t.clean).toBe(true);
  });

  it('fallback off (FLEET_RUN_SCOPED_CONTAINER=off) uses legacy per-attempt container', () => {
    const m = loadRunContainer();
    const t = m.resolveContainerTarget({ role: 'generator', runId: RUN_A, attemptId: ATT_1, runScoped: false });
    expect(t.scope).toBe('attempt');
    expect(t.reuse).toBe(false);
    expect(t.name).toBe(`cecelia-fleet-${ATT_1}`);
  });
});

describe('Candidate quarantine bundle + clean eval clone [BEHAVIOR]', () => {
  let tmp;
  let workRepo;
  let quarantine;
  let candidateSha;

  beforeAll(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-quarantine-'));
    workRepo = path.join(tmp, 'work');
    quarantine = path.join(tmp, 'quarantine');
    fs.mkdirSync(workRepo, { recursive: true });
    fs.mkdirSync(quarantine, { recursive: true });
    const git = (args) => execFileSync('git', args, { cwd: workRepo, stdio: 'pipe' });
    git(['init', '-q']);
    git(['config', 'user.email', 'harness@example.invalid']);
    git(['config', 'user.name', 'harness']);
    fs.writeFileSync(path.join(workRepo, 'app.js'), 'console.log("candidate");\n');
    git(['add', 'app.js']);
    git(['commit', '-q', '-m', 'candidate']);
    candidateSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: workRepo }).toString().trim();
    // 工作容器污染物：未提交的缓存/标记文件，绝不能出现在 eval 干净克隆中
    fs.writeFileSync(path.join(workRepo, '.work-container-marker'), 'polluted');
    fs.mkdirSync(path.join(workRepo, 'node_modules', '.cache'), { recursive: true });
    fs.writeFileSync(path.join(workRepo, 'node_modules', '.cache', 'x'), 'cache');
  });

  afterAll(() => {
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('bundles the candidate SHA into the quarantine volume (git bundle, real fs)', () => {
    const q = loadQuarantine();
    const res = q.bundleCandidate({ repoDir: workRepo, runId: RUN_A, quarantineRoot: quarantine });
    expect(res.sha).toBe(candidateSha);
    expect(fs.existsSync(res.bundlePath)).toBe(true);
    expect(res.bundlePath.startsWith(quarantine)).toBe(true);
  });

  it('eval clone from bundle reaches candidate SHA and inherits NO work-container files', () => {
    const q = loadQuarantine();
    const { bundlePath } = q.bundleCandidate({ repoDir: workRepo, runId: RUN_A, quarantineRoot: quarantine });
    const dest = path.join(tmp, 'eval-clone');
    const out = q.cloneEvalFromBundle({ bundlePath, candidateSha, destDir: dest });
    expect(out.headSha).toBe(candidateSha);
    // 防污染：工作容器的未提交标记/缓存不得进入 eval 克隆
    expect(fs.existsSync(path.join(dest, '.work-container-marker'))).toBe(false);
    expect(fs.existsSync(path.join(dest, 'node_modules', '.cache'))).toBe(false);
    expect(fs.existsSync(path.join(dest, 'app.js'))).toBe(true);
  });
});
