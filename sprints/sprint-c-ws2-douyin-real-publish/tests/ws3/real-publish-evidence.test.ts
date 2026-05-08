import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '../../../..');
const STATUS_MD = resolve(ROOT, 'packages/workflows/skills/douyin-publisher/STATUS.md');
const EVIDENCE = resolve(ROOT, '.agent-knowledge/content-pipeline-douyin/lead-acceptance-sprint-2.1a.md');
const SCREENSHOTS_DIR = resolve(ROOT, '.agent-knowledge/content-pipeline-douyin/screenshots');

const HISTORY_VIDEO_ITEM_ID = '7605861760767233306';
const HISTORY_IMAGE_ITEM_ID = '7605837846758313266';
const SPRINT_START_TS = new Date('2026-05-08T00:00:00Z').getTime() / 1000;

function extractFreshItemIds(text: string): string[] {
  const all = text.match(/[0-9]{19}/g) || [];
  return all.filter((id) => id !== HISTORY_VIDEO_ITEM_ID && id !== HISTORY_IMAGE_ITEM_ID);
}

describe('Workstream 3 — 真发执行 + 证据回写 STATUS.md [BEHAVIOR]', () => {
  it('STATUS.md 含本次新 item_id（19 位数字 ≠ 7605861760767233306 历史值）', () => {
    const content = readFileSync(STATUS_MD, 'utf8');
    const fresh = extractFreshItemIds(content);
    expect(fresh.length).toBeGreaterThanOrEqual(1);
  });

  it('STATUS.md 历史 item_id 7605861760767233306 含"历史/旧/废弃/已替换"显式标注（前后 2 行内）', () => {
    const content = readFileSync(STATUS_MD, 'utf8');
    const lines = content.split('\n');
    const idx = lines.findIndex((l) => l.includes(HISTORY_VIDEO_ITEM_ID));
    expect(idx).toBeGreaterThanOrEqual(0);
    const window = lines.slice(Math.max(0, idx - 2), Math.min(lines.length, idx + 3)).join('\n');
    expect(window).toMatch(/历史|旧值|废弃|已替换|deprecated|legacy/i);
  });

  it('evidence 含同一个 item_id（与 STATUS.md 一致性）', () => {
    const status = readFileSync(STATUS_MD, 'utf8');
    const evidence = readFileSync(EVIDENCE, 'utf8');
    const fresh = extractFreshItemIds(status);
    expect(fresh.some((id) => evidence.includes(id))).toBe(true);
  });

  it('evidence 含 Lead 真签名（"Cecelia, 2026-05-0X, 自验通过"）', () => {
    const content = readFileSync(EVIDENCE, 'utf8');
    expect(content).toMatch(/Cecelia.*2026-05-0[0-9].*自验通过|Cecelia.*自验通过.*2026-05-0[0-9]/);
  });

  it('evidence 含 CDP 19222 真探活输出', () => {
    const content = readFileSync(EVIDENCE, 'utf8');
    expect(content).toMatch(/webSocketDebuggerUrl|"type":\s*"page"|devtools\/page/);
  });

  it('evidence 含 Mac mini 真触发 batch-publish 的 stdout（PASS / Connected / published 字样之一）', () => {
    const content = readFileSync(EVIDENCE, 'utf8');
    expect(content).toMatch(/PASS:.*item_id|Connected to|published item_id=/);
  });

  it('evidence 含 Windows 路径真 ls 输出（C:\\Users\\xuxia 或 video.mp4 / title.txt 文件名）', () => {
    const content = readFileSync(EVIDENCE, 'utf8');
    const hasWinPath =
      /C:\\Users\\xuxia/.test(content) ||
      /C:\/Users\/xuxia/.test(content) ||
      /xuxia.douyin-media/.test(content) ||
      /video\.mp4/.test(content) ||
      /title\.txt/.test(content);
    expect(hasWinPath).toBe(true);
  });

  it('screenshots/ 含 ≥ 3 张真截图文件', () => {
    const files = readdirSync(SCREENSHOTS_DIR).filter((f) => /\.(png|jpe?g|gif)$/i.test(f));
    expect(files.length).toBeGreaterThanOrEqual(3);
  });

  it('每张截图 mtime ≥ sprint 启动日 2026-05-08（防止重用历史截图）', () => {
    const files = readdirSync(SCREENSHOTS_DIR).filter((f) => /\.(png|jpe?g|gif)$/i.test(f));
    for (const f of files) {
      const fp = resolve(SCREENSHOTS_DIR, f);
      const mtime = statSync(fp).mtimeMs / 1000;
      expect(mtime).toBeGreaterThanOrEqual(SPRINT_START_TS);
    }
  });

  it('evidence mtime ≥ sprint 启动日 2026-05-08（防止重用旧 evidence）', () => {
    expect(existsSync(EVIDENCE)).toBe(true);
    const mtime = statSync(EVIDENCE).mtimeMs / 1000;
    expect(mtime).toBeGreaterThanOrEqual(SPRINT_START_TS);
  });
});
