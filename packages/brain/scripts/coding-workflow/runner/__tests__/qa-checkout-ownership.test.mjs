import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { git } from '../../__tests__/helpers/git.mjs';
import { useQaEnv } from './helpers/qa-env.mjs';

describe('QA入口尊重工作区归属', () => {
  const E = useQaEnv();
  it('目标路径已有未知独立仓库时保留其原字节，不调用QA或裁判', async () => {
    fs.mkdirSync(E.sb.worktreeBase, { recursive: true });
    const foreign = path.join(E.sb.worktreeBase, 'qa-77-1');
    git(E.sb.clone, 'clone', '-q', E.sb.origin, foreign);
    const head = git(foreign, 'rev-parse', 'HEAD');
    fs.writeFileSync(path.join(foreign, 'unknown-owner.bin'), Buffer.from([0, 7, 255]));
    const result = await E.go(E.green());
    expect(result.exitCode, result.stderr).toBe(0);
    expect(fs.existsSync(path.join(foreign, 'unknown-owner.bin'))).toBe(true);
    expect(fs.readFileSync(path.join(foreign, 'unknown-owner.bin'))).toEqual(Buffer.from([0, 7, 255]));
    expect(git(foreign, 'rev-parse', 'HEAD')).toBe(head);
    expect(E.qaCalls()).toEqual([]);
    expect(E.judge.calls).toEqual([]);
    expect(E.state().rounds).toEqual([]);
    expect(E.state().bad).toBe(1);
  });
});
