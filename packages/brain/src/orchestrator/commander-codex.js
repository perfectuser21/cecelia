import {callCodexJudge} from '../../scripts/coding-workflow/lib/codex-judge.mjs';
/** 纯决策无工具；活动执行适配器与该Commander严格分开。 */
export function createCodexCommander({model,codexHome,codexBin,transcriptPath}) {
  return async (request,{timeoutMs}) => {
    const result = await callCodexJudge({
      system:'你是Workflow Commander。只依据给定冻结事实，从allowed_actions选择一个动作。正常时选择dispatch，所有活动已验收时选择complete；不确定时pause。禁止工具、代码执行和修改契约。只返回单个JSON，精确复制protocol、run_id、definition_sha256、sequence、state_sha256，并给action、dispatch才有activity_key、简短reason。',
      user:JSON.stringify(request),
    },{model,codexHome,codexBin,transcriptPath,timeoutMs});
    return JSON.parse(result.content);
  };
}
