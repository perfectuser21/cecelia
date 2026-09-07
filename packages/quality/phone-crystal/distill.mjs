#!/usr/bin/env node
// distill.mjs — 提炼器（技能蒸馏第②③步：把成功轨迹转成可重放序列 + 坐标入表）
//
// 纯机械转换，不调模型：explore.mjs 已要求 LLM 在给动作时同时给出 role，
// 语义判断在探索阶段就完成了，这里只做格式搬运与收敛（决策 ca9f3d7b：能程序化就不用 AI）。
//
// 单条轨迹会把 LLM 那一次的弯路一起固化——实测同一任务三次分别是 10 步 / 5 步 / 跑不完，
// 弯路各不相同。决策 28ca1f69 第②条：触发蒸馏的条件是同一形状「跨多次」重复出现，
// 不是成功一次。所以多条轨迹取最长公共子序列，只留每次都走的那些步。
//
// 用法:
//   node distill.mjs --traces a.json,b.json,c.json [--out-name x] [--dry] [--overwrite] [--include-unclaimed]
//   node distill.mjs --trace a.json                （单条，向后兼容）

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { mergeLocators } from './locators.mjs';

// 布尔标志与键值对分开解析：原先按「每两个 argv 一对」硬走，--dry 这种无值标志
// 会把后面参数全部错位，且 args.dry 恒为 undefined 导致干跑失效、真写了文件
// （2026-09-07 实测踩过，误覆盖了已晋升技能依赖的生产坐标）。
const BOOL_FLAGS = new Set(['dry', 'overwrite', 'include-unclaimed']);
const argv = process.argv.slice(2);
const args = {};
for (let i = 0; i < argv.length; i += 1) {
  const a = argv[i];
  if (!a.startsWith('--')) continue;
  const k = a.replace(/^--/, '');
  if (BOOL_FLAGS.has(k)) args[k] = true; else args[k] = argv[++i];
}
if (!args.trace && !args.traces) { console.error('必须给 --trace <轨迹> 或 --traces <逗号分隔多条>'); process.exit(2); }

const DRY = args.dry === true;
const tracePaths = (args.traces ? args.traces.split(',') : [args.trace]).map((x) => x.trim()).filter(Boolean);
const allTraces = tracePaths.map((f) => ({ file: f, ...JSON.parse(readFileSync(f, 'utf8')) }));

// done_claimed 是执行者自证，不可信（决策 28ca1f69：A臂第1轮自称完成、实际停在桌面）。
// 这里只拿它做粗筛，真正的裁决在技术门（连跑 N 次 + postcondition）。
const usable = args['include-unclaimed'] ? allTraces : allTraces.filter((t) => t.done_claimed);
if (!usable.length) { console.error('没有可用轨迹（全部 done_claimed=false）；确认后可加 --include-unclaimed'); process.exit(3); }

const NAME = args['out-name'] || usable[0].name;
const dev = usable[0].device;
const devKey = `${dev.model}|${dev.app_version}|${dev.density}`;

/** 把一条轨迹压成带 key 的动作列表，key 用于跨轨迹比对 */
function toActions(t) {
  const out = [];
  for (const st of t.steps) {
    const a = st.action;
    if (!a || a.action === 'done' || !st.executed) continue;
    if (a.action === 'tap' && a.role) out.push({ key: `tap:${a.role}`, ...a });
    else if (a.action === 'type') out.push({ key: 'type', ...a });
    else if (a.action === 'key') out.push({ key: `key:${a.code || 'ENTER'}`, ...a });
  }
  return out;
}

