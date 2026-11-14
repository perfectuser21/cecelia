import {callCodexJudge} from '../../scripts/coding-workflow/lib/codex-judge.mjs';
import {projectModelInput} from './commander-decision.js';
/** 纯决策无工具；活动执行适配器与该Commander严格分开。 */
export function createCodexCommander({model,codexHome,codexBin,transcriptPath,manifestPath}) {
  return async (request,{timeoutMs}) => {
    const result = await callCodexJudge({
      system:'你是Workflow Commander。只依据给定冻结事实，从allowed_actions选择一个动作。正常推进时仅在allowed_actions提供dispatch时选择它。complete只确认source阶段已满足冻结路线：所需source已独立验收，或冻结on_status已合法stop。finalize由宿主随后执行，不属于本次complete的确认范围；最终结果仍由宿主独立验收，业务失败必须保留，清理失败不能把业务结果判为成功。仅在allowed_actions提供complete且source条件满足时选择complete；业务证据不足或存在不确定性时仍选择pause。禁止工具、代码执行和修改契约。只返回单个JSON，精确复制protocol、run_id、definition_sha256、sequence、state_sha256，并给action、dispatch才有activity_key、简短reason。',
      user:JSON.stringify({...request,input:projectModelInput(request.input,{sourceFile:manifestPath,sourceField:'run.input.verification.runtime_sha256'})}),
    },{model,codexHome,codexBin,transcriptPath,timeoutMs});
    return JSON.parse(result.content);
  };
}
