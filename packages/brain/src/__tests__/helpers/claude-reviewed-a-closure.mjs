// 仅测试守卫：ee25a25a9 已审只读 Acorn/摘要消费完整组合，禁止动态学习候选摘要。
// source.js 是 normalize() 投影的真实调用方，也必须固定；所有原进程检测仍执行。
import { createHash } from 'node:crypto';
import path from 'node:path';
const HASHES = {
  "existing-ops-source.js": "48a2f74d85054807992323d41f64097d6b88791a66c5ede39aae5584b20ec2f7",
  "existing-ops-build-source.js": "679289bfaa20b407b9c9d87c6bf9632928247e3bd86e664f3f12393c5a1c8206",
  "existing-ops-build-envelopes.js": "9d3165752c1a80a6891f5b1f24d1d8579a94b1d6f37692a8a065202388a7b403",
  "existing-ops-runtime-source.js": "48f919b399f133feadcfb0678ef67c95550d199e3d97fb213ccb9276d93abbf7",
  "existing-ops-stage-source.js": "4efb563d9e3a8c7fa08523c81c730ba1efefa82cbd0de4811c6facb2794bf5ea",
  "existing-ops-stage-envelopes.js": "1fda2fc1f3bf3ef7684930e46ac8dc0364bd1af1f8f27e97c7eb197fe23a6d8f",
  "existing-ops-stage-modes.js": "8266c7b1f74b11a0161684f83e3deb189ee101e2a0b64578cacffaaff1711752",
  "existing-ops-provenance-envelope.js": "ade6df8d35b187ce0495ebd163fa0489379f37114fe2111b4677a4b622933a95",
  "existing-ops-provenance-core-envelope.js": "c3e8769e7f053fc63d52074235b521df5134e65c31d34f151bb6a9400fa4ab93",
  "existing-ops-provenance-entry-envelopes.js": "126a93b9db9856fe06894a394ecb9e0afd099860b9fb54e8927c56c8b96a15bb",
  "existing-ops-provenance-local-envelopes.js": "ef359ef987229815f3d258ff78535fb55dc909bb64eae88d67ce63d0ea55c7f4",
  "existing-ops-native-evidence-source.js": "675be567f871855220a89301f1dbf50dbcc0a900e02c2ed3303ec39d3a647b3c",
  "existing-ops-native-evidence-envelopes.js": "44abae0d93238048356f5573765320b92ad54e481ba78f5925a3c558a8b86013"
};
const cache=new Map(), referenceCache=new Map();
function hash(text,parse,shape){
 if(!cache.has(text))cache.set(text,createHash('sha256').update(shape(parse(text))).digest('hex'));
 return cache.get(text);
}
export function reviewedADataRanges(src,{file,sources,root,parse,shape,rows,decoded,provenFingerprintReader}){
 const data=['build-envelopes','stage-envelopes','native-evidence-envelopes'].map(n=>path.join(root,`existing-ops-${n}.js`));
 if(!data.includes(file)||src!==sources?.get(file))return null;
 try{
  const closure=new Set(Object.keys(HASHES).map(name=>path.join(root,name)));
  for(const [name,digest] of Object.entries(HASHES)){
   const text=sources.get(path.join(root,name));
   if(typeof text!=='string'||hash(text,parse,shape)!==digest)return null;
  }
  // 准确固定所有内部消费者；外部不得取得原文或传入 eval 解析器。
  // source.js 仅向注册器返回摘要/关系，允许正常调用；其完整 AST 已在上面绑定。
  const protectedNames=Object.keys(HASHES).filter(n=>n!=='existing-ops-source.js');
  for(const [consumer,text] of sources){
   if(closure.has(consumer)||provenFingerprintReader(consumer,text))continue;
   if(!referenceCache.has(text))referenceCache.set(text,decoded(text));
   if(referenceCache.get(text).some(value=>protectedNames.some(name=>value.includes(name))))return null;
  }
  return rows(parse(src)).filter(({node})=>node.type==='Literal'&&typeof node.value==='string'
   ||node.type==='TemplateLiteral'&&node.expressions.length===0).map(({node})=>[node.start,node.end]);
 }catch{return null;}
}
