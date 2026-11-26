import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const workflow = fileURLToPath(new URL('../', import.meta.url));
const retired = [
  'runner', 'activities', 'new-task.mjs', 'contract.json', 'repos.json',
  'lib/activity-provenance.mjs', 'lib/record-provenance.mjs',
  'lib/record-provenance-store.mjs', 'lib/record-provenance-records.mjs',
  'lib/record-provenance-history.mjs', 'lib/record-provenance-inputs.mjs',
  'lib/record-provenance-qa.mjs', 'lib/record-sources.mjs', 'lib/qa-isolation.mjs',
];

describe('自主 coding runner 退役边界', () => {
  it('不再提供认领、安装、建单或自动合并的旧执行入口', () => {
    for (const relative of retired) expect(fs.existsSync(path.join(workflow, relative)), relative).toBe(false);
    // 先断言文件已删除，再执行路径：守卫失败时绝不点火旧 runner。
    const result = spawnSync(process.execPath, [path.join(workflow, 'runner/run-once.mjs')], { encoding: 'utf8' });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('MODULE_NOT_FOUND');
  });

  it('共享模型调用不再加载专属 Git 来源证明链', async () => {
    const source = fs.readFileSync(path.join(workflow, 'lib/claude.mjs'), 'utf8');
    expect(source).not.toContain('record-provenance');
    const protocol = fs.readFileSync(path.join(workflow, 'lib/protocol.mjs'), 'utf8');
    expect(protocol).not.toContain('activity-provenance');
    const { callCodexJudge } = await import('../lib/codex-judge.mjs');
    expect(typeof callCodexJudge).toBe('function');
  });

  it('保留通用执行的证据目录隔离', async () => {
    const { provenanceRoot, assertProvenanceSeparation } = await import('../lib/provenance-path.mjs');
    const root = provenanceRoot('/tmp/retired-coding-runner-guard');
    expect(() => assertProvenanceSeparation(root, [path.join(root, 'candidate')])).toThrow('provenance_path_overlap');
    expect(() => assertProvenanceSeparation(root, ['/tmp/retired-coding-worktree-guard'])).not.toThrow();
  });
});
