// F1「工厂 · 开发闭环」步骤 1 —— 边：工具链在 Windows 上解析自身目录
//
// Regression（2026-09-07 xian-rog 首跑实测）：
//
//   Error: ENOENT: no such file or directory,
//     open 'C:\C:\Users\asus\phone-crystal\verify-open_publish-1788743259703.json'
//
// 根因是 file URL 转路径的经典坑：`new URL(import.meta.url).pathname` 在 Windows 上
// 返回 `/C:/Users/asus/...`（带前导斜杠），再 join 就拼成了 `C:\C:\...` 双盘符。
// 正确做法是 node:url 的 fileURLToPath()，它按平台正确剥离前导斜杠。
//
// 两个受害点，危险程度不同：
//   crystal-verify.mjs — 写证据文件时炸，响；
//   replay.mjs         — 算 registry.json 的路径，**读不到不会报错**，
//                        只会当成「没学过这个设备」转而走视觉回源重新学坐标。
//                        也就是说热路径静默退化成烧 token 的冷路径，
//                        crystallized 判定还照样是 true —— 这种沉默的假成功最贵。
//
// 因此本文件配两道守卫：功能正确性 + 源码里不许再出现那个模式。

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { moduleDir } from '../../../packages/quality/phone-crystal/platform.mjs';

const PC_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../../packages/quality/phone-crystal');

describe('F1 step1 · 模块目录解析不产生双盘符', () => {
  it('POSIX file URL → 正常目录', () => {
    expect(moduleDir('file:///home/u/phone-crystal/replay.mjs')).toBe('/home/u/phone-crystal');
  });

  it('解析结果不带 file URL 的前导斜杠残留（Windows 上即 /C: → C:）', () => {
    const d = moduleDir(import.meta.url);
    expect(d).not.toMatch(/^\/[A-Za-z]:/);
    expect(d).not.toContain('file:');
  });

  it('拼出来的路径能真的读到文件（端到端，不是只比字符串）', () => {
    const seq = join(moduleDir(`file://${PC_DIR}/replay.mjs`), 'sequences', 'open_publish.json');
    expect(() => JSON.parse(readFileSync(seq, 'utf8'))).not.toThrow();
  });
});

describe('F1 step1 · 源码里不许再用会崩的那个写法', () => {
  it('没有任何 .mjs 用 new URL(import.meta.url).pathname 算路径', () => {
    const offenders = readdirSync(PC_DIR)
      .filter((f) => f.endsWith('.mjs'))
      .filter((f) => /new URL\(\s*import\.meta\.url\s*\)\s*\.pathname/.test(readFileSync(join(PC_DIR, f), 'utf8')));
    expect(offenders).toEqual([]);
  });
});
