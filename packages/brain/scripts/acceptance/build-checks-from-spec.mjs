#!/usr/bin/env node
/**
 * build-checks-from-spec.mjs — 规程 yaml → 可直接喂给 POST /api/brain/acceptance/runs 的 checks 数组
 *
 * 用法：node packages/brain/scripts/acceptance/build-checks-from-spec.mjs [spec.yaml]
 * 输出：JSON { checks, spec_sha, version, stats }
 */
import { loadSpec, buildCells, deriveSets, DEFAULT_SPEC_PATH } from '../../src/acceptance-spec.js';

export function buildChecksFromSpec(filePath = DEFAULT_SPEC_PATH) {
  const { doc, spec_sha, version } = loadSpec(filePath);
  const cells = buildCells(doc);
  const sets = deriveSets(cells);
  const checks = cells.map((c) => ({
    check_key: c.check_key,
    kind: c.kind,
    name: c.name,
    device: null,
    detail: {
      verifiable_by: c.verifiable_by,
      scenario_class: c.scenario_class,
      hard: c.hard,
      step_n: c.step_n,
      step_name: c.step_name,
      fails: c.fails,
    },
  }));
  return {
    checks,
    spec_sha,
    version,
    stats: {
      total: checks.length,
      human_only: sets.humanOnlyList.length,
      machine_db: sets.machineDbList.length,
      hard: sets.hardList.length,
      mandatory: sets.mandatoryScenarioCodes.length,
      unverifiable: sets.unverifiableList.length,
    },
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const out = buildChecksFromSpec(process.argv[2] || DEFAULT_SPEC_PATH);
  console.log(JSON.stringify(out, null, 2));
}
