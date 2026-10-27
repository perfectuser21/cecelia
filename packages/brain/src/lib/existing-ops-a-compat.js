/** 有限 A 版本适配：整组已审 AST 成立后复用旧调用证明，证据始终是实际源字节。 */
import { posix } from 'node:path';
import { A_ENVELOPES } from './existing-ops-a-envelopes.js';
const PREFIX = 'packages/brain/scripts/coding-workflow/';
const canonical = value => JSON.stringify(value, (key, item) => ['start', 'end', 'raw'].includes(key) ? undefined : item);
const expected = new Map();
function same(text, reference, parse) {
  if (!expected.has(reference)) expected.set(reference, canonical(parse(reference)));
  return canonical(parse(text)) === expected.get(reference);
}
// 这些非 import 的输入由完整已审源码中的 URL / 常量 / spawn 参数实际指定。
const FIXED_EDGES = [
  ['__tests__/helpers/brain-transport.mjs', '__tests__/fixtures/brain-fetch-preload.mjs', 'reviewed_test_fetch_preload'],
  ['runner/__tests__/helpers/sandbox.mjs', 'runner/__tests__/fixtures/executor-ipc-preload.mjs', 'reviewed_test_executor_relay'],
  ['runner/__tests__/helpers/sandbox.mjs', 'runner/__tests__/fixtures/fake-executor.mjs', 'reviewed_test_executor_path'],
  ['runner/__tests__/fixtures/executor-ipc-preload.mjs', '__tests__/fixtures/brain-fetch-preload.mjs', 'reviewed_test_relay_fetch_preload'],
  ['runner/__tests__/fixtures/fake-executor.mjs', 'runner/__tests__/helpers/owned-processes.mjs', 'reviewed_test_owned_process_module'],
];
export async function reviewedAContext({ parse, paths, readSource, revision }) {
  const originals = new Map();
  try {
    // 不识别旧版本时不追加输入，历史来源摘要不变。新旧混配不能获得适配。
    for (const path of Object.keys(A_ENVELOPES.legacy)) {
      if (!paths.includes(path)) return null;
      const text = await readSource(path, revision);
      if (!same(text, A_ENVELOPES.reviewed[path], parse)) return null;
      originals.set(path, text);
    }
    for (const [path, reference] of Object.entries(A_ENVELOPES.reviewed)) {
      if (!paths.includes(path)) return null;
      const text = originals.get(path) ?? await readSource(path, revision);
      if (!same(text, reference, parse)) return null;
      originals.set(path, text);
    }
  } catch { return null; }
  const edges = [];
  for (const [path, text] of originals) for (const statement of parse(text).body) {
    if (statement.type !== 'ImportDeclaration' || !statement.source.value.startsWith('.')) continue;
    const target = posix.normalize(posix.join(posix.dirname(path), statement.source.value));
    if (originals.has(target)) edges.push([path, target, 'reviewed_a_static_import']);
  }
  edges.push(...FIXED_EDGES.map(([a, b, kind]) => [PREFIX + a, PREFIX + b, kind]));
  return {
    // 只影响已审四文件的证明输入，不影响真实 read() 所登记的绑定摘要。
    normalize(path, text) {
      if (originals.has(path) && originals.get(path) !== text) throw Error('reviewed_a_source_changed');
      return Object.hasOwn(A_ENVELOPES.legacy, path) ? A_ENVELOPES.legacy[path] : text;
    },
    async record({ read, relations }) {
      for (const [path, bytes] of originals) {
        if (await read(path) !== bytes) throw Error('reviewed_a_source_changed');
      }
      for (const [consumer_path, input_path, kind] of edges) {
        if (!relations.some(r => r.consumer_path === consumer_path && r.input_path === input_path && r.kind === kind))
          relations.push({ consumer_path, input_path, kind, revision });
      }
    },
  };
}
