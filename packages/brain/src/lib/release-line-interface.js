/**
 * 发布线·接口判定（决策 de6dff5d 第 3 步）：Activity 合同 inputs/outputs 规范化后比较。
 * 每项取 type / cardinality / effect / 排序后的 fields，再按 type 排序；接口变了的 Activity 不能单独晋级，
 * 受影响的上下游必须一起走成组晋级（release-line-gate.js groupPromote）。
 */
import { createHash } from 'node:crypto';

const fieldName = f => (typeof f === 'string' ? f : f?.name ?? JSON.stringify(f));
function normalizeList(list) {
  return (Array.isArray(list) ? list : []).map(item => {
    if (typeof item === 'string') return { type: item, cardinality: null, effect: null, fields: [] };
    const raw = item?.fields;
    const fields = Array.isArray(raw) ? raw.map(fieldName).sort() : raw && typeof raw === 'object' ? Object.keys(raw).sort() : [];
    return { type: item?.type ?? null, cardinality: item?.cardinality ?? null, effect: item?.effect ?? null, fields };
  }).sort((a, b) => String(a.type).localeCompare(String(b.type)) || JSON.stringify(a).localeCompare(JSON.stringify(b)));
}

/** 合同 → 规范化接口 {inputs, outputs}（纯函数）。 */
export function normalizeInterface(contract) {
  return { inputs: normalizeList(contract?.inputs), outputs: normalizeList(contract?.outputs) };
}

export function interfaceSha256(contract) {
  return createHash('sha256').update(JSON.stringify(normalizeInterface(contract))).digest('hex');
}

const byType = list => {
  const m = new Map();
  for (const item of list) m.set(item.type, [...(m.get(item.type) || []), JSON.stringify(item)]);
  return m;
};
function changedTypes(oldList, newList) {
  const a = byType(oldList), b = byType(newList), out = new Set();
  for (const t of new Set([...a.keys(), ...b.keys()])) if (JSON.stringify(a.get(t) || []) !== JSON.stringify(b.get(t) || [])) out.add(t);
  return [...out].filter(t => t !== null).sort();
}

/** 两份合同的接口差异（纯函数）：changed / 变化了的输入类型 / 变化了的输出类型。 */
export function interfaceDiff(oldContract, newContract) {
  const o = normalizeInterface(oldContract), n = normalizeInterface(newContract);
  const inputs = changedTypes(o.inputs, n.inputs), outputs = changedTypes(o.outputs, n.outputs);
  return { changed: inputs.length > 0 || outputs.length > 0, changed_input_types: inputs, changed_output_types: outputs };
}

/**
 * 受接口变化影响的 Activity（纯函数）。
 * @param {{activityId:string, diff:object, workflows:{workflow_id:string, slots:{activity_id:string, sequence_no:number, contract:object}[]}[]}} input
 * 下游：同一流程里排在它之后、inputs.type 命中变化了的输出类型；上游：inputs 变了时，排在它之前、产出这些类型的。
 */
export function affectedByInterfaceChange({ activityId, diff, workflows }) {
  if (!diff?.changed) return [];
  const out = new Map();
  for (const wf of workflows || []) {
    const self = wf.slots.find(s => s.activity_id === activityId);
    if (!self) continue;
    for (const slot of wf.slots) {
      if (slot.activity_id === activityId) continue;
      const iface = normalizeInterface(slot.contract);
      const consumes = iface.inputs.some(i => diff.changed_output_types.includes(i.type));
      const produces = iface.outputs.some(o => diff.changed_input_types.includes(o.type));
      let relation = null;
      if (slot.sequence_no > self.sequence_no && consumes) relation = 'downstream';
      else if (slot.sequence_no < self.sequence_no && produces) relation = 'upstream';
      if (relation && !out.has(slot.activity_id)) out.set(slot.activity_id, { activity_id: slot.activity_id, relation, workflow_id: wf.workflow_id });
    }
  }
  return [...out.values()].sort((a, b) => a.activity_id.localeCompare(b.activity_id));
}

/** 读库：引用该 Activity 的生效流程，每格带该 Activity 当前生产版（无指针取当前合同）的合同。 */
export async function workflowSlotsFor(db, activityId) {
  const rows = (await db.query(
    `SELECT r.workflow_id, r.activity_id, r.sequence_no,
            COALESCE(b.payload->'contract', a.contract) AS contract
       FROM workflow_activity_refs r
       JOIN activities a ON a.id = r.activity_id
       LEFT JOIN activity_release_state s ON s.activity_id = r.activity_id
       LEFT JOIN activity_versions v ON v.id = s.production_version_id
       LEFT JOIN activity_definition_versions b ON b.id = v.first_build_id
      WHERE r.active AND r.workflow_id IN (SELECT workflow_id FROM workflow_activity_refs WHERE activity_id = $1 AND active)
      ORDER BY r.workflow_id, r.sequence_no`, [activityId])).rows;
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.workflow_id)) map.set(r.workflow_id, { workflow_id: r.workflow_id, slots: [] });
    map.get(r.workflow_id).slots.push({ activity_id: r.activity_id, sequence_no: r.sequence_no, contract: r.contract });
  }
  return [...map.values()];
}
