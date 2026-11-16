// 只决定PR是否申请真实预览；核心CI始终完整执行，不使用此差异裁剪。
import {execFileSync} from 'node:child_process';
import {appendFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export function previewUi({base,head,event,action,cwd=process.cwd()}) {
  if(event!=='pull_request'||!['opened','synchronize','reopened'].includes(action))
    throw new Error('预览只接受仍开放的PR事件');
  if(![base,head].every(value=>typeof value==='string'&&/^[a-f0-9]{40}$/.test(value)))
    throw new Error('预览必须指定固定BASE/HEAD SHA');
  const raw=execFileSync('git',['--no-replace-objects','diff','--no-ext-diff','--no-textconv',
    '--name-only','--no-renames','-z',base,head,'--'],
    {cwd,encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:16*1024*1024});
  if(raw&&!raw.endsWith('\0'))throw new Error('预览Git差异不完整');
  return (raw?raw.slice(0,-1).split('\0'):[])
    .some(path=>path.startsWith('apps/dashboard/')||path.startsWith('apps/api/features/'));
}

export function main(args=process.argv.slice(2),env=process.env) {
  if(args.length!==4||args[0]!=='--base'||args[2]!=='--head')
    throw new Error('用法：preview-ui.mjs --base SHA --head SHA');
  const result=previewUi({base:args[1],head:args[3],event:env.EVENT_NAME,action:env.EVENT_ACTION});
  if(env.GITHUB_OUTPUT)appendFileSync(env.GITHUB_OUTPUT,`preview_ui=${result}\n`);
  process.stdout.write(`${result}\n`);
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {main();} catch(error) {process.stderr.write(`${error.message}\n`);process.exitCode=1;}
}
