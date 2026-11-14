import {digest,canonical} from '../../src/orchestrator/commander-decision.js';
const identityKeys=['task_id','run_id','run_tag','workflow','activity','attempt'];
export function verifySkillReadback(value,request,{allowEmpty=false}={}) {
  if(!value||typeof value!=='object'||!value.identity||identityKeys.some(k=>value.identity[k]!==request[k])
    ||Object.keys(value.identity).some(k=>!identityKeys.includes(k))||value.nonce!==request.nonce
    ||!['passed',...(allowEmpty?['empty']:[])].includes(value.outcome)
    ||!value.output||typeof value.output!=='object'||Array.isArray(value.output)
    ||!Array.isArray(value.checks)||value.checks.length!==request.checks.length
    ||new Set(value.checks.map(c=>c.id)).size!==request.checks.length
    ||request.checks.some(id=>!value.checks.some(c=>c.id===id&&c.status==='passed'&&Array.isArray(c.evidence)&&c.evidence.length
      &&c.evidence.every(e=>typeof e.source==='string'&&e.source.trim()&&e.observation&&typeof e.observation==='object'
        &&!Array.isArray(e.observation)&&Object.keys(e.observation).length))))throw Error('skill_readback_unconfirmed');
  canonical(value);return value;
}
export function codexWorkerArgs(codex,thread,output) {
  return [...(codex.args??[]),'exec',...(thread?['resume']:[]),'--json','--skip-git-repo-check','-o',output,...(thread?[thread]:[]),'-'];
}
export const sameIdentity=(a,b)=>Boolean(a&&b&&digest(a)===digest(b));
