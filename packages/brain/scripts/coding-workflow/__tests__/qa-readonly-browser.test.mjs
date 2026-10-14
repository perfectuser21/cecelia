import { it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { screenshotProblems } from '../lib/qa-report.mjs';
const fixtures = JSON.parse(fs.readFileSync(new URL('./fixtures/qa-readonly-browser.json', import.meta.url), 'utf8'));
const check = (command) => screenshotProblems({ items: [{ id: 'T', command }], shotsDir: '/__cw_missing_shots__', executions: [] });

it.each(fixtures)('真实 $id 原文只读检查不启动浏览器，不应要求截图', ({ command }) => {
  expect(check(command)).toEqual([]);
});

it.each([
  'npx playwright screenshot http://localhost:5301 shot.png',
  'node -e \'require("playwright").chromium.launch()\'',
  'node -e \'require("puppeteer").launch()\'',
  'node -e \'eval("require(\\"playwright\\").chromium.launch()")\'',
  ...fixtures.flatMap(({command}) => [
    command + '; npx playwright screenshot http://localhost:5301 shot.png',
    command.replace('const fs=require("fs")', 'const fs=require("playwright")'),
    command.replace('const fs=require("fs")', 'let fs=require("fs")'),
    command.replace('const fs=require("fs")', 'const fs=require("fs");fs.readFileSync=()=>"playwright";const unused=1'),
  ]),
])('浏览器调用及未知副作用不得豁免：%s', command => {
  expect(check(command)).toEqual(['screenshot_none:T']);
});

it('真实截图要求及截图文件存在性检查保留', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-browser-shots-'));
  try {
    fs.writeFileSync(path.join(root, 'shot.png'), 'fixture');
    expect(screenshotProblems({ items: [{id:'T',command:'npx playwright screenshot http://localhost:5301 shot.png'}], shotsDir: root })).toEqual([]);
    expect(screenshotProblems({ reportText: '截图: missing.png', sprintDir: root, items: [], shotsDir: root })).toEqual(['screenshot_missing:missing.png']);
  } finally { fs.rmSync(root, {recursive:true,force:true}); }
});
