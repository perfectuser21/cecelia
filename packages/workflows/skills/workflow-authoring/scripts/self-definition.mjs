#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export function selfDefinition({ capabilityId, skillId, revision }) {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuid.test(capabilityId) || !uuid.test(skillId) || !/^[a-f0-9]{40}$/i.test(revision)) throw new Error('必须提供真实能力、skill UUID及固定来源commit');
  const stages = [
    ['intake','理解需求','目标、输入输出、验收和所属能力明确'],
    ['reuse','查目录复用','真实目录快照和每个候选的采用理由已留痕'],
    ['compose','确定组装方案','有序活动、实现和版本固定为定义指纹'],
    ['build','补齐能力','具体入口可调用，开发任务完成且实现已就绪'],
    ['verify','整链验证','独立验证任务记录匹配指纹的全活动真实产出证据'],
    ['register','正式登记','事务登记成功、版本一致、活动顺序及身份回读一致'],
  ];
  return {
    key:'workflow_authoring',name:'创建与更新工作流',capability_id:capabilityId,
    channel:'internal',form:'openclaw_skill',version:'1.0.0',
    source:{ref:'zenithjoy-skills:workflow-authoring/SKILL.md',revision},
    runtime:{skill_id:skillId,entrypoint:'OpenClaw:workflow-authoring'},
    activities:stages.map(([key,name,acceptance])=>({key,name,executor_kind:'agent',
      implementation:{kind:'skill',skill_id:skillId,ref:`workflow-authoring#${key}`,version:'1.0.0'},acceptance:[acceptance]})),
  };
}
if (process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const args=process.argv.slice(2), options={};
  for(let i=0;i<args.length;i+=2) options[args[i]]=args[i+1];
  try { process.stdout.write(`${JSON.stringify(selfDefinition({capabilityId:options['--capability-id'],skillId:options['--skill-id'],revision:options['--revision']}),null,2)}\n`); }
  catch(error) { process.stderr.write(`${error.message}\n`); process.exitCode=1; }
}
