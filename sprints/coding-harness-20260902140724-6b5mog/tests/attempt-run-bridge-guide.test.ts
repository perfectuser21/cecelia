import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';

const TASK_REQUEST_HASH = '83916a00537fa91361e9226d897605f62da559f9c65f04cdac3badec865baf81';
const IMPLEMENTATION_BASELINE = 'd32b864de5adf8d3083c91f31ed3f5f7f58be985';
const oracle = 'sprints/coding-harness-20260902140724-6b5mog/tests/attempt-run-bridge-guide.oracle.cjs';

function run(name: string) {
  return execFileSync(process.execPath, [oracle, name], { encoding: 'utf8' });
}

describe(`attempt-run 桥接说明 [BEHAVIOR] ${TASK_REQUEST_HASH.slice(0, 8)} ${IMPLEMENTATION_BASELINE.slice(0, 8)}`, () => {
  it('两个端点与鉴权规则正负 oracle 配对', () => expect(run('endpoints-auth')).toContain('OK endpoints-auth'));
  it('角色白名单恰好九项且排除非白名单角色', () => expect(run('roles')).toContain('OK roles'));
  it('payload 必填与 base_sha 可选正负 oracle 配对', () => expect(run('payload')).toContain('OK payload'));
  it('派发失败回滚三对象终态完整', () => expect(run('rollback')).toContain('OK rollback'));
});
