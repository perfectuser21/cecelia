#!/usr/bin/env node
// goldset-eval.mjs — LLM 判定器金标集 eval（CI job goldset-eval 的执行体）
// 输入固定（静态截图金标集），断言形式 = 通过率 ≥ 阈值（阈值棘轮只许升，登记在
// scripts/ratchet-registry.json 指标 goldset_eval_threshold）。
// 外部服务(toapis)不可用 = 诚实红（failure-without-reason 反面），不 skip。
// 用法: TOAPIS_API_KEY=... TOAPIS_BASE_URL=... node goldset-eval.mjs [--model gpt-5.5]
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { judgeScreenshot } from '../src/judge.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GOLDSET_DIR = path.join(__dirname, '../goldset');
const THRESHOLD_PATH = path.join(__dirname, '../eval-threshold.json');

const MODEL = process.argv.includes('--model')
  ? process.argv[process.argv.indexOf('--model') + 1]
  : (process.env.GOLDSET_EVAL_MODEL || 'gpt-5.5');

const BASE_URL = process.env.TOAPIS_BASE_URL;
const API_KEY = process.env.TOAPIS_API_KEY;
if (!BASE_URL || !API_KEY) {
  console.error('❌ 缺 TOAPIS_BASE_URL / TOAPIS_API_KEY（CI: secrets；本地: source ~/.credentials/toapis.env）');
  process.exit(1);
}

async function visionFn(system, user, imgPath) {
  const b64 = readFileSync(imgPath).toString('base64');
  const body = {
    model: MODEL,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: [
        { type: 'text', text: user },
        { type: 'image_url', image_url: { url: `data:image/png;base64,${b64}` } },
      ] },
    ],
    temperature: 0,
    max_tokens: 400,
  };
  const r = await fetch(`${BASE_URL.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    // 留真实原因（failure-without-reason 病的反面）
    const errBody = await r.text().catch(() => '');
    console.error(`  ⚠️ LLM HTTP ${r.status}: ${errBody.slice(0, 200)}`);
    return null;
  }
  const j = await r.json();
  return j.choices?.[0]?.message?.content ?? null;
}

const manifest = JSON.parse(readFileSync(path.join(GOLDSET_DIR, 'manifest.json'), 'utf8'));
const threshold = JSON.parse(readFileSync(THRESHOLD_PATH, 'utf8'));

console.log(`🧪 goldset eval — judge=${manifest.judge} model=${MODEL} samples=${manifest.samples.length} threshold=${threshold.pass_rate_min}`);

let pass = 0;
const results = [];
for (const s of manifest.samples) {
  const imgPath = path.join(GOLDSET_DIR, s.file);
  const verdict = await judgeScreenshot({
    visionFn,
    judge: manifest.judge,
    imgPath,
    params: manifest.params,
  });
  const correct = verdict.ok === s.expected;
  if (correct) pass++;
  results.push({ file: s.file, label: s.label, expected: s.expected, got: verdict.ok, correct, why: verdict.why });
  console.log(`  ${correct ? '✅' : '❌'} ${s.label} expected=${s.expected} got=${verdict.ok}${verdict.why ? ` (${verdict.why.slice(0, 60)})` : ''}`);
}

const passRate = pass / manifest.samples.length;
console.log(JSON.stringify({ pass, total: manifest.samples.length, pass_rate: passRate, threshold: threshold.pass_rate_min, model: MODEL }, null, 2));

if (passRate < threshold.pass_rate_min) {
  console.error(`❌ 通过率 ${passRate.toFixed(2)} < 阈值 ${threshold.pass_rate_min}（棘轮只许升，不许为过 CI 调低阈值）`);
  process.exit(1);
}
console.log(`✅ 通过率 ${passRate.toFixed(2)} ≥ 阈值 ${threshold.pass_rate_min}`);
