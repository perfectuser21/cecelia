// Smoke test: skill-eval Form B 渲染器/schema/worker 模块可加载 + 核心函数用真实 fixture 跑通
// 不连真实 DB、不 spawn 真实 claude 进程（CI 没有这些依赖），只验证纯函数逻辑完整。
import { validateReportData } from '../../src/skill-eval-report-schema.js';
import { renderReportHtml, renderReportBody, renderComparePage } from '../../src/skill-eval-report-render.js';
import { sanitizeJsonString, extractReportJson } from '../skill-eval-worker.js';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(__dirname, '../../src/__tests__/fixtures/report_data8-real.json');
const realFixture = JSON.parse(readFileSync(fixturePath, 'utf8'));

function fail(msg) {
  console.error('FAIL: ' + msg);
  process.exit(1);
}

// validateReportData 对真实 pipeline fixture 判定合法
const v = validateReportData(realFixture);
if (!v.valid) fail('validateReportData rejected real fixture: ' + v.errors.join(','));

// renderReportHtml 用真实 fixture 出图，不落 fallback
const html = renderReportHtml(realFixture);
if (!html.startsWith('<!doctype html>')) fail('renderReportHtml did not produce full HTML page');
if (html.includes('报告数据不完整')) fail('renderReportHtml fell back on valid fixture');
if (typeof renderReportBody !== 'function' || typeof renderComparePage !== 'function') {
  fail('renderReportBody/renderComparePage export missing');
}

// worker 纯函数：JSON 加固逻辑可用（模拟一段内部含未转义双引号的 JSON，与 skill-eval-worker.test.js 用的坏样例一致：
// 中文场景下引号紧贴前后字符，没有空白分隔，才是 sanitizeJsonString 设计要处理的情形）
const broken = '{"skill":{"name":"x"},"verdict":{"level":"pass"},"summary":"他说"你好"了","anatomy":{"pipeline":[],"outputs":[]}}';
let threw = false;
try {
  JSON.parse(broken);
} catch {
  threw = true;
}
if (!threw) fail('broken fixture unexpectedly parsed as-is');
const cleaned = sanitizeJsonString(broken);
JSON.parse(cleaned);

const reportData = { skill: { name: 'x' }, verdict: { level: 'pass' }, anatomy: { pipeline: [], outputs: [] } };
const stdout = JSON.stringify({ type: 'result', result: JSON.stringify(reportData) });
const extracted = extractReportJson(stdout);
if (extracted.skill.name !== 'x') fail('extractReportJson roundtrip broken');

console.log('OK: skill-eval Form B smoke passed');
