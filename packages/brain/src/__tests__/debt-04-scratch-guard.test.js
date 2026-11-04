import { describe, it, expect } from 'vitest';
import { assertScratchConfig, assertScratchIdentity } from './helpers/debt-04-scratch.js';

const safe = { DB_HOST: '127.0.0.1', DB_PORT: '56404', DB_NAME: 'cecelia_scratch' };
describe('第04路私有数据库边界', () => {
  it('要求显式本地scratch地址，不接受缺失、远程、生产或连接串覆盖', () => {
    expect(() => assertScratchConfig(safe)).not.toThrow();
    for (const env of [{}, {...safe,DB_NAME:'cecelia'}, {...safe,DB_HOST:'remote.invalid'}, {...safe,DB_PORT:''}, {...safe,TEST_DATABASE_URL:'postgres://remote.invalid/cecelia_scratch'}]) {
      expect(() => assertScratchConfig(env)).toThrow();
    }
  });
  it('核验真实服务端身份，拒绝错库、错地址和错端口', async () => {
    const row = { database: 'cecelia_scratch', address: '127.0.0.1', port: 56404 };
    await expect(assertScratchIdentity({query:async()=>({rows:[row]})},safe)).resolves.toBeUndefined();
    for (const bad of [{...row,database:'cecelia'}, {...row,address:'100.79.41.61'}, {...row,port:5432}]) {
      await expect(assertScratchIdentity({query:async()=>({rows:[bad]})},safe)).rejects.toThrow();
    }
  });
});
