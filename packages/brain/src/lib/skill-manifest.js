/**
 * skill-manifest.js — skill 清单的解析 / 校验 / 比对（纯逻辑，无 IO）。
 *
 * 清单本身由 skill-manifest.sh 在「目标机器上」生成（us-vps 零执行：Brain 不算大目录哈希，
 * 只读回一行 JSON）。本模块只做三件事：
 *   1. parseManifestOutput：把 ssh 回来的原始输出变成校验过的清单，或明确的失败原因；
 *   2. treeHashOf / verifyTreeHash：与脚本同口径重算 tree_hash，输出被截断/篡改即判 invalid；
 *   3. compareManifests：真身 vs 某台机器 → missing / extra / changed / broken。
 *
 * 口径见 skill-manifest.sh 头注释。tree_hash 只覆盖有内容的 skill（悬空项单列 broken）。
 */
import { createHash } from 'crypto';

export const MANIFEST_VERSION = 1;
const HEX64 = /^[0-9a-f]{64}$/;

const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const bytewise = (a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b));

/** 与脚本一致：sha256( 排序后的 "name<TAB>hash\n" 行 )；空集合 = sha256('')。 */
export function treeHashOf(skills) {
  const lines = Object.entries(skills || {}).map(([name, h]) => `${name}\t${h}`).sort(bytewise);
  return sha256(lines.map((l) => `${l}\n`).join(''));
}

export function verifyTreeHash(manifest) {
  return Boolean(manifest)
    && typeof manifest.tree_hash === 'string'
    && HEX64.test(manifest.tree_hash)
    && manifest.tree_hash === treeHashOf(manifest.skills);
}

function invalid(detail) {
  return { ok: false, reason: 'invalid', detail };
}

/**
 * @param {string} raw ssh/exec 回来的 stdout（可含 banner 噪声，取最后一个 JSON 行）
 * @returns {{ok:true, manifest:object}|{ok:false, reason:'dir_missing'|'invalid', detail?:string}}
 */
export function parseManifestOutput(raw) {
  const lines = String(raw ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
  const jsonLine = [...lines].reverse().find((l) => l.startsWith('{') && l.endsWith('}'));
  if (!jsonLine) return invalid('无 JSON 行');
  let obj;
  try {
    obj = JSON.parse(jsonLine);
  } catch (e) {
    return invalid(`JSON 解析失败: ${e.message}`);
  }
  if (obj?.version !== MANIFEST_VERSION) return invalid(`版本不符: ${obj?.version}`);
  if (obj.error === 'dir_missing') return { ok: false, reason: 'dir_missing', detail: obj.dir };
  if (obj.error) return invalid(`脚本报错: ${obj.error}`);
  if (!obj.skills || typeof obj.skills !== 'object' || Array.isArray(obj.skills)) return invalid('缺 skills');
  if (!Array.isArray(obj.broken) || obj.broken.some((b) => typeof b !== 'string')) return invalid('缺 broken');
  for (const [name, h] of Object.entries(obj.skills)) {
    if (typeof h !== 'string' || !HEX64.test(h)) return invalid(`skill ${name} 哈希格式非法`);
  }
  if (!verifyTreeHash(obj)) return invalid('tree_hash 与 skills 不符（输出被截断或篡改）');
  return { ok: true, manifest: obj };
}

/**
 * 真身 vs 某台机器某目录。
 *  - missing：真身有内容而对方既没有内容也没有悬空链接
 *  - broken ：真身有内容而对方只有悬空链接（cron 无 -L 的病）
 *  - changed：两边都有内容但哈希不同
 *  - extra  ：对方有、真身没有内容的项（旧快照残留；真身自己悬空的名字上，对方若有真内容也算残留）
 *  - truth_broken：真身自己的悬空链接（真身有病，单独报，不算对方漂移）
 * 对方悬空项若名字在真身悬空清单里 → 同病相连，不算 extra。
 */
export function compareManifests(truth, other) {
  const tSkills = truth.skills || {};
  const oSkills = other.skills || {};
  const tBroken = new Set(truth.broken || []);
  const oBroken = new Set(other.broken || []);
  const missing = [];
  const broken = [];
  const changed = [];
  for (const [name, h] of Object.entries(tSkills)) {
    if (name in oSkills) {
      if (oSkills[name] !== h) changed.push(name);
    } else if (oBroken.has(name)) {
      broken.push(name);
    } else {
      missing.push(name);
    }
  }
  const extra = [];
  for (const name of Object.keys(oSkills)) if (!(name in tSkills)) extra.push(name);
  for (const name of oBroken) if (!(name in tSkills) && !tBroken.has(name)) extra.push(name);
  const sort = (a) => a.sort(bytewise);
  const res = {
    missing: sort(missing), extra: sort(extra), changed: sort(changed), broken: sort(broken),
    truth_broken: sort([...tBroken]),
  };
  res.in_sync = !(res.missing.length || res.extra.length || res.changed.length || res.broken.length);
  return res;
}
