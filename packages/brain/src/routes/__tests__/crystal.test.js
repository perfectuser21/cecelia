import {beforeEach,it,expect,vi} from 'vitest';
import express from 'express';
import request from 'supertest';
const db=vi.hoisted(()=>({query:vi.fn(),run:vi.fn()}));
vi.mock('../../db.js',()=>({default:db}));
vi.mock('../../crystal-judge.js',async original=>({...await original(),runCrystalJudge:(...args)=>db.run(...args)}));
import router from '../crystal.js';
const app=express();app.use(express.json());app.use('/crystal',router);
beforeEach(()=>{vi.clearAllMocks();});
it.each(['model','app_version','density'])('locator缺%s返回400且零写',async missing=>{
 const body={model:'phone',app_version:'1',density:'420',locator:{x:12}};delete body[missing];
 const r=await request(app).post('/crystal/locator').send(body);expect(r.status).toBe(400);expect(r.body).toEqual({error:'missing_registry_key_component'});expect(db.query).not.toHaveBeenCalled();
});
it('locator完整复合键与JSON参数写入，成功200回读同键',async()=>{
 db.query.mockResolvedValue({rows:[]});const r=await request(app).post('/crystal/locator').send({model:'phone',app_version:'1',density:420,locator:{x:12,y:24}});
 expect(r.status).toBe(200);expect(r.body).toEqual({ok:true,key:'phone|1|420'});expect(db.query.mock.calls[0][0]).toContain('ON CONFLICT (model, app_version, density)');expect(db.query.mock.calls[0][1]).toEqual(['phone','1',420,'{"x":12,"y":24}']);
});
it('locator数据库失败返回500',async()=>{db.query.mockRejectedValue(Error('write_down'));const r=await request(app).post('/crystal/locator').send({model:'p',app_version:'1',density:420});expect(r.status).toBe(500);expect(r.body).toEqual({error:'write_down'});});
it.each([{}, {filename:'og1.png'}, {filename:'og1__trial3.png'}])('不完整证据名真实HTTP拒绝400：%j',async body=>{
 const r=await request(app).post('/crystal/evidence/validate').send(body);expect(r.status).toBe(400);expect(r.body).toEqual({error:'evidence_filename_missing_trial_or_timestamp'});
});
it('证据解析与重复保护分别返回200/409，均不写库',async()=>{
 const filename='og1__trial3__20261103T010203Z.png';
 const ok=await request(app).post('/crystal/evidence/validate').send({filename});expect(ok.status).toBe(200);expect(ok.body).toEqual({ok:true,trial:3,timestamp:'20261103T010203Z'});
 const duplicate=await request(app).post('/crystal/evidence/validate').send({filename,existing:[filename]});expect(duplicate.status).toBe(409);expect(duplicate.body).toEqual({error:'evidence_filename_overwrite_forbidden'});expect(db.query).not.toHaveBeenCalled();
});
it('report指定日期传SQL并回读真实字段，Date转为日期字符串',async()=>{
 db.query.mockResolvedValue({rows:[{report_date:new Date('2026-11-03T00:00:00Z'),grid_count:8,suggestions:['inspect'],data_gaps:['missing']} ]});
 const r=await request(app).get('/crystal/report?date=2026-11-03');expect(r.status).toBe(200);expect(r.body).toEqual({ok:true,report_date:'2026-11-03',grid_count:8,suggestions:['inspect'],data_gaps:['missing']});expect(db.query.mock.calls[0][1]).toEqual(['2026-11-03']);
});
it('report无记录404，查询失败500',async()=>{
 db.query.mockResolvedValueOnce({rows:[]}).mockRejectedValueOnce(Error('read_down'));
 const missing=await request(app).get('/crystal/report');expect(missing.status).toBe(404);expect(missing.body).toEqual({error:'no_report_for_date'});
 const error=await request(app).get('/crystal/report');expect(error.status).toBe(500);expect(error.body).toEqual({error:'read_down'});
});
it('run真实路由等待判官结果返回200，判官失败500',async()=>{
 db.run.mockResolvedValueOnce({ok:true,grid_count:8,suggestions:['hold']}).mockRejectedValueOnce(Error('judge_down'));
 const ok=await request(app).post('/crystal/run').send({});expect(ok.status).toBe(200);expect(ok.body).toEqual({ok:true,grid_count:8,suggestions:['hold']});expect(db.run).toHaveBeenCalledWith(db);
 const bad=await request(app).post('/crystal/run').send({});expect(bad.status).toBe(500);expect(bad.body).toEqual({error:'judge_down'});
});
