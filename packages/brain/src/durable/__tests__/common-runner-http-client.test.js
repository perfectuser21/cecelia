import {test,expect} from 'vitest';
import http from 'node:http';
import {createBrainCommonRunnerClient} from '../common-runner-http-client.js';
const id='12345678-1234-4234-8234-123456789abc';
test('真实HTTP客户端沿原run转发，身份令牌只在header，不重试启动',async()=>{
 const calls=[];const server=http.createServer(async(req,res)=>{let body='';for await(const c of req)body+=c;calls.push({path:req.url,token:req.headers['x-internal-token'],body:JSON.parse(body)});res.setHeader('content-type','application/json');res.end(JSON.stringify({authenticated:true,receipt:{run_id:id,status:'running'}}));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{const c=createBrainCommonRunnerClient({brainUrl:`http://127.0.0.1:${server.address().port}`,credential:()=> 'fixture-private-token',allowLoopbackForTests:true});
 expect((await c.dispatch('start',id,{task_id:id,profile:'fixed',mode:'formal',input:{}})).authenticated).toBe(true);
 expect(calls).toHaveLength(1);expect(calls[0].path).toBe(`/api/brain/common-runner/${id}/start`);expect(calls[0].token).toBe('fixture-private-token');expect(JSON.stringify(calls[0].body)).not.toContain('token');
 }finally{await new Promise(r=>server.close(r));}
});
test('非法地址、身份、命令和网络结果未知均不转成成功或重发',async()=>{
 expect(()=>createBrainCommonRunnerClient({brainUrl:'https://attacker.example',credential:()=> 'secret'})).toThrow();
 let calls=0;const c=createBrainCommonRunnerClient({brainUrl:'http://localhost:5221',credential:()=> 'secret',fetchFn:async()=>{calls++;throw Error('secret');}});
 await expect(c.dispatch('execute',id,{})).rejects.toThrow();expect(calls).toBe(0);
 await expect(c.dispatch('start',id,{task_id:id})).rejects.toThrow('common_runner_brain_transport_unknown');expect(calls).toBe(1);
});
