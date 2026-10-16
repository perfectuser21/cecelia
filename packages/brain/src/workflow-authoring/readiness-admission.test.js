import {it,expect,vi} from 'vitest';
import {readinessAdmission} from './readiness-admission.js';
it('一次多slot准入复用同固定字节与即时runtime，跨轮重新探测',async()=>{
 const readFile=vi.fn(async()=> 'skill'),probeRuntime=vi.fn(async()=>({ready:true}));
 const source={repo:'r',path:'SKILL.md',revision:'a'.repeat(40)};
 const first=readinessAdmission({readFile,probeRuntime,deadline:Date.now()+1000});
 await Promise.all([first.readFile(source),first.readFile({...source}),first.probeRuntime(),first.probeRuntime()]);
 expect(readFile).toHaveBeenCalledTimes(1);expect(probeRuntime).toHaveBeenCalledTimes(1);
 const second=readinessAdmission({readFile,probeRuntime});await second.readFile(source);await second.probeRuntime();
 expect(readFile).toHaveBeenCalledTimes(2);expect(probeRuntime).toHaveBeenCalledTimes(2);
});
it('实际读取携带取消与预算并保持整轮字节上限',async()=>{
 const readFile=vi.fn(async()=> 'x'.repeat(512*1024+1));const controller=new AbortController();
 const options=readinessAdmission({readFile,deadline:Date.now()+1000,signal:controller.signal});
 await expect(options.readFile({repo:'r',path:'p',revision:'a'})).rejects.toThrow('readiness_source_limit');
 expect(readFile.mock.calls[0][1]).toMatchObject({signal:expect.any(AbortSignal),deadline:expect.any(Number)});
});
