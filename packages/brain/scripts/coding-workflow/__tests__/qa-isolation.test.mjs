import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import * as provenance from '../lib/record-provenance.mjs';

const taskId = '088c3431-57ca-4f2a-8a50-14601518e2a2', sprintDir = 'sprints/10121524-cw-088c3431';
const owner = 'packages/brain/scripts/coding-workflow/runner/run-once.mjs';
const names = ['03-build.md', '04-evidence.md'];
let temp, worktree, root, options, head;
const rel = name => `${sprintDir}/${name}`;
const full = name => path.join(worktree, rel(name));
const git = (...args) => {
  const env = { ...process.env };for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE']) delete env[k];
  return execFileSync('git', ['-C', worktree, '-c', 'core.hooksPath=/dev/null', ...args], { env, encoding: 'utf8' }).trim();
};
const put = (name, bytes) => fs.writeFileSync(full(name), bytes);
const report = () => put('05-qa-report-r1.md', `---\ntask_id: ${taskId}\nstep: evaluate\nupstream: []\n---\nObserved QA\n`);
const native = () => provenance.captureNativeExecution({ provider: 'codex', model: 'fixture', tag: 'evaluate', code: 0,
  stdout: '{"type":"thread.started","thread_id":"fixture-session"}\n{"type":"turn.completed"}\n' });
const seal = () => provenance.sealStageEvidence({ files: [rel('05-qa-report-r1.md')],
  result: { status: 'completed', outputs: { qa: { verdict: 'PASS', round: 1 } } } });
const readEvents = () => fs.readdirSync(path.join(root, taskId)).filter(n => n.endsWith('.json'))
  .map(n => JSON.parse(fs.readFileSync(path.join(root, taskId, n))));
function begin() {
  expect(provenance.beginEvaluateIsolation, 'controller isolation API is required').toBeTypeOf('function');
  return provenance.beginEvaluateIsolation();
}
function successful() {
  return provenance.withRecordProvenance(options, () => {
    const isolation = begin();
    for (const name of names) expect(fs.existsSync(full(name))).toBe(false);
    const run = native();report();expect(isolation.restore()).toBe(true);
    return { stage: seal(), run };
  });
}
beforeEach(() => {
  temp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'qa-isolation-'));
  worktree = path.join(temp, 'repo');root = path.join(temp, 'protected');fs.mkdirSync(worktree);
  git('init', '-qb', 'cp-10121524-cw-088c3431');git('config', 'user.name', 'fixture');git('config', 'user.email', 'fixture@example.invalid');
  git('remote', 'add', 'origin', 'https://github.com/perfectuser21/cecelia.git');fs.mkdirSync(path.dirname(full('03-build.md')), { recursive: true });
  put('03-build.md', 'secret developer statement\n');put('04-evidence.md', 'secret developer evidence\n');
  fs.mkdirSync(path.dirname(path.join(worktree, owner)), { recursive: true });fs.writeFileSync(path.join(worktree, owner), '// fixture controller');
  git('add', '.');git('commit', '-qm', 'fixed input');head = git('rev-parse', 'HEAD');
  options = { worktree, root, taskId, sprintDir, stage: 'evaluate', round: 1,
    controller: provenance.controllerIdentity(new URL(`file://${path.join(worktree, owner)}`)) };
});
afterEach(() => { vi.restoreAllMocks();fs.rmSync(temp, { recursive: true, force: true }); });

