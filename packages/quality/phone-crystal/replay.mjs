#!/usr/bin/env node
// replay.mjs — phone-pub 回放器(Skill-DisCo 形态,决策 ca9f3d7b/28ca1f69)
// 热路径:序列(代码/声明式 JSON)+ registry 坐标 → 零 token 导航;
// LLM 只留两处:postcondition 判定(XML 白给用 XML,否则视觉)+ registry miss 时视觉回源。
// 用法: node replay.mjs --sequence sequences/search_account.json --target <账号> [--json]
import fs from 'node:fs';
import path from 'node:path';
import * as L from './lib.mjs';
import { evaluatePostcondition } from './postcondition.mjs';

const args = {};
for (let i = 2; i < process.argv.length; i += 2) args[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];
if (!args.sequence) { console.error('need --sequence'); process.exit(2); }

const seq = JSON.parse(fs.readFileSync(args.sequence, 'utf8'));
const REG = path.join(path.dirname(new URL(import.meta.url).pathname), 'registry.json');
const regKey = () => `${L.deviceModel()}|${L.appVersion()}|${L.density()}`;
const loadReg = () => (fs.existsSync(REG) ? JSON.parse(fs.readFileSync(REG, 'utf8')) : {});
const saveReg = (r) => fs.writeFileSync(REG, JSON.stringify(r, null, 2));

const stat = { cacheHits: 0, visionCalls: 0 };

// 四级降级链:registry 命中(零token)→ 视觉回源 → 回写 registry
async function tapRole(role, desc) {
  const reg = loadReg(); const k = regKey();
  const hit = reg[k]?.[role];
  if (hit) { L.tapPermille(hit.x, hit.y); stat.cacheHits++; return 'cache'; }
  const img = L.screenshot(`pp-${role}`);
  const txt = await L.vision('你是安卓界面元素定位器。只输出 JSON,不要解释。',
    `在这张截图里找到:${desc}\n输出中心点千分比坐标 {"x":<0-1000>,"y":<0-1000>}(左上为原点)。找不到输出 {"x":null,"y":null}`, img);
  const j = L.parseJson(txt); stat.visionCalls++;
  if (j?.x == null) throw new Error(`locate_failed:${role}`);
  L.tapPermille(j.x, j.y);
  reg[k] = reg[k] || {}; reg[k][role] = { x: j.x, y: j.y, learned_at: new Date().toISOString() };
  saveReg(reg);
  return 'vision';
}

// 前台窗口全名，如 com.ss.android.ugc.aweme/...VideoRecordNewActivity
function currentFocus() {
  return L.adb('shell', 'dumpsys', 'window').match(/mCurrentFocus=.*?([\w.]+\/[\w.]+)/)?.[1]
    ?? L.adb('shell', 'dumpsys', 'activity', 'activities').match(/mResumedActivity.*?([\w.]+\/[\w.]+)/)?.[1]
    ?? '';
}

async function checkPre(pre) {
  for (const p of pre ?? []) {
    if (p.type === 'foreground_package' || p.type === 'foreground_activity') {
      const cur = currentFocus();
      if (!cur.includes(p.value)) throw new Error(`precondition_failed:foreground=${cur || 'unknown'}`);
    }
  }
}

async function checkPost(post, ctx) {
  return evaluatePostcondition(post, ctx, {
    currentFocus,
    vision: async (desc) => {
      const img = L.screenshot('pp-post');
      const txt = await L.vision('你是安卓界面判定器。只输出 JSON,不要解释。',
        `${desc}\n输出 {"ok":true|false,"why":"简短理由"}`, img);
      stat.visionCalls++;
      const j = L.parseJson(txt);
      return { ok: !!j?.ok, why: j?.why ?? txt.slice(0, 80) };
    },
  });
}

const t0 = Date.now();
const u0 = { ...L.usage };
const ctx = { target: args.target };
let result;
try {
  if (seq.reset_app) L.resetApp();
  await checkPre(seq.precondition);
  for (const step of seq.steps) {
    if (step.op === 'tapRole') await tapRole(step.role, step.describe);
    else if (step.op === 'type') L.typeText((step.textFrom === 'target' ? ctx.target : step.text) ?? '');
    else if (step.op === 'key') L.key(step.code);
    else throw new Error(`unknown_op:${step.op}`);
    L.sleep(step.wait_ms ?? 1500);
  }
  const pc = await checkPost(seq.postcondition, ctx);
  result = { ok: pc.ok, why: pc.why };
} catch (e) {
  result = { ok: false, why: e.message };
}
const out = {
  sequence: seq.name, ok: result.ok, why: result.why,
  ms: Date.now() - t0,
  llm_calls: L.usage.calls - u0.calls,
  tokens: (L.usage.prompt - u0.prompt) + (L.usage.completion - u0.completion),
  cache_hits: stat.cacheHits, vision_locates: stat.visionCalls ? stat.visionCalls - 1 : 0,
  device: regKey(),
};
console.log(JSON.stringify(out));
process.exit(result.ok ? 0 : 1);
