import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, chmodSync, symlinkSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { readDispatchTemplate } from '../openclaw-dispatch-template.js';
const dirs = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'dispatch-secret-')); dirs.push(dir);
  const secretPath = join(dir, 'tokens.json');
  writeFileSync(secretPath, JSON.stringify({ jinoshengyuan: 'test-jin', yueshengyun: 'test-yue' }), { mode: 0o600 });
  return { dir, secretPath };
}
describe('迁出旧dispatch目录', () => {
  it('两租户原参数固定，凭据按tenant注入且对象不互相污染', () => {
    const { secretPath } = fixture();
    const jin = readDispatchTemplate(null, 'jinoshengyuan-daily.json', { secretPath });
    const yue = readDispatchTemplate(null, 'yueshengyun-daily.json', { secretPath });
    expect(jin.control_token).toBe('test-jin'); expect(yue.control_token).toBe('test-yue');
    delete jin.control_token; delete yue.control_token;
    const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
    expect(hash(jin)).toBe('beb946b60ea4318afc36d52ab5dc0374bec7ff2b37f5487d07ebf37987927088');
    expect(hash(yue)).toBe('01c4de541dc5c8dc56d3e766920556051ab6e4853e900858ccfe1fc41f65dc5f');
    jin.task_request.keywords.push('changed');
    expect(readDispatchTemplate(null, 'jinoshengyuan-daily.json', { secretPath }).task_request.keywords).not.toContain('changed');
  });
  it('缺凭据、宽权限、符号链接缓存均明确拒绝，不回旧模板token', () => {
    const { dir, secretPath } = fixture();
    chmodSync(secretPath, 0o644);
    expect(() => readDispatchTemplate(null, 'yueshengyun-daily.json', { secretPath })).toThrow('dispatch_credentials_unavailable');
    chmodSync(secretPath, 0o600);
    const link = join(dir, 'link'); symlinkSync(secretPath, link);
    expect(() => readDispatchTemplate(null, 'yueshengyun-daily.json', { secretPath: link })).toThrow('dispatch_credentials_unavailable');
    writeFileSync(secretPath, '{"jinoshengyuan":"test-jin"}');
    expect(() => readDispatchTemplate(null, 'yueshengyun-daily.json', { secretPath })).toThrow('dispatch_credentials_unavailable');
  });
  it('外部扩展仍可用，内嵌token或跨租户声明拒绝', () => {
    const { dir, secretPath } = fixture();
    writeFileSync(join(dir, 'custom.json'), '{"tenant_id":"yueshengyun","task_request":{"tenant_id":"yueshengyun"}}');
    expect(readDispatchTemplate(dir, 'custom.json', { secretPath }).control_token).toBe('test-yue');
    writeFileSync(join(dir, 'custom.json'), '{"tenant_id":"yueshengyun","control_token":"old-secret"}');
    expect(() => readDispatchTemplate(dir, 'custom.json', { secretPath })).toThrow('dispatch_template_invalid');
    writeFileSync(join(dir, 'custom.json'), '{"tenant_id":"yueshengyun","task_request":{"tenant_id":"jinoshengyuan"}}');
    expect(() => readDispatchTemplate(dir, 'custom.json', { secretPath })).toThrow('dispatch_template_invalid');
  });
  it('未知模板、路径逃逸和模板符号链接均拒绝', () => {
    const { dir, secretPath } = fixture();
    for (const file of ['../tokens.json', '/tokens.json', 'absent.json']) {
      expect(() => readDispatchTemplate(dir, file, { secretPath })).toThrow('dispatch_template_invalid');
    }
    symlinkSync(secretPath, join(dir, 'secret.json'));
    expect(() => readDispatchTemplate(dir, 'secret.json', { secretPath })).toThrow('dispatch_template_invalid');
    expect(() => readDispatchTemplate(null, 'unknown.json', { secretPath })).toThrow('dispatch_template_invalid');
  });
  it('现役Notion模块消费新loader且不再默认旧目录，US配置移除dispatch挂载', () => {
    const code = readFileSync(new URL('../../notion-push-sync.js', import.meta.url), 'utf8');
    expect(code).toContain("from './lib/openclaw-dispatch-template.js'");
    expect(code).not.toContain("|| '/opt/openclaw/dispatch'");
    const compose = readFileSync(new URL('../../../../../docker-compose.us-vps.yml', import.meta.url), 'utf8');
    expect(compose).not.toContain('/opt/openclaw/dispatch:/opt/openclaw/dispatch');
  });
});
