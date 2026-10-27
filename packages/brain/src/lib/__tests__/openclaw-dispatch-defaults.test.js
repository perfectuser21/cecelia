import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { DISPATCH_DEFAULTS } from '../openclaw-dispatch-defaults.js';

// 固定值来自迁移前 US 两份模板去除顶层凭据后的独立快照，不由待测模块生成。
const ORIGINAL_HASHES = {
  'jinoshengyuan-daily.json': 'beb946b60ea4318afc36d52ab5dc0374bec7ff2b37f5487d07ebf37987927088',
  'yueshengyun-daily.json': '01c4de541dc5c8dc56d3e766920556051ab6e4853e900858ccfe1fc41f65dc5f',
};
describe('派发默认参数的历史迁移边界', () => {
  it.each(Object.entries(ORIGINAL_HASHES))('%s 保留全部非凭据业务参数', (file, expected) => {
    expect(createHash('sha256').update(JSON.stringify(DISPATCH_DEFAULTS[file])).digest('hex')).toBe(expected);
  });
  it('只登记两个已有模板，整棵对象不保存 control_token', () => {
    expect(Object.keys(DISPATCH_DEFAULTS).sort()).toEqual(Object.keys(ORIGINAL_HASHES).sort());
    const inspect = value => {
      if (!value || typeof value !== 'object') return;
      expect(Object.keys(value)).not.toContain('control_token');
      Object.values(value).forEach(inspect);
    };
    inspect(DISPATCH_DEFAULTS);
  });
});
