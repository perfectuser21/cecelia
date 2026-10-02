/** 所有文件钉在同一 commit；完整解析和验证后才允许同步器开启写事务。 */
import yaml from 'js-yaml';
import { stepSha256 as hash } from '../../scripts/sync-steps-from-workspace.mjs';
const IDENT = /^[a-zA-Z0-9_-]+$/;
export const contractPath = cap => `product-map/contracts/${cap}.yaml`;

export async function loadActivityContracts(registrations, digest, fetchFile) {
  const docs = new Map(), loading = new Set();
  async function load(cap, path = contractPath(cap)) {
    if (!IDENT.test(cap)) throw new Error(`无效能力: ${cap}`);
    if (loading.has(cap)) return; // 解析阶段拒绝循环，而非网络递归。
    if (docs.has(cap)) return;
    loading.add(cap);
    const doc = yaml.load(await fetchFile(path));
    if (doc?.capability !== cap || !Array.isArray(doc.activities)) throw new Error(`契约能力映射无效: ${cap}`);
    docs.set(cap,doc);
    for (const a of doc.activities) {
      if (a.ref !== undefined) {
        if (typeof a.ref !== 'string' || !/^[\w-]+\.[\w-]+$/.test(a.ref) || Object.keys(a).some(k => k !== 'ref')) throw new Error(`无效引用: ${a.ref}`);
        await load(a.ref.split('.')[0]);
      } else if (!IDENT.test(a.key || '') || !Number.isInteger(a.order) || a.order < 1 || !a.name) throw new Error(`无效活动: ${cap}`);
    }
    loading.delete(cap);
  }
  for (const w of registrations) {
    if (w.source_path !== contractPath(w.source_capability)) throw new Error(`来源路径映射无效: ${w.key}`);
    await load(w.source_capability,w.source_path);
    if (docs.get(w.source_capability).workflow !== w.source_workflow) throw new Error(`来源工作流映射无效: ${w.key}`);
  }
  function resolve(cap,key,trail = []) {
    const identity = `${cap}.${key}`;
    if (trail.includes(identity)) throw new Error(`循环引用: ${[...trail,identity].join(' → ')}`);
    const matches = docs.get(cap)?.activities.filter(a => (a.key || a.ref?.split('.')[1]) === key) || [];
    if (matches.length !== 1) throw new Error(`引用不存在或重复: ${identity}`);
    const a = matches[0];
    if (a.ref) return resolve(...a.ref.split('.'),[...trail,identity]);
    return { ...a,from:cap };
  }
  const expanded = new Map();
  for (const [cap,doc] of docs) {
    const activities = doc.activities.map(a => resolve(cap,a.key || a.ref.split('.')[1]));
    if (new Set(activities.map(a=>a.key)).size !== activities.length || new Set(activities.map(a=>a.order)).size !== activities.length) throw new Error(`活动槽位或顺序重复: ${cap}`);
    const want = digest?.capabilities?.[cap];
    if (!want || want.sha256 !== hash({...doc,activities}) || Object.keys(want.activities || {}).length !== activities.length
      || activities.some(a=>want.activities[a.key]!==hash(a))) throw new Error(`契约 digest 校验失败: ${cap}`);
    expanded.set(cap,activities);
  }
  return registrations.map(workflow => ({ workflow, activities: expanded.get(workflow.source_capability).map((activity,i) => ({
    activity, source_ref: docs.get(workflow.source_capability).activities[i].ref || null,
    sha256: hash(activity),
  })) }));
}
