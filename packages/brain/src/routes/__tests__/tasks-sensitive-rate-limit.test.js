import { expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createServer } from 'node:http';
import { getReviewEffects } from './helpers/tasks-review-effects.js';
import taskRouter from '../tasks.js';
const effects=getReviewEffects();
const id='21a4435b-0b50-4d68-a20f-512a0344f744';
const cases=[
 ['get',`/tasks/${id}/logs`,{},200,[{id,title:'owned',metadata:{}}]],
 ['get',`/tasks/${id}/checkpoints`,{},200,[{id,title:'owned',status:'queued',metadata:{}}]],
 ['get',`/tasks/${id}/ci-diagnosis`,{},200,[{ci_diagnosis:'{"category":"synthetic"}'}]],
 ['post',`/tasks/${id}/dispatch`,{},404],
 ['post',`/tasks/${id}/request-intent-expand`,{},404],
 ['get','/tasks/blocked',{},200],
 ['post','/route-task',{task_id:id},404],
 ['get','/reflections',{},200],
 ['post','/reflections',{type:'issue',title:'synthetic quota test',content:'owned'},200,[{id,type:'issue',title:'synthetic quota test'}]],
];
function limited(response){
 expect(response.status).toBe(429);expect(response.headers['ratelimit-policy']).toBe('300;w=60');
 expect(response.headers.ratelimit).toMatch(/limit=300/);expect(Number(response.headers['retry-after'])).toBeGreaterThan(0);
}
it.each(cases)('%s %s limits before downstream effects, separates real peer IPs and ignores forged forwarding',async(method,path,body,status,rows=[])=>{
 effects.query.mockResolvedValue({rows});
 const app=express(),seen=new Set();app.set('trust proxy',false);app.use(express.json());
 app.use((req,_res,next)=>{seen.add(req.socket.remoteAddress);next();});app.use('/api/brain',taskRouter);
 const servers=[createServer(app),createServer(app)];
 try{
   await Promise.all(servers.map((server,i)=>new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,i?'::1':'127.0.0.1',resolve);})));
   const v4=request(`http://127.0.0.1:${servers[0].address().port}`),v6=request(`http://[::1]:${servers[1].address().port}`);
   for(let i=0;i<300;i++)expect((await v4[method]('/api/brain'+path).send(body)).status,`admitted request ${i+1}`).toBe(status);
   expect(effects.query).toHaveBeenCalledTimes(300);
   limited(await v4[method]('/api/brain'+path).send(body));expect(effects.query).toHaveBeenCalledTimes(300);
   limited(await v4[method]('/api/brain'+path).set('X-Forwarded-For','198.51.100.23').send(body));expect(effects.query).toHaveBeenCalledTimes(300);
   expect((await v6[method]('/api/brain'+path).send(body)).status).toBe(status);expect(effects.query).toHaveBeenCalledTimes(301);
   limited(await v4[method]('/api/brain'+path).send(body));expect(effects.query).toHaveBeenCalledTimes(301);
   const unaffected=await v4.get('/api/brain/task-locations');expect(unaffected.status).toBe(200);expect(unaffected.headers.ratelimit).toBeUndefined();
   expect(effects.query).toHaveBeenCalledTimes(301);expect([...seen].sort()).toEqual(['127.0.0.1','::1'].sort());
 }finally{await Promise.all(servers.map(server=>new Promise(resolve=>server.close(()=>resolve()))));}
});
