import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';

const verifier = 'sprints/coding-harness-20260831052812-3dmx7y/tests/verify-attempt-run-guide.mjs';

function verify(target: string) {
  return execFileSync(process.execPath, [verifier, target], { encoding: 'utf8' });
}

describe('attempt-run 桥接使用说明 [BEHAVIOR]', () => {
  it('端点用途节串联同一 attempt-run', () => {
    expect(verify('endpoints')).toContain('PASS endpoints');
  });

  it('鉴权方式节要求远端 Bearer', () => {
    expect(verify('auth')).toContain('PASS auth');
  });

  it('角色与 payload 节匹配九角色精确集合', () => {
    expect(verify('roles-payload')).toContain('PASS roles-payload');
  });

  it('失败回滚节包含三个终态', () => {
    expect(verify('rollback')).toContain('PASS rollback');
  });
});

