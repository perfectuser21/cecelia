/**
 * step-probe-spec.js — 步级「探针」断言的形状（纯逻辑，无 IO）。链 bf5088a3 棒2，决策 702949b6。
 *
 * 步级断言链（journey_step_links.assertion_ref → runner → journey_assertion_receipts → cell 翻色）
 * 原来只认 vitest/pytest/smoke 三种 shell 形状；探针是第四种：业务侧 SQL/HTTP 探测 + 期望值，
 * 由 business_probe_runner 执行，不是 shell 命令。
 *
 * SSOT 在仓库 YAML（如 services/phone-adb-controller/checks/<workflow>.yaml），Brain 的 step_probes 表
 * 只存归一化 spec + spec_hash（sha256(canonical JSON)），同 skill_registry 清单哈希做法：漂移即报。
 *
 * assertion_ref 形状：`probe:<key>`；一个格子挂多条探针时 `probe:<k1>,<k2>`（逗号连接，YAML 顺序）。
 *
 * 哈希两级并存（棒2 后续定档）：
 *   * spec_hash     逐条 sha256(canonical JSON(spec))——漂移粒度到探针（哪条变了）
 *   * source_sha256 整文件原文 sha256——与 workspace probes-lib loadChecks().sha256 同口径（仓库那份是不是库里登记的这版）
 * probe 形状对齐 workspace checks/schema.json：sql {type,target,query}；http {type,target,url,filter,reduce,minus?}。
 */
import { createHash } from 'crypto';

export const PROBE_REF_PREFIX = 'probe:';
export const PROBE_KEY_RE = /^[a-z0-9][a-z0-9._-]{0,127}$/i;
export const PROBE_TYPES = Object.freeze(['sql', 'http']);
export const EXPECT_OPS = Object.freeze(['>=', '==', '<=', 'not_null_all']);
export const COMPARE_OPS = Object.freeze(['>=', '==', '<=']);
export const SEVERITIES = Object.freeze(['warn', 'error']);
export const EXECUTOR_KIND = 'business_probe_runner';
const STAGE_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/i;
const METRIC_REF_RE = /^metrics\.[A-Za-z0-9_]+$/;
const HEX64 = /^[0-9a-f]{64}$/;

export const stepProbeError = (code, message = code, extra = {}) =>
  Object.assign(new Error(message), { code, ...extra });
const fail = (code, message, extra) => { throw stepProbeError(code, message, extra); };

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const nonEmptyString = (v) => typeof v === 'string' && v.trim().length > 0;

