import { it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import { openFailureProbe } from '../commander-failure-reader.js';
it('真实子进程协议：输入只走stdin，recheck后锁会话保活至commit ACK',async()=>{
 let args;
 const shim=(command,actual,options)=>{args=actual;return spawn(process.execPath,['-e',`
 const rl=require('readline').createInterface({input:process.stdin});let n=0;
 rl.on('line',line=>{if(n++===0)console.log(JSON.stringify({packet:JSON.parse(line)}));else if(line==='validate')console.log(JSON.stringify({rechecked:true}));else if(line==='committed'||line==='abort'){rl.close();process.exit(0)}});
 `],options);};
 const packet={mode:'worker',input:'$(touch /tmp/no-side-effect) 中文'};
 const session=await openFailureProbe('fixture',packet,shim);
 expect(args.join(' ')).not.toContain(packet.input);expect(args.at(-1)).toContain('python3 -I -u');
 expect(session.observation.packet).toEqual(packet);expect(await session.recheck()).toEqual({rechecked:true});
 session.assertAlive();await session.release(true);
 expect(()=>session.assertAlive()).toThrow();
});
it('丢失/坏响应拒绝并关闭，不把通信成功当证据',async()=>{
 const shim=(_c,_a,options)=>spawn(process.execPath,['-e',`process.stdout.write('not-json\\n');process.stdin.resume();`],options);
 await expect(openFailureProbe('fixture',{mode:'worker'},shim)).rejects.toThrow('failure_probe_failed');
});
it('设备只经固定MMV relay，拒绝caller注入target/relay',async()=>{
 await expect(openFailureProbe('host; touch /tmp/nope',{},()=>{})).rejects.toThrow();
 await expect(openFailureProbe('xian-m4',{},()=>{},'host;echo bad')).rejects.toThrow();
 let args;const shim=(_c,a,options)=>{args=a;return spawn(process.execPath,['-e',`process.stdout.write('{}\\n');process.stdin.once('data',()=>process.exit(0));`],options);};
 const s=await openFailureProbe('xian-m4',{},shim,'administrator@100.1.2.3');
 expect(args.at(-2)).toBe('administrator@100.1.2.3');expect(args.at(-1)).toContain("'xian-m4'");await s.release(false);
});
