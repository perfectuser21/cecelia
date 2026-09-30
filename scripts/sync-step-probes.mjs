#!/usr/bin/env node
/**
 * sync-step-probes — 仓库探针 YAML（SSOT）→ Brain step_probes 注册表 + 格子 assertion_ref 绑定。
 * 链 bf5088a3 棒2，决策 702949b6；assertion_ref 由流水线副作用写（决策 df1ccf5a）。
 *
 * 用法：
 *   node scripts/sync-step-probes.mjs <checks.yaml> --journey-id <uuid> [--brain-url http://localhost:5221] [--check] [--token <t>]
 *
 * 流程：读 YAML → 归一化 + 逐条 spec_hash=sha256(canonical JSON) + 整文件 source_sha256（同 probes-lib）
 *   → GET 该 journey 的格子（cells=1）
 *   → 每条探针按 journey_cell（stage:<name>）找 cell，找不到就报错退出（不静默）
 *   → 挂点（迁移 496）：探针带 target:{type:step|enabler, key} 时 GET /steps?key= 或 /enablers?key= 解析 target_id，
 *     查不到报错退出；不带 target → target_type=activity、target_id=活动格的 step_id
 *   → POST /api/brain/step-probes 按 probe_key upsert（带 journey_step_link_id + target_type/target_id）
 *   → 每个格子 PATCH assertion_ref = probe:<k1>[,<k2>…]（已一致则不 PATCH，避免无谓 bump assertion_revision）；
 *     带 target 的探针若 journey 下已有 step:<key> / enabler:<key> 格子（迁移 496 生成）则额外绑到该格（没有则只绑活动格）
 * --check：只 POST /step-probes/drift-check 比对哈希，不写库；有漂移退 1。
 * token：--token 或 env CECELIA_INTERNAL_TOKEN（Brain 配了 token 时必带）。
 * stdout 最后一行 = JSON 结果；exit 0 成功 / 1 漂移或校验失败 / 2 用法错误。
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import yaml from 'js-yaml';
import {
  groupProbesByCell, parseProbesDocument, probeRef, sourceSha256, stepProbeError,
} from '../packages/brain/src/lib/step-probe-spec.js';

const USAGE = '用法: node scripts/sync-step-probes.mjs <checks.yaml> --journey-id <uuid> [--brain-url URL] [--check] [--token T]';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseCliArgs(argv) {
  const args = { yamlPath: undefined, journeyId: undefined, brainUrl: 'http://localhost:5221', check: false, token: undefined };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--journey-id') args.journeyId = argv[++i];
    else if (a === '--brain-url') args.brainUrl = argv[++i];
    else if (a === '--token') args.token = argv[++i];
    else if (a === '--check') args.check = true;
    else if (a.startsWith('--')) throw new Error(`${USAGE}\n未知参数 ${a}`);
    else args.yamlPath = a;
  }
  if (!args.yamlPath) throw new Error(`${USAGE}\n缺少 YAML 路径`);
  if (!args.journeyId || !UUID_RE.test(args.journeyId)) throw new Error(`${USAGE}\n--journey-id 必须是 uuid`);
  if (args.brainUrl) args.brainUrl = args.brainUrl.replace(/\/+$/, '');
  return args;
}

/** 读 YAML → parseProbesDocument + source_sha256（原文 sha256，同 probes-lib）；非法 spec 抛 STEP_PROBE_*，不吞。 */
export function loadProbesYaml(yamlPath, { readFileFn = readFileSync } = {}) {
  const text = readFileFn(yamlPath, 'utf8');
  return { ...parseProbesDocument(yaml.load(text)), source_sha256: sourceSha256(text) };
}

