import {EventEmitter} from 'node:events';
import {PassThrough,Writable} from 'node:stream';
import {expect,test} from 'vitest';
import {nativeAgentTransport} from '../native-agent-transport.js';
test('真实字节流在汉字中间分片时完整还原原生回执，不能把中文结果写成替换字符',async()=>{
 const expected={summary:'中文完整回执',result:{final_text:'核对完成：完整输出保留。'}};
 const spawnFn=()=>{
  const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>{};
  child.stdin=new Writable({write(_chunk,_encoding,done){done();}});
  child.stdin.once('finish',()=>{
   const bytes=Buffer.from(JSON.stringify(expected)),cut=bytes.indexOf(Buffer.from('中'))+1;
   child.stdout.write(bytes.subarray(0,cut));child.stdout.write(bytes.subarray(cut));child.emit('close',0);
  });return child;
 };
 const value=await nativeAgentTransport({machine_id:'us-mac-m4',cli_path:'/owned/cli.mjs',config_path:'/owned/config.json',bundle_sha256:'a'.repeat(64)},{action:'inspect'},{spawnFn});
 expect(value).toEqual(expected);
});