it('model/native PASS without actual hide/restore cannot seal an approving evaluate stage', () => {
  provenance.withRecordProvenance(options, () => {
    report();
    expect(() => { native();seal(); }).toThrow(/isolation/);
  });
});
it('real hide/native/restore links current QA to exact task/run/round/head without exposing hidden text', () => {
  const { stage, run } = successful();
  for (const [i, name] of names.entries()) expect(fs.readFileSync(full(name), 'utf8')).toBe(i ? 'secret developer evidence\n' : 'secret developer statement\n');
  const pending = provenance.verifyPendingStageEvidence({ ...options, head }, [rel('05-qa-report-r1.md')]);
  const projected = provenance.provenanceProjection(pending);
  expect(stage.producer).toBe('model');
  expect(projected.isolation).toMatchObject({ status: 'restored', producer: 'controller', task_id: taskId,
    stage: 'evaluate', round: 1, tested_head: head, qa_stage_event_id: stage.id, native_event_id: run.id });
  expect(projected.isolation.files.map(f => f.path)).toEqual(names.map(rel));
  expect(JSON.stringify(projected)).not.toMatch(/secret developer|hidden_path|holder_path/);
  expect(JSON.stringify(projected)).not.toContain(worktree);
  const events = readEvents(), hidden = events.find(e => e.kind === 'isolation' && e.phase === 'hidden');
  const restored = events.find(e => e.kind === 'isolation' && e.phase === 'restored');
  expect(restored).toMatchObject({ hidden_event_id: hidden.id, native_event_id: run.id, run_id: stage.run_id, head });
  expect(stage.isolation_event_id).toBe(restored.id);
});
it.each(['missing', 'changed', 'symlink', 'mode'])('wrong original file identity rejects before native: %s', kind => {
  if (kind === 'missing') fs.unlinkSync(full(names[0]));
  if (kind === 'changed') put(names[0], 'changed');
  if (kind === 'symlink') { fs.unlinkSync(full(names[0]));fs.symlinkSync(full(names[1]), full(names[0])); }
  if (kind === 'mode') fs.chmodSync(full(names[0]), 0o755);
  provenance.withRecordProvenance(options, () => expect(() => begin()).toThrow(/isolation|file|symlink/));
  expect(fs.readFileSync(full(names[1]), 'utf8')).toBe('secret developer evidence\n');
});
it('model recreation is preserved, other file restored, and no successful stage can be sealed', () => {
  provenance.withRecordProvenance(options, () => {
    const isolation = begin();native();report();put(names[0], 'unexpected model write');
    expect(isolation.restore()).toBe(false);
    expect(fs.readFileSync(full(names[0]), 'utf8')).toBe('unexpected model write');
    expect(fs.readFileSync(full(names[1]), 'utf8')).toBe('secret developer evidence\n');
    expect(() => seal()).toThrow(/isolation/);
    expect(readEvents().some(e => e.kind === 'isolation' && e.phase === 'restored')).toBe(false);
  });
});
it('first restore I/O failure still attempts the second file and cannot later become PASS', () => {
  provenance.withRecordProvenance(options, () => {
    const isolation = begin();native();report();
    const copy = fs.copyFileSync;
    vi.spyOn(fs, 'copyFileSync').mockImplementation((from, to, ...args) => {
      if (to === full(names[0])) throw Error('fixture restore disk failure');
      return copy(from, to, ...args);
    });
    expect(isolation.restore()).toBe(false);
    expect(fs.readFileSync(full(names[1]), 'utf8')).toBe('secret developer evidence\n');
    vi.restoreAllMocks();expect(isolation.restore()).toBe(false);expect(() => seal()).toThrow(/isolation/);
  });
});
it('abort restores every file but never seals a completed isolation lifecycle', () => {
  provenance.withRecordProvenance(options, () => {
    const isolation = begin();report();expect(isolation.abort()).toBe(true);
    for (const name of names) expect(fs.existsSync(full(name))).toBe(true);
    expect(() => { native();seal(); }).toThrow(/isolation/);
    expect(readEvents().some(e => e.kind === 'isolation' && e.phase === 'restored')).toBe(false);
  });
});
it('hidden event write failure restores actual files and never returns a start token', () => {
  provenance.withRecordProvenance(options, () => {
    vi.spyOn(fs, 'linkSync').mockImplementationOnce(() => { throw Error('fixture receipt disk failure'); });
    expect(() => begin()).toThrow(/receipt disk failure/);
    for (const name of names) expect(fs.existsSync(full(name))).toBe(true);
  });
});
it('restored event write failure cannot be disguised by successfully restored files', () => {
  provenance.withRecordProvenance(options, () => {
    const isolation = begin();native();report();
    vi.spyOn(fs, 'linkSync').mockImplementationOnce(() => { throw Error('fixture receipt disk failure'); });
    expect(isolation.restore()).toBe(false);
    for (const name of names) expect(fs.existsSync(full(name))).toBe(true);
    expect(() => seal()).toThrow(/isolation/);
  });
});
it('a native completion outside the hidden interval cannot be reused', () => {
  provenance.withRecordProvenance(options, () => {
    const isolation = begin();report();expect(isolation.restore()).toBe(false);
    expect(() => { native();seal(); }).toThrow(/isolation/);
  });
});
it.each(['head', 'holder'])('during-session %s drift cannot produce successful restoration evidence', kind => {
  provenance.withRecordProvenance(options, () => {
    const isolation = begin();native();report();
    if (kind === 'head') { fs.writeFileSync(path.join(worktree, 'other.txt'), 'changed');git('add', 'other.txt');git('commit', '-qm', 'head drift'); }
    else {
      const hidden = readEvents().find(e => e.kind === 'isolation' && e.phase === 'hidden');
      fs.writeFileSync(hidden.files[0].holder_path, 'tampered holder');
    }
    expect(isolation.restore()).toBe(false);expect(() => seal()).toThrow(/isolation/);
  });
});
it('a stale same-byte QA stage from another round cannot supply current isolation facts', () => {
  successful();
  expect(() => provenance.verifyPendingStageEvidence({ ...options, round: 2, head }, [rel('05-qa-report-r1.md')])).toThrow(/round|isolation/);
});
it('model supplied projection fields cannot turn registration facts into controller isolation proof', () => {
  successful();const pending = provenance.verifyPendingStageEvidence({ ...options, head }, [rel('05-qa-report-r1.md')]);
  expect(() => provenance.provenanceProjection({ ...pending, isolation: { ...pending.isolation, producer: 'model' } })).toThrow(/isolation|projection/);
  expect(() => provenance.provenanceProjection({ ...pending, isolation: { ...pending.isolation, body: 'hidden text' } })).toThrow(/isolation|projection/);
});
it('restoration preserves actual non-executable permissions, not only Git mode', () => {
  fs.chmodSync(full(names[0]), 0o640);fs.chmodSync(full(names[1]), 0o600);
  successful();
  expect(fs.statSync(full(names[0])).mode & 0o777).toBe(0o640);
  expect(fs.statSync(full(names[1])).mode & 0o777).toBe(0o600);
});
it('capture rechecks missing workspace files instead of trusting earlier hide receipt', () => {
  provenance.withRecordProvenance(options, () => {
    const isolation = begin();put(names[0], 'model recreated');
    expect(() => native()).toThrow(/isolation/);
    expect(isolation.restore()).toBe(false);
    expect(fs.readFileSync(full(names[1]), 'utf8')).toBe('secret developer evidence\n');
  });
});
it('capture rechecks holder integrity and abort cannot later be restored into success', () => {
  provenance.withRecordProvenance(options, () => {
    const isolation = begin(), hidden = readEvents().find(e => e.phase === 'hidden');
    fs.writeFileSync(hidden.files[0].holder_path, 'changed');
    expect(() => native()).toThrow(/isolation/);
    expect(isolation.abort()).toBe(false);expect(isolation.restore()).toBe(false);
  });
});
