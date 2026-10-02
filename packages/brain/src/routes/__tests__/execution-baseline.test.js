import {it,expect,vi} from 'vitest';
import express from 'express';import request from 'supertest';
it('既有Mac维护入口强internal鉴权，缺配置拒绝；不得用loopback代理或任意profile扩权',async()=>{
 const {createExecutionBaselineRouter}=await import('../execution-baseline.js'),token='internal-baseline-token-'.repeat(3),publish=vi.fn(async()=>({committed:true})),compensate=vi.fn(async()=>({mode:'forward_compensation'}));
 const make=env=>{const app=express();app.use(express.json());app.use('/api',createExecutionBaselineRouter({pool:{},env,store:{publish,compensate}}));return app;};
 expect((await request(make({})).post('/api/nodes/xian-mac-m4/baseline-version').send({})).status).toBe(503);
 const app=make({CECELIA_INTERNAL_TOKEN:token});expect((await request(app).post('/api/nodes/xian-mac-m4/baseline-version').send({})).status).toBe(401);expect(publish).not.toHaveBeenCalled();
 expect((await request(app).post('/api/nodes/xian-mac-m4/baseline-version').set('x-cecelia-token',token).send({expected_current_version_id:'old'})).status).toBe(200);expect(publish).toHaveBeenCalledWith('xian-mac-m4',{expected_current_version_id:'old'});
 expect((await request(app).post('/api/nodes/xian-mac-m4/baseline-version/compensate').set('x-cecelia-token',token).send({restore_version_id:'old'})).body.mode).toBe('forward_compensation');
});
it('真实store对自由profile与新Linux身份在SQL前拒绝，生产未知错误脱敏',async()=>{
 const {createExecutionBaselineRouter}=await import('../execution-baseline.js'),token='strict-internal-baseline-key-'.repeat(3),query=vi.fn();const app=express();app.use(express.json());app.use('/api',createExecutionBaselineRouter({pool:{query},env:{CECELIA_INTERNAL_TOKEN:token}}));
 const invalid=await request(app).post('/api/nodes/xian-mac-m4/baseline-version').set('x-cecelia-token',token).send({profile:{version_policy:{os:'26.6.2'}}});expect(invalid.status).toBe(400);expect(query).not.toHaveBeenCalled();
 const valid={expected_current_version_id:'11111111-1111-4111-8111-111111111111',expected_config_hash:'a'.repeat(64),expected_worker_boot_id:'22222222-2222-4222-8222-222222222222',expected_worker_config_digest:'b'.repeat(64),supported_os_floor:'26.6.2'};
 expect((await request(app).post('/api/nodes/new-linux/baseline-version').set('x-cecelia-token',token).send(valid)).body.error).toBe('execution_baseline_existing_mac_required');expect(query).not.toHaveBeenCalled();
});