/** 两条动作序列的最长公共子序列（保序），用来剔除各自的弯路 */
function lcs(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i += 1) {
    for (let j = 1; j <= n; j += 1) {
      dp[i][j] = a[i - 1].key === b[j - 1].key ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  const out = [];
  let i = m, j = n;
  while (i > 0 && j > 0) {
    if (a[i - 1].key === b[j - 1].key) { out.unshift(a[i - 1]); i -= 1; j -= 1; }
    else if (dp[i - 1][j] >= dp[i][j - 1]) i -= 1; else j -= 1;
  }
  return out;
}

const warnings = [];
const perTrace = usable.map((t) => ({ file: t.file, acts: toActions(t) }));

// LCS 只在「路径同构」的轨迹之间安全。实测踩过：两条成功轨迹殊途同归——
// 一条点搜索历史（无需输入），一条输入+回车；直接取交集把两边各自的必要步骤
// 都当弯路剔除，收敛出 2 步跑不通的序列（技术门当场拦下）。
// 所以先按路径签名分组，只在同一条路径的轨迹之间做 LCS。
const groups = new Map();
for (const t of perTrace) {
  const sig = t.acts.map((a) => a.key).join('>');
  if (!groups.has(sig)) groups.set(sig, []);
  groups.get(sig).push(t);
}
const ranked = [...groups.entries()].sort((a, b) => b[1].length - a[1].length || a[1][0].acts.length - b[1][0].acts.length);
const [mainSig, mainGroup] = ranked[0];
let common = mainGroup[0].acts;
for (let i = 1; i < mainGroup.length; i += 1) common = lcs(common, mainGroup[i].acts);

// 路径分组数 > 1 即「变体未收敛」的实证——对应判决引擎 maxNewBranchRate=0：
// 还在冒新走法就固化，等于把其中一条偶然路径当成了唯一路径。
const pathVariants = groups.size;
if (pathVariants > 1) {
  warnings.push(`识别出 ${pathVariants} 条不同路径（各 ${ranked.map((r) => r[1].length).join('/')} 条轨迹）——变体未收敛，本次只用出现最多的那条；建议多跑几次再固化`);
}

const steps = [];
const locators = {};

for (const a of common) {
  if (a.action === 'tap') {
    locators[a.role] = { x: a.x, y: a.y, learned_at: new Date().toISOString(), learned_from: tracePaths.join(',') };
    steps.push({ op: 'tapRole', role: a.role, describe: a.describe || '', wait_ms: 1500 });
  } else if (a.action === 'type') {
    const isTarget = usable[0].target && a.text === usable[0].target;
    steps.push(isTarget ? { op: 'type', textFrom: 'target', wait_ms: 800 } : { op: 'type', text: a.text ?? '', wait_ms: 800 });
  } else if (a.action === 'key') {
    steps.push({ op: 'key', code: a.code === 'BACK' ? 'KEYCODE_BACK' : 'KEYCODE_ENTER', wait_ms: 2000 });
  }
}

if (!steps.length) warnings.push('公共子序列为空——各轨迹走法完全不同，说明变体尚未收敛，不该固化');
perTrace.forEach((t) => {
  const cut = t.acts.length - common.length;
  if (cut > 0) warnings.push(`${t.file}：${t.acts.length} 步中筛掉 ${cut} 步弯路`);
});

// postcondition 是探针，无探针不许固化（INV-2）。判定层永不蒸馏（决策 28ca1f69），
// 所以它永远是 vision 类型、永远留给 LLM。这里只能生成草稿，needs_review 提醒人复核——
// 「这一步到底怎么算成了」机器替你定了才危险。
const seq = {
  name: NAME,
  version: 1,
  distilled_from: tracePaths.join(', '),
  distilled_at: new Date().toISOString(),
  converged_over: usable.length,
  reset_app: true,
  precondition: [
    { type: 'foreground_package', value: 'com.ss.android.ugc.aweme',
      note: '实测失败案例：App 没起来即整条挂掉，reset_app 后仍须验前台' },
  ],
  steps,
  postcondition: {
    type: 'vision',
    describe: `这张安卓截图里，「${usable[0].task}」这件事是否已经完成？`,
    needs_review: true,
    note: '自动生成的草稿断言，人工复核后去掉 needs_review。判定层永不蒸馏成硬编码。',
  },
  side_effects: [],
};

const summary = {
  name: NAME, device_key: devKey,
  traces_given: allTraces.length, traces_used: usable.length,
  steps_per_trace: perTrace.map((t) => t.acts.length),
  path_variants: pathVariants, main_path_traces: mainGroup.length,
  converged_steps: steps.length, locators: Object.keys(locators).length,
  warnings,
};

if (DRY) { console.log(JSON.stringify({ dry_run: true, ...summary, sequence: seq }, null, 2)); process.exit(0); }

writeFileSync(`./sequences/${NAME}.json`, JSON.stringify(seq, null, 2));

const regPath = './registry.json';
const reg = existsSync(regPath) ? JSON.parse(readFileSync(regPath, 'utf8')) : {};
const existing = reg[devKey] || {};
// 默认不覆盖已有坐标：一个 role 可能正被已晋升的技能使用，覆盖它等于当场弄坏生产
// （2026-09-06 实测：本器曾把 search_entry 从 946,75 改成 537,77，已 promote 的
// search_account 随即依赖错坐标）。冲突只报不改，规则与守卫见 locators.mjs。
const { merged, warnings: mergeWarnings } = mergeLocators(existing, locators, { overwrite: args.overwrite });
warnings.push(...mergeWarnings);
reg[devKey] = merged;
writeFileSync(regPath, JSON.stringify(reg, null, 2));

console.log(JSON.stringify({ ...summary, warnings, wrote: [`sequences/${NAME}.json`, 'registry.json'] }, null, 2));
