import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';

const helper = 'sprints/coding-harness-20260831174800-fxqhpa/tests/attempt-run-bridge-doc.test-helper.cjs';
const verify = (mode: string) => execFileSync(process.execPath, [helper, mode], { encoding: 'utf8' });

describe('attempt-run 桥接使用说明 [BEHAVIOR]', () => {
  it('说明两个端点用途与鉴权方式', () => expect(verify('endpoints')).toContain('OK'));
  it('列全九项角色白名单', () => expect(verify('roles')).toContain('OK'));
  it('说明 payload 必填字段与 base_sha 省略语义', () => expect(verify('payload')).toContain('OK'));
  it('说明派发失败自动回滚状态', () => expect(verify('rollback')).toContain('OK'));
});

