/**
 * script-task-spec.test.js —— executor=script 的 payload 契约与安全闸（链 bf5088a3 棒3，任务 5cdbd52a）。
 * 每条硬约束都有「违规输入被拒」的红测试；被拒必须是 code=script_payload_invalid + 可读原因。
 */
import { describe, it, expect } from 'vitest';
import {
  SCRIPT_LIMITS,
  validateScriptPayload,
  assertScriptPayloadForType,
  isScriptPayloadError,
} from '../script-task-spec.js';

const ok = (over = {}) => ({ host: 'xian-m4', cmd: 'echo hello', timeout_sec: 60, ...over });

function rejects(payload, reasonPattern) {
  let err;
  try { validateScriptPayload(payload); } catch (e) { err = e; }
  expect(err, `应被拒绝：${JSON.stringify(payload).slice(0, 120)}`).toBeTruthy();
  expect(err.code).toBe('script_payload_invalid');
  expect(isScriptPayloadError(err)).toBe(true);
  expect(err.message).toMatch(reasonPattern);
  return err;
}

describe('合法输入', () => {
  it('最小合法 payload：host 别名解析为注册表机器 id，默认值补齐', () => {
    const v = validateScriptPayload(ok());
    expect(v.host).toBe('xian-mac-m4');
    expect(v.cmd).toBe('echo hello');
    expect(v.cwd).toBeNull();
    expect(v.env).toEqual({});
    expect(v.timeout_sec).toBe(60);
    expect(v.artifact_paths).toEqual([]);
  });

  it('完整 payload：cwd / 白名单 env / artifact_paths 原样通过', () => {
    const v = validateScriptPayload(ok({
      host: 'mmv', cwd: '/Users/administrator/work', timeout_sec: SCRIPT_LIMITS.MAX_TIMEOUT_SEC,
      env: { SCRIPT_TOKEN: 'abc123', TZ: 'Asia/Shanghai' },
      artifact_paths: ['/tmp/out.json'],
    }));
    expect(v.env).toEqual({ SCRIPT_TOKEN: 'abc123', TZ: 'Asia/Shanghai' });
    expect(v.timeout_sec).toBe(3600);
    expect(v.artifact_paths).toEqual(['/tmp/out.json']);
  });

  it('非脚本任务类型直通（assertScriptPayloadForType 只管 script_run）', () => {
    expect(() => assertScriptPayloadForType('dev', {})).not.toThrow();
    expect(() => assertScriptPayloadForType('script_run', ok())).not.toThrow();
    expect(() => assertScriptPayloadForType('script_run', {})).toThrow(/host/);
  });
});

describe('硬约束 1：us-vps 零执行——host 只认跑场机', () => {
  it.each([
    ['us-vps', /调度器|scheduler|零执行/],
    ['US-VPS', /调度器|scheduler|零执行/],
    ['localhost', /本机|回环|loopback/],
    ['127.0.0.1', /本机|回环|loopback/],
    ['::1', /本机|回环|loopback/],
    ['0.0.0.0', /本机|回环|loopback/],
  ])('拒绝 %s', (host, re) => {
    rejects(ok({ host }), re);
  });

  it.each(['hk-vps', 'xian-pc', 'nas', 'no-such-box', '100.71.151.105', 'root@100.71.151.105'])(
    '拒绝非跑场机/未注册/裸地址 %s',
    (host) => { rejects(ok({ host }), /跑场机|注册|registry/); },
  );

  it.each([undefined, null, '', '   ', 123, {}])('拒绝空/非字符串 host：%j', (host) => {
    rejects(ok({ host }), /host/);
  });

  it('拒绝 host 里的控制字符/换行/空白注入', () => {
    rejects(ok({ host: 'xian-m4\nrm -rf /' }), /host/);
    rejects(ok({ host: 'xian-m4 ; id' }), /host/);
  });
});

