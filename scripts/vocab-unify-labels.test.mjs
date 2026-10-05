/**
 * 词表统一（框架标准 v2.0 术语表，决策 cebd1540）：Dashboard 面向人的文案不再出现 Journey / Golden Path / GP，
 * 统一为 价值流 / 能力。只查 JSX 文本节点与 label/tooltip/title/placeholder 字符串，不查 TypeScript 标识符
 *（标准只规定组织方式，不规定实现命名）。用 node:test，不依赖各 workspace 的 vitest 版本。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const humanStrings = (src) => [
  ...[...src.matchAll(/>([^<>{}]*[A-Za-z一-龥][^<>{}]*)</g)].map((m) => m[1]),
  ...[...src.matchAll(/(?:label|fullLabel|tooltip|title|placeholder):\s*'([^']*)'/g)].map((m) => m[1]),
];
const OLD_WORDS = /Golden Path|Journey|\bGP\b/;

const CASES = [
  ['../apps/api/features/shared/pages/FeatureDashboard.tsx', ['能力覆盖', '能力']],
  ['../apps/api/features/system/pages/LedgerPage.tsx', ['价值流 E2E 路径是否设置']],
  ['../apps/dashboard/src/pages/warroom/WarRoomGoldenPathPage.tsx', ['该能力未关联价值流']],
  ['../apps/dashboard/src/pages/reports/ReportDetailPage.tsx', ['能力拍板控制台']],
];

for (const [rel, expected] of CASES) {
  test(`${rel} 不再对人显示旧词，且出现标准词`, () => {
    const src = read(rel);
    const offenders = humanStrings(src).filter((s) => OLD_WORDS.test(s));
    assert.deepEqual(offenders, [], `仍对人显示旧词：${offenders.join(' | ')}`);
    for (const word of expected) assert.ok(src.includes(word), `缺标准词：${word}`);
  });
}
