/** 固定revision的引用核验≠业务可用验收；无法确认的旧描述及符号明确unresolved。 */
import { createHash } from 'node:crypto';
import yaml from 'js-yaml';
export async function validateImplementationBindings(contract,readBinding,source) {
  const bindings=[];
  async function add(binding,location) {
    const declared = binding;
    if (binding?.revision === 'contract') {
      if (binding.repo !== source?.repo || !/^[0-9a-f]{40}$/.test(source?.commit || '')) throw Error('contract实现版本必须来自同仓固定契约来源');
      binding = { ...binding, revision: source.commit };
    }
    if(!binding||!['skill','code'].includes(binding.kind)) throw Error('实现绑定kind必须是skill/code');
    if(!/^[\w.-]+\/[\w.-]+$/.test(binding.repo||'')) throw Error('实现绑定repo无效');
    if(!/^[0-9a-f]{40}$/.test(binding.revision||'')) throw Error('实现绑定revision必须是固定40位commit');
    if(typeof binding.path!=='string'||!binding.path||binding.path.startsWith('/')||binding.path.split('/').some(p=>p==='..'||p==='.'||!p)||/[?#\\]/.test(binding.path)) throw Error('实现绑定path无效');
    if(binding.kind==='skill'&&!binding.path.endsWith('/SKILL.md')&&binding.path!=='SKILL.md') throw Error('Skill绑定必须指向SKILL.md');
    if(!readBinding) throw Error('缺少固定revision引用验证器');
    const content=await readBinding(binding);
    if(typeof content!=='string'||!content.trim()) throw Error('实现绑定引用不存在或为空');
    const contentSha=createHash('sha256').update(content).digest('hex');
    const digest=`sha256:${contentSha}`;
    if(binding.digest!==undefined&&binding.digest!==digest) throw Error('实现绑定digest不匹配');
    if(binding.sha256!==undefined&&binding.sha256!==contentSha) throw Error('实现绑定digest不匹配');
    const result={...binding,...location,raw:declared,digest,content_sha256:contentSha,validation_scope:'reference_only',status:'verified'};
    if(binding.kind==='skill') {
      const frontmatter=content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
      const metadata=frontmatter?yaml.load(frontmatter[1]):null;
      if(!metadata?.name||!metadata?.version) throw Error('Skill缺少name/version元数据');
      for(const field of ['name','version']) if(binding[field]!==undefined&&String(binding[field])!==String(metadata[field])) throw Error(`Skill ${field}不匹配`);
      result.name=String(metadata.name);result.version=String(metadata.version);
    }
    if(binding.symbol){result.status='unresolved';result.reason='symbol_unverified';}
    bindings.push(result);
  }
  const raw=(value,location)=>{if(value!==undefined&&value!==null)bindings.push({kind:'raw',raw:value,...location,status:'unresolved'});};
  async function visit(value,location) {
    if(value.implementation_bindings!==undefined&&!Array.isArray(value.implementation_bindings)) throw Error('implementation_bindings必须是数组');
    for(const [index,binding] of (value.implementation_bindings||[]).entries()) await add(binding,{...location,field:'implementation_bindings',index});
    for(const field of ['runtime','implementation']) if(value[field]!==undefined) {
      if(value[field]?.kind) await add(value[field],{...location,field});
      else raw(value[field],{...location,field});
    }
    if(value.execution?.via) raw(value.execution.via,{...location,field:'execution.via'});
  }
  await visit(contract,{scope:'activity'});
  for(const step of contract.steps||[]) await visit(step,{scope:'step',step_key:step.key});
  return bindings;
}
