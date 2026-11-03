import {beforeEach,it,expect,vi} from 'vitest';
import express from 'express';
import request from 'supertest';
const db=vi.hoisted(()=>({query:vi.fn()}));
vi.mock('../../db.js',()=>({default:db}));
vi.mock('../../alerting.js',()=>({raise:vi.fn()}));
import router from '../tasks.js';
const app=express();app.use(express.json());app.use('/api/brain',router);
const url='/api/brain/tasks/11111111-1111-4111-8111-111111111111/feedback';
beforeEach(()=>{vi.clearAllMocks();});
it.each([{}, {status:'completed'}])('feedback缺summary返回400且零查询：%j',async body=>{
 const r=await request(app).post(url).send(body);expect(r.status).toBe(400);expect(r.body).toEqual({success:false,error:'Missing required fields',code:'MISSING_FIELD',required:['summary']});expect(db.query).not.toHaveBeenCalled();
});
it('非法反馈状态400且零查询',async()=>{
 const r=await request(app).post(url).send({summary:'结果',status:'queued'});expect(r.status).toBe(400);expect(r.body).toEqual({success:false,error:'Invalid status value',code:'INVALID_STATUS',allowed:['completed','failed']});expect(db.query).not.toHaveBeenCalled();
});
it('不存在任务404不写反馈',async()=>{
 db.query.mockResolvedValue({rows:[]});const r=await request(app).post(url).send({summary:'结果'});expect(r.status).toBe(404);expect(r.body).toEqual({success:false,error:'Task not found',code:'TASK_NOT_FOUND'});expect(db.query).toHaveBeenCalledOnce();expect(db.query.mock.calls[0][1]).toEqual(['11111111-1111-4111-8111-111111111111']);
});
it('queued任务拒绝400不写反馈',async()=>{
 db.query.mockResolvedValue({rows:[{id:'t',status:'queued'}]});const r=await request(app).post(url).send({summary:'结果'});expect(r.status).toBe(400);expect(r.body.code).toBe('INVALID_TASK_STATUS');expect(r.body.current_status).toBe('queued');expect(db.query).toHaveBeenCalledOnce();
});
it.each([false,true])('flat/wrapped反馈真实写入同task与默认completed，并回读身份（wrapped=%s）',async wrapped=>{
 db.query.mockResolvedValueOnce({rows:[{id:'11111111-1111-4111-8111-111111111111',status:'in_progress',goal_id:null}]}).mockResolvedValueOnce({rowCount:1,rows:[]});
 const body={summary:'实际结果',metrics:{duration_seconds:5},artifacts:{path:'report.json'}};
 const r=await request(app).post(url).send(wrapped?{feedback:body}:body);expect(r.status).toBe(200);expect(r.body).toEqual({success:true,task_id:'11111111-1111-4111-8111-111111111111',feedback_id:expect.stringMatching(/^[a-f0-9-]{36}$/),received_at:expect.any(String),suggestions_created:0});
 const [sql,args]=db.query.mock.calls[1];expect(sql).toMatch(/feedback_count = feedback_count \+ 1/);expect(args[1]).toBe('11111111-1111-4111-8111-111111111111');
 expect(JSON.parse(args[0])).toEqual([{id:r.body.feedback_id,status:'completed',summary:'实际结果',metrics:{duration_seconds:5},artifacts:{path:'report.json'},received_at:r.body.received_at}]);
});
it('数据库失败500不能误报接收成功',async()=>{
 db.query.mockRejectedValue(Error('fixture_db_down'));const r=await request(app).post(url).send({summary:'结果'});expect(r.status).toBe(500);expect(r.body).toEqual({success:false,error:'Failed to store feedback',code:'DATABASE_ERROR',details:'fixture_db_down'});
});