/** 键排序后的 JSON（数组顺序保留——顺序是语义）。 */
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isPlainObject(value)) {
    const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export const specHash = (spec) => createHash('sha256').update(canonicalJson(spec)).digest('hex');
/** 文件级哈希：原文 utf8 sha256，与 workspace checks/probes-lib.js loadChecks().sha256 同口径。 */
export const sourceSha256 = (text) => createHash('sha256').update(String(text), 'utf8').digest('hex');

const REDUCE_RE = /^(count|field:.+)$/;
const isScalar = (v) => ['number', 'string', 'boolean'].includes(typeof v);
const onlyKeys = (obj, allowed) => Object.keys(obj).every((k) => allowed.includes(k));

/**
 * http 取数源（workspace checks/schema.json httpSource）：{ url, filter:{列:值}, reduce:count|field:<列> }。
 * 主查询与 minus 子查询同形；字段原样保留进 spec（棒3a 执行体照此取数）。
 */
function normalizeHttpSource(raw, key, label) {
  if (!isPlainObject(raw) || !onlyKeys(raw, ['url', 'filter', 'reduce'])) {
    fail('STEP_PROBE_TARGET_INVALID', `探针 ${key}: ${label} 只允许 url/filter/reduce`, { probe_key: key });
  }
  const { url, filter, reduce } = raw;
  if (!nonEmptyString(url) || !/^https?:\/\/\S+$/i.test(url.trim())) {
    fail('STEP_PROBE_TARGET_INVALID', `探针 ${key}: ${label}.url 必须是 http(s) 地址`, { probe_key: key });
  }
  if (!isPlainObject(filter) || Object.keys(filter).length === 0 || !Object.values(filter).every(isScalar)) {
    fail('STEP_PROBE_TARGET_INVALID', `探针 ${key}: ${label}.filter 必须是非空 {列: 标量值}`, { probe_key: key });
  }
  if (typeof reduce !== 'string' || !REDUCE_RE.test(reduce)) {
    fail('STEP_PROBE_TARGET_INVALID', `探针 ${key}: ${label}.reduce 只支持 count | field:<列>`, { probe_key: key });
  }
  return { url: url.trim(), filter: { ...filter }, reduce };
}

function normalizeProbeTarget(raw, key) {
  if (!isPlainObject(raw)) fail('STEP_PROBE_TYPE_INVALID', `探针 ${key}: probe 必须是对象`, { probe_key: key });
  const { type, target } = raw;
  if (!PROBE_TYPES.includes(type)) {
    fail('STEP_PROBE_TYPE_INVALID', `探针 ${key}: probe.type 只支持 ${PROBE_TYPES.join('|')}`, { probe_key: key });
  }
  if (!nonEmptyString(target)) fail('STEP_PROBE_TARGET_INVALID', `探针 ${key}: probe.target 必填`, { probe_key: key });
  if (type === 'sql') {
    if (!onlyKeys(raw, ['type', 'target', 'query']) || !nonEmptyString(raw.query)) {
      fail('STEP_PROBE_TARGET_INVALID', `探针 ${key}: sql 探针只允许 type/target/query 且 query 必填`, { probe_key: key });
    }
    return { type, target: target.trim(), query: raw.query.trim() };
  }
  if (!onlyKeys(raw, ['type', 'target', 'url', 'filter', 'reduce', 'minus'])) {
    fail('STEP_PROBE_TARGET_INVALID', `探针 ${key}: http 探针只允许 type/target/url/filter/reduce/minus`, { probe_key: key });
  }
  const main = normalizeHttpSource({ url: raw.url, filter: raw.filter, reduce: raw.reduce }, key, 'probe');
  const out = { type, target: target.trim(), ...main };
  if (raw.minus !== undefined) out.minus = normalizeHttpSource(raw.minus, key, 'probe.minus');
  return out;
}

function normalizeExpect(raw, key) {
  if (!isPlainObject(raw) || !EXPECT_OPS.includes(raw.op)) {
    fail('STEP_PROBE_EXPECT_INVALID', `探针 ${key}: expect.op 只支持 ${EXPECT_OPS.join('|')}`, { probe_key: key });
  }
  const hasValue = raw.value !== undefined;
  const hasRef = raw.ref !== undefined;
  if (raw.op === 'not_null_all') {
    if (hasValue || hasRef) fail('STEP_PROBE_EXPECT_INVALID', `探针 ${key}: not_null_all 不带 value/ref`, { probe_key: key });
    return { op: raw.op };
  }
  if (hasValue === hasRef) {
    fail('STEP_PROBE_EXPECT_INVALID', `探针 ${key}: 比较 op 必须且只能带 value 或 ref 之一`, { probe_key: key });
  }
  if (hasRef) {
    if (typeof raw.ref !== 'string' || !METRIC_REF_RE.test(raw.ref)) {
      fail('STEP_PROBE_EXPECT_INVALID', `探针 ${key}: expect.ref 必须是 metrics.<k>`, { probe_key: key });
    }
    return { op: raw.op, ref: raw.ref };
  }
  if (!['number', 'string', 'boolean'].includes(typeof raw.value)) {
    fail('STEP_PROBE_EXPECT_INVALID', `探针 ${key}: expect.value 必须是标量`, { probe_key: key });
  }
  return { op: raw.op, value: raw.value };
}

/**
 * 单条探针 → 归一化 spec（字段固定、无未知字段）。抛 STEP_PROBE_* 错误（带 probe_key）。
 * @param {object} raw YAML 里的一条
 * @param {{workflow:string}} ctx 文档级 workflow（探针自带 workflow 时必须一致）
 */
export function normalizeProbe(raw, { workflow } = {}) {
  if (!isPlainObject(raw)) fail('STEP_PROBE_KEY_INVALID', '探针必须是对象');
  const key = raw.key;
  if (typeof key !== 'string' || !PROBE_KEY_RE.test(key)) {
    fail('STEP_PROBE_KEY_INVALID', `探针 key 非法: ${JSON.stringify(key)}（只允许字母数字 . _ -，不含空白）`, { probe_key: key });
  }
  if (!nonEmptyString(workflow)) fail('STEP_PROBE_WORKFLOW_INVALID', `探针 ${key}: workflow 缺失`, { probe_key: key });
  if (raw.workflow !== undefined && raw.workflow !== workflow) {
    fail('STEP_PROBE_WORKFLOW_INVALID', `探针 ${key}: workflow=${raw.workflow} 与文档 ${workflow} 不一致`, { probe_key: key });
  }
  if (!nonEmptyString(raw.stage) || !STAGE_RE.test(raw.stage.trim())) {
    fail('STEP_PROBE_CELL_MISMATCH', `探针 ${key}: stage 非法`, { probe_key: key });
  }
  const stage = raw.stage.trim();
  const expectedCell = `stage:${stage}`;
  if (raw.journey_cell !== expectedCell) {
    fail('STEP_PROBE_CELL_MISMATCH', `探针 ${key}: journey_cell 必须是 ${expectedCell}，实际 ${JSON.stringify(raw.journey_cell)}`, { probe_key: key });
  }
  if (!SEVERITIES.includes(raw.severity)) {
    fail('STEP_PROBE_SEVERITY_INVALID', `探针 ${key}: severity 只支持 ${SEVERITIES.join('|')}（不默认）`, { probe_key: key });
  }
  const spec = {
    key,
    workflow: workflow.trim(),
    stage,
    journey_cell: expectedCell,
    probe: normalizeProbeTarget(raw.probe, key),
    expect: normalizeExpect(raw.expect, key),
    severity: raw.severity,
  };
  if (raw.note !== undefined) {
    if (typeof raw.note !== 'string') fail('STEP_PROBE_DOC_INVALID', `探针 ${key}: note 必须是字符串`, { probe_key: key });
    spec.note = raw.note;
  }
  return spec;
}

/**
 * 整份 YAML 文档 → { version, workflow, probes: [{ spec, spec_hash }] }。重复 key 报错。
 */
export function parseProbesDocument(doc) {
  if (!isPlainObject(doc)) fail('STEP_PROBE_DOC_INVALID', '探针文档必须是对象');
  if (!Number.isInteger(doc.version) || doc.version < 1) fail('STEP_PROBE_DOC_INVALID', 'version 必须是正整数');
  if (!nonEmptyString(doc.workflow)) fail('STEP_PROBE_WORKFLOW_INVALID', 'workflow 必填');
  if (!Array.isArray(doc.probes)) fail('STEP_PROBE_DOC_INVALID', 'probes 必须是数组');
  const workflow = doc.workflow.trim();
  const seen = new Set();
  const probes = doc.probes.map((raw) => {
    const spec = normalizeProbe(raw, { workflow });
    if (seen.has(spec.key)) fail('STEP_PROBE_KEY_DUPLICATE', `探针 key 重复: ${spec.key}`, { probe_key: spec.key });
    seen.add(spec.key);
    return { spec, spec_hash: specHash(spec) };
  });
  return { version: doc.version, workflow, probes };
}

/** 按 journey_cell 聚合（保持 YAML 顺序）：Map<cell_key, probes[]>。 */
export function groupProbesByCell(probes) {
  const groups = new Map();
  for (const p of probes) {
    const cell = p.spec.journey_cell;
    if (!groups.has(cell)) groups.set(cell, []);
    groups.get(cell).push(p);
  }
  return groups;
}

/** keys → 'probe:k1,k2'。非法 key 抛错。 */
export function probeRef(keys) {
  if (!Array.isArray(keys) || keys.length === 0) fail('STEP_PROBE_KEY_INVALID', 'probeRef 需要至少一个 key');
  for (const k of keys) {
    if (typeof k !== 'string' || !PROBE_KEY_RE.test(k)) fail('STEP_PROBE_KEY_INVALID', `探针 key 非法: ${JSON.stringify(k)}`);
  }
  return `${PROBE_REF_PREFIX}${keys.join(',')}`;
}

/** 'probe:k1,k2' → { keys } ；不是探针引用或 key 非法/重复 → null。 */
export function parseProbeRef(ref) {
  if (typeof ref !== 'string' || !ref.startsWith(PROBE_REF_PREFIX)) return null;
  const keys = ref.slice(PROBE_REF_PREFIX.length).split(',');
  if (keys.some((k) => !PROBE_KEY_RE.test(k))) return null;
  if (new Set(keys).size !== keys.length) return null;
  return { keys };
}

/**
 * 漂移比对：仓库 YAML 现算（[{key, spec_hash}]）是真身，库行（[{probe_key, spec_hash, active}]）是投影。
 *  - missing：YAML 有、库无（或库里已 active=false）
 *  - extra  ：库有（active）、YAML 无（YAML 删了探针，库没跟）
 *  - changed：两边都有但 spec_hash 不同
 */
export function compareProbeHashes(registryRows, yamlProbes) {
  const db = new Map();
  for (const r of registryRows || []) if (r.active !== false) db.set(r.probe_key, r.spec_hash);
  const yaml = new Map();
  for (const p of yamlProbes || []) yaml.set(p.key, p.spec_hash);
  const missing = []; const changed = []; const same = [];
  for (const [key, hash] of yaml) {
    if (!db.has(key)) missing.push(key);
    else if (db.get(key) !== hash) changed.push(key);
    else same.push(key);
  }
  const extra = [...db.keys()].filter((k) => !yaml.has(k)).sort();
  return { drift: missing.length + extra.length + changed.length > 0, missing, extra, changed, same };
}

export const isSpecHash = (v) => typeof v === 'string' && HEX64.test(v);
