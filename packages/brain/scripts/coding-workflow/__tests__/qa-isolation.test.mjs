import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import * as provenance from '../lib/record-provenance.mjs';

const taskId = '088c3431-57ca-4f2a-8a50-14601518e2a2', sprintDir = 'sprints/10121524-cw-088c3431';
const owner = 'packages/brain/scripts/coding-workflow/runner/run-once.mjs';
const names = ['03-build.md', '04-evidence.md'];
let temp, worktree, root, options, head, latestStageId;
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
const seal = () => { const stage = provenance.sealStageEvidence({ files: [rel('05-qa-report-r1.md')],
  result: { status: 'completed', outputs: { qa: { verdict: 'PASS', round: 1 } } } });latestStageId = stage.id;return stage; };
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
  const pending = provenance.verifyPendingStageEvidence({ ...options, head, stageEventId: latestStageId }, [rel('05-qa-report-r1.md')]);
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
  expect(() => provenance.verifyPendingStageEvidence({ ...options, round: 2, head, stageEventId: latestStageId }, [rel('05-qa-report-r1.md')])).toThrow(/round|isolation/);
});
it('model supplied projection fields cannot turn registration facts into controller isolation proof', () => {
  successful();const pending = provenance.verifyPendingStageEvidence({ ...options, head, stageEventId: latestStageId }, [rel('05-qa-report-r1.md')]);
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
    expect(readEvents().find(e => e.kind === 'native')?.stdout).toContain('fixture-session');
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
// 管理员级夹具改写仅用于验证 reader 拒绝坏结构；不宣称模型可写受保护目录。
const rewrite = (event, change) => {
  change(event);delete event.digest;
  const digest = execFileSync(process.execPath, ['--input-type=module', '-e',
    "import {createHash} from 'node:crypto';process.stdout.write(createHash('sha256').update(process.argv[1]).digest('hex'));", JSON.stringify(event)], { encoding: 'utf8' });
  fs.writeFileSync(path.join(root, taskId, `${event.id}.json`), JSON.stringify({ ...event, digest }));
};
it.each(['missing-restored', 'missing-hidden', 'missing-link', 'extra-key', 'missing-file', 'extra-file', 'reordered', 'path', 'hash', 'mode',
  'fs-mode', 'run', 'round', 'head', 'native', 'time', 'holder', 'stage-link', 'native-link', 'native-error', 'schema'])('persisted lifecycle reader rejects %s', kind => {
  const { stage } = successful(), all = readEvents();
  const restored = all.find(e => e.kind === 'isolation' && e.phase === 'restored');
  const hidden = all.find(e => e.kind === 'isolation' && e.phase === 'hidden');
  if (kind === 'missing-restored' || kind === 'missing-hidden') fs.unlinkSync(path.join(root, taskId, `${kind === 'missing-restored' ? restored.id : hidden.id}.json`));
  else if (kind === 'stage-link') rewrite(stage, e => { delete e.isolation_event_id; });
  else if (kind === 'native-error') rewrite(all.find(e => e.id === restored.native_event_id), e => { e.isolation_error = 'boundary_failed'; });
  else if (kind === 'native-link') rewrite(all.find(e => e.id === restored.native_event_id), e => { e.isolation_hidden_event_id = restored.id; });
  else rewrite(restored, e => {
    if (kind === 'schema') e.schema_version = 2;
    if (kind === 'missing-link') delete e.hidden_event_id;
    if (kind === 'extra-key') e.approved = true;
    if (kind === 'missing-file') e.files.pop();
    if (kind === 'extra-file') e.files.push({ ...e.files[0] });
    if (kind === 'reordered') e.files.reverse();
    if (kind === 'path') e.files[0].path = `${sprintDir}/README.md`;
    if (kind === 'hash') e.files[0].sha256 = '0'.repeat(64);
    if (kind === 'mode') e.files[0].mode = '100755';
    if (kind === 'fs-mode') e.files[0].fs_mode = 0o777;
    if (kind === 'run') e.run_id = 'aaaaaaaa-0000-0000-0000-000000000000';
    if (kind === 'round') e.round = 2;
    if (kind === 'head') e.head = '0'.repeat(40);
    if (kind === 'native') e.native_event_id = hidden.id;
    if (kind === 'time') e.observed_at = '1970-01-01T00:00:00.000Z';
    if (kind === 'holder') e.files[0].holder_path = path.join(worktree, 'model-receipt.json');
  });
  expect(() => provenance.verifyPendingStageEvidence({ ...options, head, stageEventId: latestStageId }, [rel('05-qa-report-r1.md')])).toThrow(/isolation|event_invalid/);
});
it('duplicate begin cannot create a second lifecycle and an interrupted run cannot be recovered as PASS', () => {
  provenance.withRecordProvenance(options, () => {
    begin();expect(() => begin()).toThrow(/isolation/);
  });
  // 模拟控制器中断：不调用restore。原件留在受保护holder，新run不得将其冒充自己的完成事件。
  provenance.withRecordProvenance(options, () => expect(() => begin()).toThrow(/isolation/));
  const hidden = readEvents().find(e => e.phase === 'hidden');
  expect(hidden.files.every(f => fs.existsSync(f.holder_path))).toBe(true);
  expect(readEvents().some(e => e.phase === 'restored')).toBe(false);
});
it('after successful restore an abort still prevents sealing an approving stage', () => {
  provenance.withRecordProvenance(options, () => {
    const isolation = begin();native();report();expect(isolation.restore()).toBe(true);
    expect(isolation.abort()).toBe(true);expect(() => seal()).toThrow(/isolation/);
  });
});
it.each([0o1644, 0o2644, 0o4644])('current reader rejects special permission bits %s on restored files', mode => {
  successful();fs.chmodSync(full(names[0]), mode);
  expect(() => provenance.verifyPendingStageEvidence({ ...options, head, stageEventId: latestStageId }, [rel('05-qa-report-r1.md')])).toThrow(/isolation/);
});
it('special holder permission bits cannot be accepted at native capture or restoration', () => {
  provenance.withRecordProvenance(options, () => {
    const isolation = begin(), hidden = readEvents().find(e => e.phase === 'hidden');
    fs.chmodSync(hidden.files[0].holder_path, 0o1644);
    expect(() => native()).toThrow(/isolation/);expect(isolation.restore()).toBe(false);
    expect(fs.readFileSync(full(names[1]), 'utf8')).toBe('secret developer evidence\n');
  });
});
it('same-head same-round same-byte attempts select the explicit stage, never UUID order', () => {
  const first = successful().stage, second = successful().stage;
  const get = stageEventId => provenance.verifyPendingStageEvidence({ ...options, head, stageEventId }, [rel('05-qa-report-r1.md')]);
  expect(get(first.id).isolation.qa_stage_event_id).toBe(first.id);
  expect(get(second.id).isolation.qa_stage_event_id).toBe(second.id);
  expect(() => get('aaaaaaaa-0000-0000-0000-000000000000')).toThrow(/stage|isolation/);
  expect(() => get(undefined)).toThrow(/stage|isolation/);
});