async function call(fetchFn, url, { method = 'GET', body, token } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['X-Internal-Token'] = token;
  const res = await fetchFn(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  let json = null;
  try { json = await res.json(); } catch { json = null; }
  if (!res.ok) {
    throw stepProbeError('STEP_PROBE_SYNC_HTTP', `${method} ${url} → HTTP ${res.status}: ${JSON.stringify(json)}`, { status: res.status });
  }
  return json;
}

/**
 * @param {object} p
 * @param {{version:number, workflow:string, probes:Array<{spec:object, spec_hash:string}>}} p.doc
 * @param {string} p.journeyId
 * @param {string} [p.sourcePath] 写进 step_probes.source_path（仓库相对路径）
 * @param {string} [p.brainUrl]
 * @param {Function} [p.fetchFn]
 * @param {string} [p.token]
 * @param {boolean} [p.check] 只比对不写
 */
export async function syncStepProbes({
  doc, journeyId, sourcePath = null, brainUrl = 'http://localhost:5221', fetchFn = globalThis.fetch, token, check = false,
}) {
  const base = brainUrl.replace(/\/+$/, '');
  const groups = groupProbesByCell(doc.probes);

  if (check) {
    const result = await call(fetchFn, `${base}/api/brain/step-probes/drift-check`, {
      method: 'POST', token,
      body: { workflow: doc.workflow, source_sha256: doc.source_sha256 ?? null, probes: doc.probes.map((p) => ({ key: p.spec.key, spec_hash: p.spec_hash })) },
    });
    return { check: true, workflow: doc.workflow, ...result };
  }

  const cells = await call(fetchFn, `${base}/api/brain/journey_step_links?journey_id=${journeyId}&cells=1&limit=500`, { token });
  const byKey = new Map((Array.isArray(cells) ? cells : []).map((c) => [c.cell_key, c]));
  const missingCells = [...groups.keys()].filter((k) => !byKey.has(k));
  if (missingCells.length) {
    throw stepProbeError('STEP_PROBE_CELL_NOT_FOUND',
      `journey ${journeyId} 下找不到格子: ${missingCells.join(', ')}（先建 cell，再同步探针）`, { cells: missingCells });
  }

  const targets = await resolveTargets(doc.probes, { base, fetchFn, token });

  const payload = {
    workflow: doc.workflow,
    source_path: sourcePath,
    source_sha256: doc.source_sha256 ?? null,
    probes: doc.probes.map((p) => {
      const cell = byKey.get(p.spec.journey_cell);
      const target = targets.get(p.spec.key) ?? (cell.step_id ? { target_type: 'activity', target_id: cell.step_id } : {});
      return { ...p.spec, journey_step_link_id: cell.id, ...target };
    }),
  };
  const { upserted = [] } = await call(fetchFn, `${base}/api/brain/step-probes`, { method: 'POST', body: payload, token });

  // 活动格照绑（翻色单位）；带 target 的探针另绑 step:<key> / enabler:<key> 格（格子存在才绑）
  const bindings = new Map(groups);
  for (const p of doc.probes) {
    if (!p.spec.target) continue;
    const cellKey = `${p.spec.target.type}:${p.spec.target.key}`;
    if (!byKey.has(cellKey)) continue;
    if (!bindings.has(cellKey)) bindings.set(cellKey, []);
    bindings.get(cellKey).push(p);
  }

  const bound = [];
  for (const [cellKey, probes] of bindings) {
    const cell = byKey.get(cellKey);
    const ref = probeRef(probes.map((p) => p.spec.key));
    const changed = cell.assertion_ref !== ref;
    if (changed) {
      await call(fetchFn, `${base}/api/brain/journey_step_links/${cell.id}`, { method: 'PATCH', body: { assertion_ref: ref }, token });
    }
    bound.push({ cell_key: cellKey, journey_step_link_id: cell.id, assertion_ref: ref, changed });
  }
  return { check: false, workflow: doc.workflow, journey_id: journeyId, upserted, bound };
}

/** 带 target 的探针 → Map<probe_key, {target_type, target_id}>；step 查 /steps?key=，enabler 查 /enablers?key=，查不到抛错。 */
async function resolveTargets(probes, { base, fetchFn, token }) {
  const out = new Map();
  const cache = new Map();
  for (const p of probes) {
    const target = p.spec.target;
    if (!target || target.type === 'activity') continue; // activity = 缺省路径（活动格的 step_id）
    const cacheKey = `${target.type}:${target.key}`;
    if (!cache.has(cacheKey)) {
      const path = target.type === 'step' ? 'steps' : 'enablers';
      const json = await call(fetchFn, `${base}/api/brain/${path}?key=${encodeURIComponent(target.key)}`, { token });
      const rows = Array.isArray(json?.[path]) ? json[path] : [];
      cache.set(cacheKey, rows.find((r) => r.key === target.key)?.id ?? null);
    }
    const id = cache.get(cacheKey);
    if (!id) {
      throw stepProbeError('STEP_PROBE_TARGET_NOT_FOUND',
        `探针 ${p.spec.key}: Brain 里找不到 ${target.type} ${target.key}（先 sync-steps / 登记 enabler，再同步探针）`, { probe_key: p.spec.key });
    }
    out.set(p.spec.key, { target_type: target.type, target_id: id });
  }
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let args;
  try {
    args = parseCliArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err.message);
    process.exit(2);
  }
  try {
    const doc = loadProbesYaml(args.yamlPath);
    const result = await syncStepProbes({
      doc, journeyId: args.journeyId, sourcePath: args.yamlPath, brainUrl: args.brainUrl,
      token: args.token ?? process.env.CECELIA_INTERNAL_TOKEN, check: args.check,
    });
    console.log(JSON.stringify(result));
    process.exit(result.check && result.drift ? 1 : 0);
  } catch (err) {
    console.error(`[sync-step-probes] ${err.code || 'ERROR'}: ${err.message}`);
    process.exit(1);
  }
}
