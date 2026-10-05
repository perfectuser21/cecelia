/**
 * 词表统一（框架标准 v2.0 术语表，决策 cebd1540）：面向人的文案不再出现 Journey / Golden Path / GP，
 * 统一为 价值流 / 能力。只查 JSX 文本与 tooltip/label 字符串，不查 TypeScript 标识符（标准不规定实现命名）。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
// 只抓"给人看"的位置：JSX 文本节点（>…<）与 label/tooltip/fullLabel 字符串值
const humanStrings = (src: string) => [
  ...[...src.matchAll(/>([^<>{}]*[A-Za-z一-龥][^<>{}]*)</g)].map((m) => m[1]),
  ...[...src.matchAll(/(?:label|fullLabel|tooltip|title|placeholder):\s*'([^']*)'/g)].map((m) => m[1]),
];
const OLD_WORDS = /Golden Path|Journey|\bGP\b/;

describe('词表统一 — 面向人的文案', () => {
  it.each([
    ['./FeatureDashboard.tsx', ['能力覆盖', '能力']],
    ['../../system/pages/LedgerPage.tsx', ['价值流 E2E 路径是否设置']],
    ['../../../../dashboard/src/pages/warroom/WarRoomGoldenPathPage.tsx', ['该能力未关联价值流']],
    ['../../../../dashboard/src/pages/reports/ReportDetailPage.tsx', ['能力拍板控制台']],
  ])('%s 不再对人显示旧词，且出现标准词', (rel, expected) => {
    const src = read(rel);
    const offenders = humanStrings(src).filter((s) => OLD_WORDS.test(s));
    expect(offenders, `仍对人显示旧词：${offenders.join(' | ')}`).toEqual([]);
    for (const word of expected) expect(src).toContain(word);
  });
});
