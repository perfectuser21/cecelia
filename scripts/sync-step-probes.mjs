#!/usr/bin/env node
/**
 * sync-step-probes — 仓库探针 YAML（SSOT）→ Brain step_probes 注册表 + 格子 assertion_ref 绑定。
 * 链 bf5088a3 棒2，决策 702949b6；assertion_ref 由流水线副作用写（决策 df1ccf5a）。
 *
 * 用法：
 *   node scripts/sync-step-probes.mjs <checks.yaml> --journey-id <uuid> [--brain-url http://localhost:5221] [--check] [--token <t>]
 *
 * 流程：读 YAML → 归一化 + spec_hash=sha256(canonical JSON) → GET 该 journey 的格子（cells=1）
 *   → 每条探针按 journey_cell（stage:<name>）找 cell，找不到就报错退出（不静默）
 *   → POST /api/brain/step-probes 按 probe_key upsert（带 journey_step_link_id）
 *   → 每个格子 PATCH assertion_ref = probe:<k1>[,<k2>…]（已一致则不 PATCH，避免无谓 bump assertion_revision）
 * --check：只 POST /step-probes/drift-check 比对哈希，不写库；有漂移退 1。
 * token：--token 或 env CECELIA_INTERNAL_TOKEN（Brain 配了 token 时必带）。
 * stdout 最后一行 = JSON 结果；exit 0 成功 / 1 漂移或校验失败 / 2 用法错误。
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import yaml from 'js-yaml';
import {
  groupProbesByCell, parseProbesDocument, probeRef, stepProbeError,
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

/** 读 YAML → parseProbesDocument（非法 spec 抛 STEP_PROBE_*，不吞）。 */
export function loadProbesYaml(yamlPath, { readFileFn = readFileSync } = {}) {
  return parseProbesDocument(yaml.load(readFileFn(yamlPath, 'utf8')));
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
      body: { workflow: doc.workflow, probes: doc.probes.map((p) => ({ key: p.spec.key, spec_hash: p.spec_hash })) },
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

  const payload = {
    workflow: doc.workflow,
    source_path: sourcePath,
    probes: doc.probes.map((p) => ({ ...p.spec, journey_step_link_id: byKey.get(p.spec.journey_cell).id })),
  };
  const { upserted = [] } = await call(fetchFn, `${base}/api/brain/step-probes`, { method: 'POST', body: payload, token });

  const bound = [];
  for (const [cellKey, probes] of groups) {
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
