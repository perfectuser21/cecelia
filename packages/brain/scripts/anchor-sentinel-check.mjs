#!/usr/bin/env node
/**
 * anchor-sentinel-check.mjs — 锚点断锚数检查(nightly 哨兵调用)
 * 输出最后一行为 JSON: { broken, total, covered }
 */
const BRAIN_URL = process.env.BRAIN_URL || 'http://localhost:5221';

async function main() {
  const resp = await fetch(`${BRAIN_URL}/api/brain/graph/anchor-coverage`);
  if (!resp.ok) {
    console.error(`anchor-coverage 端点返回 HTTP ${resp.status}`);
    process.exit(1);
  }
  const data = await resp.json();
  const result = {
    broken: data.broken,
    total: data.anchor_coverage.total_features,
    covered: data.anchor_coverage.covered_by_graph,
  };
  console.log(JSON.stringify(result));
}

main().catch((err) => {
  console.error(`anchor-sentinel-check 失败: ${err.message}`);
  process.exit(1);
});