describe('硬约束 2：命令执行面', () => {
  it.each([undefined, null, '', '   ', 42])('拒绝空/非字符串 cmd：%j', (cmd) => {
    rejects(ok({ cmd }), /cmd/);
  });

  it('拒绝 cmd 里的换行/回车/NUL/其他控制字符（换行注入）', () => {
    rejects(ok({ cmd: 'echo a\nrm -rf /' }), /控制字符|换行/);
    rejects(ok({ cmd: 'echo a\r\nid' }), /控制字符|换行/);
    rejects(ok({ cmd: 'echo a\u0000b' }), /控制字符|换行/);
    rejects(ok({ cmd: 'echo \u001b[31m' }), /控制字符|换行/);
  });

  it('cmd 允许 Tab 与引号/美元符（它们是命令内容，不是传输通道，经 base64 传输）', () => {
    expect(() => validateScriptPayload(ok({ cmd: "echo 'a\tb' \"$HOME\" `date`" }))).not.toThrow();
  });

  it('拒绝超长 cmd', () => {
    rejects(ok({ cmd: 'x'.repeat(SCRIPT_LIMITS.MAX_CMD_BYTES + 1) }), /cmd.*(过长|超过)/);
  });

  it('cwd：拒绝控制字符与相对路径；~/ 与绝对路径可', () => {
    rejects(ok({ cwd: '/tmp\nid' }), /cwd/);
    rejects(ok({ cwd: 'relative/dir' }), /cwd.*绝对/);
    expect(() => validateScriptPayload(ok({ cwd: '~/work' }))).not.toThrow();
    expect(() => validateScriptPayload(ok({ cwd: '/opt/x y' }))).not.toThrow();
  });

  it('env：键必须在白名单，PATH/LD_PRELOAD/BASH_ENV 等危险键拒绝，报错点名键但不含值', () => {
    for (const key of ['PATH', 'LD_PRELOAD', 'DYLD_INSERT_LIBRARIES', 'BASH_ENV', 'IFS', 'HOME', 'lowercase', 'FOO']) {
      const err = rejects(ok({ env: { [key]: 'SUPERSECRETVALUE' } }), /env.*(键|key)/);
      expect(err.message).not.toContain('SUPERSECRETVALUE');
    }
  });

  it('env：值必须是不含控制字符的字符串，且有数量/长度上限', () => {
    rejects(ok({ env: { SCRIPT_A: 'line1\nline2' } }), /env.*控制字符/);
    rejects(ok({ env: { SCRIPT_A: 12 } }), /env.*字符串/);
    rejects(ok({ env: { SCRIPT_A: 'x'.repeat(SCRIPT_LIMITS.MAX_ENV_VALUE_BYTES + 1) } }), /env.*(过长|超过)/);
    const many = Object.fromEntries(Array.from({ length: SCRIPT_LIMITS.MAX_ENV_KEYS + 1 }, (_, i) => [`SCRIPT_K${i}`, 'v']));
    rejects(ok({ env: many }), /env.*(过多|超过)/);
    rejects(ok({ env: ['SCRIPT_A=1'] }), /env.*对象/);
  });

  it('timeout_sec：必填，必须是 1..3600 的整数', () => {
    rejects(ok({ timeout_sec: undefined }), /timeout_sec.*必填/);
    rejects(ok({ timeout_sec: 0 }), /timeout_sec/);
    rejects(ok({ timeout_sec: -5 }), /timeout_sec/);
    rejects(ok({ timeout_sec: 3601 }), /timeout_sec.*3600/);
    rejects(ok({ timeout_sec: 1.5 }), /timeout_sec.*整数/);
    rejects(ok({ timeout_sec: '60' }), /timeout_sec.*整数/);
    rejects(ok({ timeout_sec: Infinity }), /timeout_sec/);
  });

  it('artifact_paths：数组、条数上限、无控制字符', () => {
    rejects(ok({ artifact_paths: 'x' }), /artifact_paths.*数组/);
    rejects(ok({ artifact_paths: ['/a\nb'] }), /artifact_paths.*控制字符/);
    rejects(ok({ artifact_paths: Array.from({ length: SCRIPT_LIMITS.MAX_ARTIFACTS + 1 }, (_, i) => `/tmp/${i}`) }), /artifact_paths.*(过多|超过)/);
  });

  it('payload 本身不是对象也拒绝', () => {
    rejects(null, /payload/);
    rejects('echo hi', /payload/);
  });
});
