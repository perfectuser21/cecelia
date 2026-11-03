import {beforeEach,it,expect,vi} from 'vitest';
import express from 'express';
import request from 'supertest';
const db=vi.hoisted(()=>({query:vi.fn(),end:vi.fn()}));
vi.mock('pg',()=>({Pool:class {query(...args){return db.query(...args);}end(){return db.end();}}}));
import createHandler from '../decisions.js';
const app=express();app.use(express.json());app.post('/match',createHandler());
beforeEach(()=>{vi.clearAllMocks();db.query.mockResolvedValue({rows:[{id:'decision-1',topic:'数据库选型',decision:'使用PostgreSQL'}]});});
it.each(['prd','query'])('%s经真实HTTP保留主题并返回真实决策，恒空结果不能通过',async key=>{
 const r=await request(app).post('/match').send({[key]:'## 数据库选型\n需要存储'});
 expect(r.status).toBe(200);expect(r.body).toEqual({matched:[{topic:'数据库选型',decision:'使用PostgreSQL',decision_topic:'数据库选型',confidence:1,source_id:'decision-1'}],missing:[]});
 expect(db.query).toHaveBeenCalledWith("SELECT id, topic, decision FROM decisions WHERE status = 'active' LIMIT 500");expect(db.end).toHaveBeenCalledOnce();
});
it('显式topics保持原样，缺失主题不能伪造命中',async()=>{
 const r=await request(app).post('/match').send({prd:'优先输入',query:'备用输入',topics:['数据库选型','陌生主题']});
 expect(r.status).toBe(200);expect(r.body.matched[0].source_id).toBe('decision-1');expect(r.body.missing).toEqual([{topic:'陌生主题',classification:'routine'}]);
});
it.each([{},null])('缺输入返回400且零查询：%j',async body=>{
 const r=await request(app).post('/match').send(body);expect(r.status).toBe(400);expect(r.body).toEqual({error:'prd or query field required'});expect(db.query).not.toHaveBeenCalled();
});
