import express from 'express';
import request from 'supertest';
import { describe,it,expect,vi,afterEach } from 'vitest';
const api=await import('../directory-projection.js').catch(()=>({}));
afterEach(()=>vi.unstubAllEnvs());
describe('目录正式API',()=>{
  it('导出受保护路由工厂',()=>expect(api.createDirectoryProjectionRouter).toBeTypeOf('function'));
  it('无token的远端请求不会到达配置service',async()=>{
    vi.stubEnv('CECELIA_INTERNAL_TOKEN','expected');
    const configure=vi.fn(),app=express();app.use(express.json());
    app.use(api.createDirectoryProjectionRouter({pool:{},services:{configure}}));
    const response=await request(app).post('/configure').send({});
    expect(response.status).toBe(401);expect(configure).not.toHaveBeenCalled();
  });
  it('运行请求拒绝任意URL/token/SQL，不向service透传body',async()=>{
    vi.stubEnv('CECELIA_INTERNAL_TOKEN','expected');
    const run=vi.fn(),app=express();app.use(express.json());
    app.use(api.createDirectoryProjectionRouter({pool:{},services:{run}}));
    const response=await request(app).post('/run').set('X-Internal-Token','expected').send({url:'https://evil'});
    expect(response.status).toBe(400);expect(run).not.toHaveBeenCalled();
  });
});
