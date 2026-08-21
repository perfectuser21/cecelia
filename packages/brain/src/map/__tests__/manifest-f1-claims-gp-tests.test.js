// r35（run e1f52e3f）第六层回归：generator-fix 按产物闸（lint-gp-anchor-artifact）规矩
// 新增 tests/gp/f1/step3 断言文件，Map manifest F1 的 path_prefixes 不含 tests/ →
// radius 判 unclaimed → freshness=unknown(impact_anchor_missing) → 生产 diff-gate 3a
// 折叠 mapper_stale + retryable:true → evaluator dispatch 无限 backoff（f9f943fc 同源）。
// 两个闸对撞：产物闸强制产出 tests/gp 断言，Map 认领清单却不认这条路径。
// 修：F1（开发闭环）认领 tests/gp/——GP 步骤断言正是开发闭环的产物。
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MANIFEST = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../config/map-manifests/cecelia.v1.json',
);

describe('cecelia map manifest：F1 认领 GP 步骤断言路径', () => {
  it('F1 path_prefixes 含 tests/gp/（产物闸强制产出的路径必须被认领）', () => {
    const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
    const f1 = manifest.capabilities.find((cap) => cap.key === 'F1');
    expect(f1, 'manifest 必须有 F1').toBeTruthy();
    expect(f1.path_prefixes).toContain('tests/gp/');
  });
});
