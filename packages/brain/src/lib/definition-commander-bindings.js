/** Commander声明归冻结payload；来源字节核验不替代独立业务核验。 */
import { stepSha256 } from '../../scripts/sync-steps-from-workspace.mjs';

const object = value => value && typeof value === 'object' && !Array.isArray(value);
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const fields = ['commander_implementation', 'commander_implementations'];
function need(condition, reason) { if (!condition) throw Error(`Commander冻结声明无效: ${reason}`); }

export function commanderBusinessContract(contract) {
  return Object.fromEntries(Object.entries(contract).filter(([key]) => !fields.includes(key)));
}
function validateSource(selected, kind, bindings) {
  const identity=selected?.implementation;
  need(object(selected) && object(identity) && identity.kind===kind && hash(identity.digest)
    && ['id','version'].every(k=>typeof identity[k]==='string' && identity[k].trim())
    && typeof selected.path==='string' && selected.path && !selected.path.startsWith('/')
    && !/[\\\x00-\x1f?#]/.test(selected.path) && !selected.path.split('/').some(p=>['.','..',''].includes(p)), '实现身份或路径');
  const verified=bindings.filter(b=>b.kind===kind && b.path===selected.path && b.scope==='activity'
    && b.status==='verified' && b.validation_scope==='reference_only'
    && /^[a-f0-9]{40}$/.test(b.revision ?? '') && typeof b.repo==='string'
    && b.digest?.replace(/^sha256:/,'')===identity.digest
    && (kind!=='skill' || (b.version===identity.version && b.name===identity.id)));
  need(verified.length>0 && new Set(verified.map(b=>JSON.stringify([b.repo,b.revision,b.path]))).size===1, '来源字节、版本或核验状态');
}
export function freezeCommanderDeclarations(contract, bindings) {
  const result={}, business=commanderBusinessContract(contract), businessHash=stepSha256(business);
  for(const field of fields) {
    const declaration=contract[field];
    if(declaration===undefined)continue;
    need(object(declaration) && declaration.business_requirement_sha256===businessHash, '业务合同摘要');
    if(field==='commander_implementation') {
      need(['code','skill'].includes(declaration.implementation?.kind), '独立实现kind');
      validateSource(declaration,declaration.implementation.kind,bindings);
    } else {
      for(const kind of ['code','skill'])validateSource(declaration[kind],kind,bindings);
      const ref=declaration.skill.verification_ref;
      need(object(ref) && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(ref.task_id ?? '')
        && /^wfd-[a-f0-9-]+$/.test(ref.run_id ?? '') && hash(ref.definition_sha256), 'Skill独立核验引用');
    }
    result[field]=structuredClone(declaration);
  }
  if(result.commander_implementation && result.commander_implementations) {
    const primary=result.commander_implementation, code=result.commander_implementations.code;
    need(stepSha256(primary.implementation)===stepSha256(code.implementation) && primary.path===code.path, 'primary与配套Code不符');
  }
  return result;
}
