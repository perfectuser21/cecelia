import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { qaScreenshotDeclarations } from '../lib/evidence.mjs';
import { screenshotProblems, parseQaReport } from '../lib/qa-report.mjs';
import { compileQaReport } from '../lib/native-evidence.mjs';

const roots = [];
afterEach(() => { for (const dir of roots.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aV1sAAAAASUVORK5CYII=', 'base64');
function guard(declared, present) {
  const sprintDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-shot-path-')); roots.push(sprintDir);
  const shotsDir = path.join(sprintDir, 'qa-r1'); fs.mkdirSync(shotsDir);
  fs.writeFileSync(path.join(shotsDir, present), png);
  // 与控制器编译相同的真实声明提取，再交原有截图门；路径不能被Markdown标签清洗改写。
  const reportText = qaScreenshotDeclarations(`**截图**: qa-r1/${declared}\n`).join('\n');
  return screenshotProblems({ reportText, items: [], executions: [], sprintDir, shotsDir });
}

describe('编译截图声明必须保留路径中的双下划线', () => {
  it('missing__shot不存在时不能因missingshot存在而吞掉原missing错误', () => {
    expect(guard('missing__shot.png', 'missingshot.png')).toEqual(['screenshot_missing:qa-r1/missing__shot.png']);
  });
  it('真实actual__shot存在时不能检查改写后的actualshot并误拒', () => {
    expect(guard('actual__shot.png', 'actual__shot.png')).toEqual([]);
  });
});

describe('新QA原生字段仅规范标签，不改写payload中的双下划线', () => {
  const fm = '---\ntask_id: 088c3431-57ca-4f2a-8a50-14601518e2a2\nstep: evaluate\nupstream: []\n---\n';
  const fence = '```';
  const command = 'cat proof.txt';
  const block = `${fence}command\n${command}\n${fence}\n${fence}output\nidentical\n${fence}\n`;
  it('显式one__id不得折叠成同命令同输出的oneid并绑定另一执行', () => {
    const commands = ['one__id', 'oneid'].map(item_id => ({ item_id, command, output: 'identical\n', exit_code: 0 }));
    const draft = `${fm}### T-1\n对应: Q-1\nverdict: PASS\n**native_item_id**: one__id\nexit_code: 0\n${block}`;
    const parsed = parseQaReport(draft, { draft: true, executions: commands });
    const compiled = compileQaReport(draft, parsed, commands, { task_id: 'fixture', round: 1 });
    const reread = parseQaReport(compiled);
    expect(parsed.errors).toEqual([]);
    expect(reread.errors).toEqual([]);
    expect(reread.tests[0].native_item_id).toBe('one__id');
    expect(parsed.tests[0].native_item_id).toBe('one__id');
  });
  it('CANT原因与X场景中的真实__路径须原样保留，外层加粗标签仍可识别', () => {
    const reason = '无法读取 qa-r1/report__part.txt';
    const scene = 'qa-r1/screen__name.png';
    const draft = `${fm}### T-1\n对应: Q-1\nverdict: CANNOT_VERIFY\n**原因**: ${reason}\n${block}### X-1\n对应: I-1\nverdict: FAIL\n**严重度**: **阻断**\n**场景**: ${scene}\n${block}`;
    const parsed = parseQaReport(draft);
    expect(parsed.errors).toEqual([]);
    expect(parsed.findings[0].severity).toBe('阻断');
    expect({ reason: parsed.tests[0].reason, scene: parsed.findings[0].scene }).toEqual({ reason, scene });
  });
});
