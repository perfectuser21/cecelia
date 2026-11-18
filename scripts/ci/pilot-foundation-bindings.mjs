/** 可信发布入口验证已声明固定宿主全集；不执行被测仓库自己的校验代码。 */
import {createHash} from 'node:crypto';
import {readFixedImplementationBinding} from '../../packages/brain/src/workflow-authoring/fixed-git-source.js';
import {pilotPlanHash} from '../../packages/brain/src/lib/pilot-release-verification.js';
const REPO='perfectuser21/zenithjoy-workspace',SKILLS='services/phone-adb-controller/skills/';
const sha=x=>createHash('sha256').update(x).digest('hex');
const same=(a,b)=>pilotPlanHash(a)===pilotPlanHash(b);
const key=b=>JSON.stringify([b.kind,b.repo,b.revision,b.path,b.digest]);
const safe=p=>typeof p==='string'&&/^[-A-Za-z0-9_./]+$/.test(p)&&!p.startsWith('/')&&!p.split('/').some(x=>!x||x==='.'||x==='..');
const need=(v,suffix)=>{if(!v)throw Object.assign(Error('PILOT_FOUNDATION_'+suffix),{code:'PILOT_FOUNDATION_'+suffix});};
const host=b=>b?.purpose==='foundation_host';
function declaration(b){
 const keys=['digest','kind','path','purpose','repo','revision',...(b?.resolved_source?['resolved_source']:[])].sort();
 need(b&&same(Object.keys(b).sort(),keys)&&host(b),'DECLARATION');
 need(!b.resolved_source||b.kind==='skill','DECLARATION');
 return b;
}
export async function verifyPilotFoundationBindings(snapshot,sourceOptions){
 const approved=new Set(),activities=snapshot.definitions.activities;
 const read=async b=>(await readFixedImplementationBinding(b,sourceOptions)).bytes;
 for(const workflow of snapshot.definitions.workflows){
  const doc=workflow.payload.contract;
  if(doc?.runtime?.kind!=='commander-foundation-v1')continue;
  const ref=doc.runtime.profile_ref;
  need(snapshot.repo===REPO&&ref?.repo===REPO&&/^[a-f0-9]{40}$/.test(ref.revision??'')&&safe(ref.path)&&/^sha256:[a-f0-9]{64}$/.test(ref.digest??''),'PROFILE');
  const bytes=await read({kind:'code',...ref});need('sha256:'+sha(bytes)===ref.digest,'PROFILE_DIGEST');
  const profile=JSON.parse(bytes),p=profile.profile;
  need(p?.files&&typeof p.files==='object'&&!Array.isArray(p.files)&&p.skill_runtime?.activities&&Array.isArray(doc.activities),'PROFILE');
  const expected=[{kind:'code',...ref},...Object.entries(p.files).map(([path,digest])=>{
   need(safe(path)&&/^[a-f0-9]{64}$/.test(digest),'PROFILE');return {kind:path.startsWith(SKILLS)?'skill':'code',repo:REPO,revision:ref.revision,path,digest:'sha256:'+digest};
  })],wanted=new Set(expected.map(key));
  const refs=workflow.payload.activities;
  const slots=doc.activities.map(a=>a.key??a.ref?.split('.')[1]);
  need(new Set(slots).size===slots.length&&same(profile.contract?.activities?.map(a=>a.key),slots)
   &&same(Object.keys(p.skill_runtime.activities).sort(),[...slots].sort())&&refs?.length===slots.length,'ACTIVITY_SET');
  const collected=[];
  for(let i=0;i<doc.activities.length;i++){
   const item=doc.activities[i],link=refs[i];
   const matches=activities.filter(a=>a.id===link?.activity_version_id&&a.activity_id===link.activity_id);
   need(matches.length===1&&link.slot_key===slots[i]&&(link.source_ref??null)===(item.ref??null),'ACTIVITY');
   const a=matches[0],contract=a.payload.contract,bindings=a.payload.implementation_bindings??[];
   need(contract?.key===slots[i]&&a.payload.definition_key===(item.ref??`${workflow.payload.key}.${item.key}`),'ACTIVITY');
   if(!item.ref){
    need(same(contract,item),'ACTIVITY_CONTRACT');
    const declared=(item.implementation_bindings??[]).filter(host).map(declaration);
    const normalized=bindings.filter(b=>host(b)||host(b.raw));
    need(normalized.length===declared.length,'DECLARATION');
    for(const b of normalized){
     need(host(b)&&host(b.raw)&&b.scope==='activity'&&b.status==='verified'&&b.field==='implementation_bindings'
      &&Number.isInteger(b.index)&&same(b.raw,item.implementation_bindings[b.index])
      &&key(b)===key(b.raw)&&b.content_sha256===b.digest?.slice(7),'DECLARATION');
     need(declared.filter(d=>key(d)===key(b)).length===1,'DECLARATION');collected.push(b);
    }
   }
   const skills=bindings.filter(b=>b.kind==='skill'&&!host(b));
   need(skills.length===1,'BUSINESS_SKILL');const b=skills[0],executed=p.skill_runtime.activities[slots[i]]?.skill;
   need(b.repo===REPO&&b.revision===snapshot.revision&&b.raw?.revision==='contract'&&b.status==='verified'&&b.scope==='activity'
    &&executed===b.path&&p.files[executed]===b.digest?.slice(7),'EXECUTED_SKILL');
   need(sha(await read(b))===p.files[executed],'EXECUTED_SKILL');
  }
  need(wanted.size===expected.length&&collected.length===wanted.size&&new Set(collected.map(key)).size===collected.length
   &&collected.every(b=>wanted.has(key(b))),'COMPONENT_SET');
  const lock=async revision=>JSON.parse(await read({kind:'code',repo:REPO,revision,path:'.skills-source.json'}));
  const old=await lock(ref.revision),current=await lock(snapshot.revision);
  need(['version','repository','revision','profile','loader_sha256'].every(k=>old[k]!==undefined&&old[k]===current[k])
   &&p.leadgen?.method_repository===old.repository&&p.leadgen?.method_revision===old.revision,'SKILL_ORIGIN');
  for(const b of collected)approved.add(b);
 }
 for(const a of activities)for(const b of a.payload.implementation_bindings??[])
  if(host(b)||host(b.raw))need(approved.has(b),'UNDECLARED_COMPONENT');
 return approved;
}
