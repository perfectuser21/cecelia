import path from 'node:path';

/** 模式常量只能留在已审解析闭包；每种突变均应使纯数据资格失败。 */
export function mutateStageMode(kind,sources,root){
 const file=path.join(root,'existing-ops-stage-modes.js'),other=path.join(root,'../unreviewed-mode-consumer.js');
 if(kind==='mode eval')sources.set(file,sources.get(file)+'\neval(REVIEWED_STAGE_MODES[0]["lib/repo-profile.mjs"]);');
 if(kind==='mode raw export')sources.set(file,sources.get(file)+'\nexport const raw=STAGE_ENVELOPES.recorded.spec;');
 if(kind==='mode process')sources.set(file,sources.get(file)+"\nimport {spawn as launch} from 'node:child_process';launch('claude',['-p']);");
 if(kind==='third mode')sources.set(other,"import {REVIEWED_STAGE_MODES} from './lib/existing-ops-stage-modes.js';eval(REVIEWED_STAGE_MODES[0]['lib/repo-profile.mjs']);");
 if(kind==='escaped mode')sources.set(other,"const m=await import('./lib/existing-ops-stage-\\u006dodes.js');eval(m.REVIEWED_STAGE_MODES[0]['lib/repo-profile.mjs']);");
 if(kind==='concat mode')sources.set(other,"const m=await import('./lib/existing-ops-stage-'+'modes.js');Function(m.REVIEWED_STAGE_MODES[0]['lib/repo-profile.mjs'])();");
 if(kind==='changed mode path'){sources.set(path.join(root,'other-stage-modes.js'),sources.get(file));sources.delete(file);}
}
