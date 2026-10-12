import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { git } from '../../__tests__/helpers/git.mjs';
import { stageQaRecords } from '../lib/qa-records.mjs';
const intent = { sprintDir: 'sprints/10121524-cw-088c3431', taskId: '088c3431-57ca-4f2a-8a50-14601518e2a2', round: 1 };
const report = `${intent.sprintDir}/05-qa-report-r1.md`;
const shots = `${intent.sprintDir}/qa-r1`;
describe('QA 记录只对当前任务/轮次限定路径 force-add（真实 Git）', () => {
  let dir;
  const put = (p, text = 'record') => { fs.mkdirSync(path.dirname(path.join(dir, p)), { recursive: true }); fs.writeFileSync(path.join(dir, p), text); };
  const staged = () => git(dir, 'diff', '--cached', '--name-only').trim();
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-records-'));
    git(dir, 'init', '-q'); git(dir, 'config', 'core.ignorecase', 'true');
    git(dir, 'config', 'user.useConfigOnly', 'true');
    git(dir, 'config', 'user.name', 'QA fixture');
    git(dir, 'config', 'user.email', 'qa-fixture@example.invalid');
    put('.gitignore', '*REPORT*.md\nqa-r*/\n'); git(dir, 'add', '.gitignore'); git(dir, 'commit', '-qm', 'fixture');
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));
  it('被忽略的报告、截图均提交；非记录仍忽略，配置不改', async () => {
    put(report); put(`${shots}/screen.png`); put('private-REPORT.md', 'private');
    await stageQaRecords(dir, intent, [report, shots]);
    expect(staged().split('\n')).toEqual([report, `${shots}/screen.png`]);
    git(dir, 'commit', '-qm', 'QA records');
    expect(git(dir, 'show', '--name-only', '--format=', 'HEAD')).toContain(report);
    expect(git(dir, 'config', '--get', 'core.ignorecase').trim()).toBe('true');
    expect(fs.readFileSync(path.join(dir, '.gitignore'), 'utf8')).toBe('*REPORT*.md\nqa-r*/\n');
  });
  it.each(['../escape.md', '/tmp/report.md', `${intent.sprintDir}/02-spec.md`, `${intent.sprintDir}/05-qa-report-r2.md`,
    'sprints/other-cw-088c3431/05-qa-report-r1.md', `${shots}/../05-qa-report-r1.md`, '.git/config', 'private-REPORT.md'])('非法记录 %s 不触碰索引', async (bad) => {
    put(report);
    await expect(stageQaRecords(dir, intent, [report, bad])).rejects.toThrow('qa_record_path_invalid');
    expect(staged()).toBe('');
  });
  it('空记录集拒绝，不能提交已有暂存；非空记录也拒预暂存夹带', async () => {
    put('unrelated.txt');git(dir, 'add', 'unrelated.txt');
    await expect(stageQaRecords(dir, intent, [])).rejects.toThrow('qa_records_empty');
    put(report);await expect(stageQaRecords(dir, intent, [report])).rejects.toThrow('qa_records_index_not_empty');
    expect(staged()).toBe('unrelated.txt');
  });
  it.each(['file', 'parent', 'dangling'])('拒绝 %s 符号链接，且先验全部路径', async (kind) => {
    put(report);put('outside.txt', 'private');fs.mkdirSync(path.join(dir, shots), { recursive: true });
    if (kind === 'parent') { fs.rmdirSync(path.join(dir, shots));fs.symlinkSync(dir, path.join(dir, shots)); }
    else fs.symlinkSync(path.join(dir, kind === 'dangling' ? 'missing.txt' : 'outside.txt'), path.join(dir, shots, 'screen.png'));
    await expect(stageQaRecords(dir, intent, [report, shots])).rejects.toThrow('qa_record_path_invalid');expect(staged()).toBe('');
  });
  it('任务与sprint不一致或非法轮次拒绝', async () => {
    put(report);
    await expect(stageQaRecords(dir, { ...intent, taskId: 'aaaaaaaa-0000-0000-0000-000000000000' }, [report])).rejects.toThrow('qa_record_path_invalid');
    await expect(stageQaRecords(dir, { ...intent, round: 0 }, [report])).rejects.toThrow('qa_record_path_invalid');
  });
});
