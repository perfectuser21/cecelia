#!/usr/bin/env node
const fs=require('node:fs');
const path=require('node:path');
// 程序属于只读镜像；状态和产物属于本次私有临时目录。
const root=path.dirname(process.cwd()),stat=fs.lstatSync(root);
if(!stat.isDirectory()||stat.isSymbolicLink()||stat.uid!==process.getuid()||(stat.mode&0o077))throw Error('fixture root is not private');
let text='';process.stdin.setEncoding('utf8');
process.stdin.on('data',chunk=>text+=chunk);
process.stdin.on('end',()=>{
 fs.appendFileSync(path.join(root,'launches'),JSON.stringify({pid:process.pid,text,argv:process.argv.slice(2)})+'\n');
 if(text.includes('NATIVE_HANG')){setInterval(()=>{},1000);return;}
 const output=process.argv.indexOf('--output-last-message');
 if(output>=0)fs.writeFileSync(process.argv[output+1],'实际fixture执行结果：完整输入已处理');
 process.stdout.write(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'实际fixture执行结果：完整输入已处理'}})+'\n');
 if(text.includes('NATIVE_FAIL'))process.exitCode=7;
});
