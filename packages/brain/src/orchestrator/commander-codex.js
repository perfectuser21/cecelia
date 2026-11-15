import {callCodexJudge} from '../../scripts/coding-workflow/lib/codex-judge.mjs';
import {projectModelInput} from './commander-decision.js';
import fs from 'node:fs';
import path from 'node:path';
import {prepareCodexAuth} from '../../scripts/coding-workflow/lib/codex-auth.mjs';
import {normalizeTurns} from './commander-usage-ledger.js';
/** 纯决策无工具；活动执行适配器与该Commander严格分开。 */
export function createCodexCommander({model,codexHome,codexBin,codexAuth,transcriptPath,manifestPath,ledger}) {
  return async (request,{timeoutMs}) => {
    const prompt={
      system:'你是Workflow Commander。Workflow Contract定义目标、边界和验收；可选Playbook仅提供该Workflow的冻结执行方法，不能覆盖Contract、allowed_actions或独立验收结论。没有Playbook时不推测或加载其他方法。只依据给定冻结事实，从allowed_actions选择一个动作。正常推进时仅在allowed_actions提供dispatch时选择它。complete只确认source阶段已满足冻结路线：所需source已独立验收，或冻结on_status已合法stop。finalize由宿主随后执行，不属于本次complete的确认范围；最终结果仍由宿主独立验收，业务失败必须保留，清理失败不能把业务结果判为成功。仅在allowed_actions提供complete且source条件满足时选择complete；业务证据不足或存在不确定性时仍选择pause。禁止工具、代码执行和修改契约。只返回单个JSON，精确复制protocol、run_id、definition_sha256、sequence、state_sha256，并给action、dispatch才有activity_key、简短reason。',
      user:JSON.stringify({...request,input:projectModelInput(request.input,{sourceFile:manifestPath,sourceField:'run.input.verification.runtime_sha256'})}),
    };
    if(ledger){
      const prepared=prepareCodexAuth(codexAuth,{legacyHome:codexHome});
      if(!model||!(prepared?.auth.home??codexHome))throw Error('judge_codex_config_missing');
      if(codexBin&&path.isAbsolute(codexBin))fs.accessSync(codexBin,fs.constants.X_OK);
    }
    const call=ledger?.beginCall({role:'commander',decision_sequence:request.sequence,provider:'codex',model:model??'unknown',auth_mode:codexAuth?.mode??'unknown'});
    const nativePath=call?path.join(call.directory,'native.jsonl'):transcriptPath;
    let failure;
    try{
      const result=await callCodexJudge(prompt,{model,codexHome,codexBin,codexAuth,transcriptPath:nativePath,timeoutMs});
      return JSON.parse(result.content);
    }catch(error){failure=error;throw error;}
    finally{
      if(call){
        const raw=fs.existsSync(nativePath)?fs.readFileSync(nativePath,'utf8'):'';
        const events=raw.split('\n').flatMap(line=>{try{return [JSON.parse(line)];}catch{return [];}});
        const terminal=events.some(e=>['turn.completed','turn.failed'].includes(e.type));
        ledger.finishCall(call.call_id,{status:failure?(terminal?'failed':'unknown'):'completed',
          dispatch_status:events.some(e=>typeof e.type==='string')?'dispatched':'unknown',usage:normalizeTurns(events),
          ...(failure?{reason_code:/^[a-zA-Z0-9][a-zA-Z0-9_.:/@+-]{0,255}$/.test(failure.code??failure.message)?failure.code??failure.message:'commander_response_invalid'}:{}),evidence_ref:nativePath});
        // 兼容旧验收的聚合transcript仅展示；计量始终消费本次独立原件。
        if(transcriptPath&&raw){fs.mkdirSync(path.dirname(transcriptPath),{recursive:true});fs.appendFileSync(transcriptPath,raw,{mode:0o600});}
      }
    }
  };
}
