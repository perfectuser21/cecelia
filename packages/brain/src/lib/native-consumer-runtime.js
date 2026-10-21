/** 固定、受信进程的实际 collector 字节；不以部署 SHA 代替模块身份。 */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const names=['existing-ops-source.js','existing-ops-staging-source.js','existing-ops-runtime-source.js','existing-ops-build-source.js','existing-ops-build-envelopes.js','existing-ops-workspace-source.js',
 'existing-ops-provenance-envelope.js','existing-ops-provenance-core-envelope.js','existing-ops-provenance-entry-envelopes.js','existing-ops-provenance-local-envelopes.js','existing-ops-stage-source.js','existing-ops-stage-envelopes.js','existing-ops-stage-modes.js',
 'existing-ops-native-evidence-source.js','existing-ops-native-evidence-envelopes.js','workspace-ci-source-bundle.js'];
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
// 在模块加载时冻结，后续磁盘覆盖不能冒充本进程已加载新 collector。
const files=names.map(name=>({path:`packages/brain/src/lib/${name}`,sha256:hash(readFileSync(new URL(name,import.meta.url)))})).sort((a,b)=>a.path.localeCompare(b.path));
export function readNativeConsumerRuntime(){
 return {schema_version:1,repo:'perfectuser21/cecelia',git_sha:/^[a-f0-9]{40}$/.test(process.env.GIT_SHA||'')?process.env.GIT_SHA:null,files:files.map(f=>({...f}))};
}
export async function assertNativeConsumerRuntime(readSource,tree){
 try{for(const file of files){const bytes=await readSource(file.path);if(typeof bytes!=='string'||hash(bytes)!==file.sha256)throw Error('mismatch');
  if(tree){const matches=tree.tree.filter(e=>e.path===file.path),entry=matches[0],buffer=Buffer.from(bytes);
   if(matches.length!==1||entry.type!=='blob'||!['100644','100755'].includes(entry.mode)||entry.sha!==createHash('sha1').update(`blob ${buffer.length}\0`).update(buffer).digest('hex'))throw Error('blob mismatch');}}}
 catch{throw Object.assign(Error('实际消费者采集器与固定源码不一致'),{code:'IMPLEMENTATION_CI_SOURCE_RUNTIME_MISMATCH',status:409});}
}
