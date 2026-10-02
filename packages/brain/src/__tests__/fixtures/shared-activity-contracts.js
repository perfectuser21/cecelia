import { createHash } from 'node:crypto';
import yaml from 'js-yaml';
export const HEAD = 'a'.repeat(40);
export const KEYS = ['preflight','discovery','qualification','collection','scoring','delivery','outreach','cleanup'];
const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(',')}]` : value && typeof value === 'object'
  ? `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}` : JSON.stringify(value);
export const hash = value => createHash('sha256').update(canonical(value)).digest('hex');
export function contractsFixture() {
  const keyword = { capability: 'keyword_acquisition', workflow: 'social-keyword-leadgen', activities: KEYS.map((key, i) => ({
    key, name: key, order: i + 1, version: '1.0.0', steps: [{ key: `${key}_step`, order: 1, implementation: { status: 'missing' } }],
  })) };
  const benchmark = { capability: 'benchmark_link_acquisition', workflow: 'social-benchmark-leadgen', activities: KEYS.map(key => key === 'discovery'
    ? { ...keyword.activities[1], name: '对标发现' } : { ref: `keyword_acquisition.${key}` }) };
  const docs = { keyword_acquisition: keyword, benchmark_link_acquisition: benchmark };
  const digest = { capabilities: {} };
  for (const [cap, doc] of Object.entries(docs)) {
    const activities = doc.activities.map(a => a.ref ? { ...keyword.activities.find(x => x.key === a.ref.split('.')[1]), from: 'keyword_acquisition' } : { ...a, from: cap });
    digest.capabilities[cap] = { sha256: hash({ ...doc, activities }), activities: Object.fromEntries(activities.map(a => [a.key, hash(a)])) };
  }
  const calls = [];
  const fetchFn = async url => {
    calls.push(url);
    const text = url.includes('/commits/main') ? HEAD : url.includes('generated/contracts.json') ? JSON.stringify(digest)
      : yaml.dump(docs[url.match(/contracts\/(\w+)\.yaml/)?.[1]]);
    return { ok: true, text: async () => text };
  };
  return { docs, digest, calls, fetchFn, resolveToken: async () => 'test' };
}
