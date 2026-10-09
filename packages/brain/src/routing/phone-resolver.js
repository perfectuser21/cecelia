/**
 * phone-resolver.js — 把任务正文里的手机描述，按手机台账（phone_registry）解析成唯一一台手机。
 *
 * 决策 432172f7（方案 C）：昵称/别名/技术名/抖音号 → 手机 的映射是**台账数据**，本模块只做
 * 查表 + 核验 + 查不到退回，不认识任何一台具体手机。台账真身：迁移 490 + PUT /api/brain/phone-registry。
 *
 * 0929 事故：任务写「小黄手机」「小彩手机（型号 MAA-AN00）」，agent 查不到昵称，卡住或用错手机。
 *
 * 匹配按层（首个有命中的层定结果；同层命中多台 = ambiguous）：
 *   1. 序列号子串
 *   2. 昵称 / 别名：须后接 手机/号机/机，或本身以「机」结尾（X号机），或独立出现在「设备：」行
 *      ——裸「小黄」「小白」在正文里是常用词（小黄车、小白也能学会），不算
 *   3. 技术名（profile）：只认「设备：」行或 profile 字样后面（legacy 之类是普通英文词）
 *   4. 抖音号 id（前后不接字母数字）/ 抖音昵称
 * 型号只作线索：多台同型号，型号命中一律 ambiguous，不定案。
 * 前三层定出一台后，若正文里的抖音号指向另一台 → ambiguous（不许拿 A 机去发 B 机的号）。
 * 只看 enabled 行。
 */

const DEVICE_LINE_RE = /^[ \t]*[-*•]?[ \t]*(?:设备|手机|执行设备|目标手机)[ \t]*[：:][ \t]*(.*\S)[ \t]*$/gm;
const TOKEN_SPLIT_RE = /[\s,，、;；/|（）()【】[\]「」“”"']+/;
// 「机」后接这些字时是另一个词（机器人、机构、机会……），不当「X机」
const NOT_PHONE_AFTER_JI = '(?![器构会场制关票位能密理械体动灵])';
const PHONE_SUFFIX = `(?:手机|号机|机${NOT_PHONE_AFTER_JI})`;
// 「一号机」不能从「十一号机」里命中
const NO_NUMERAL_BEFORE = '(?<![一二三四五六七八九十百零两〇0-9])';
const ASCII_WORD = 'A-Za-z0-9_';
const MIN_DOUYIN_ID_LEN = 5;
const MIN_NICK_BASE_LEN = 3;

const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const lc = (s) => String(s ?? '').toLowerCase();

function deviceLineValues(text) {
  const out = [];
  for (const m of String(text ?? '').matchAll(DEVICE_LINE_RE)) out.push(m[1]);
  return out;
}

/** 正文（含【执行参数】块）里有没有非空的「设备：xxx」行。 */
export function hasDeviceLine(text) {
  return deviceLineValues(text).length > 0;
}

function deviceLineTokens(text) {
  return deviceLineValues(text).flatMap((v) => v.split(TOKEN_SPLIT_RE)).map((t) => t.trim()).filter(Boolean);
}

const accountsOf = (row) => (Array.isArray(row?.douyin_accounts) ? row.douyin_accounts : []);

/** 该手机当前登录的抖音号（current=true），没有返回 null。 */
export function currentAccountOf(row) {
  return accountsOf(row).find((a) => a && a.current === true) ?? null;
}

/** 定不下时回写中文「OpenClaw结果」的提示；昵称清单取自台账 enabled 行。 */
export function unresolvedNote(rows) {
  const names = (Array.isArray(rows) ? rows : []).filter((r) => r?.enabled !== false && r?.nickname).map((r) => r.nickname);
  return `⚠️ 手机未确定：请在正文写明手机昵称（${names.join('/')}）或抖音账号`;
}

function nameHit(text, tokens, term) {
  const t = String(term ?? '').trim();
  if (!t) return false;
  if (tokens.some((x) => x === t || x === `${t}手机`)) return true;
  const e = escapeRe(t);
  if (t.endsWith('机')) return new RegExp(`${NO_NUMERAL_BEFORE}${e}${NOT_PHONE_AFTER_JI}`).test(text);
  return new RegExp(`${NO_NUMERAL_BEFORE}${e}${PHONE_SUFFIX}`).test(text);
}

function profileHit(text, tokens, profile) {
  const p = lc(profile).trim();
  if (!p) return false;
  if (tokens.some((x) => lc(x) === p)) return true;
  return new RegExp(`profile[\\s:：=]*${escapeRe(p)}(?![${ASCII_WORD}-])`, 'i').test(text);
}

function idHit(text, id) {
  const v = String(id ?? '').trim();
  if (v.length < MIN_DOUYIN_ID_LEN) return false;
  return new RegExp(`(?<![${ASCII_WORD}])${escapeRe(v)}(?![${ASCII_WORD}])`, 'i').test(text);
}

function nickHit(textLc, nickname) {
  const n = lc(nickname).trim();
  if (!n) return false;
  if (textLc.includes(n)) return true;
  const base = n.replace(/[（(][^（()）]*[）)]\s*$/, '').trim();
  return base !== n && base.length >= MIN_NICK_BASE_LEN && textLc.includes(base);
}

function modelHit(text, model) {
  const m = String(model ?? '').trim();
  if (!m) return false;
  return new RegExp(`(?<![${ASCII_WORD}])${escapeRe(m)}(?![${ASCII_WORD}])`, 'i').test(text);
}

/** 抖音层：每个 enabled 行里命中的第一个号（id 优先于昵称）。 */
function douyinHits(text, rows) {
  const textLc = lc(text);
  const hits = [];
  for (const row of rows) {
    for (const a of accountsOf(row)) {
      if (!a) continue;
      if (idHit(text, a.id)) { hits.push({ row, matchedBy: 'douyin_id', account: a }); break; }
      if (nickHit(textLc, a.nickname)) { hits.push({ row, matchedBy: 'douyin_nickname', account: a }); break; }
    }
  }
  return hits;
}

const candidateOf = (h) => ({ serial: h.row.serial, nickname: h.row.nickname ?? null, host: h.row.host ?? null, matchedBy: h.matchedBy });

function dedupeBySerial(hits) {
  const seen = new Map();
  for (const h of hits) if (!seen.has(h.row.serial)) seen.set(h.row.serial, h);
  return [...seen.values()];
}

const NONE = Object.freeze({ status: 'none', phone: null, matchedBy: null, candidates: [], account: null });

function decide(hits) {
  const list = dedupeBySerial(hits);
  if (list.length === 0) return null;
  if (list.length > 1) {
    return { status: 'ambiguous', phone: null, matchedBy: list[0].matchedBy, candidates: list.map(candidateOf), account: null };
  }
  const [h] = list;
  return {
    status: 'unique', phone: h.row, matchedBy: h.matchedBy, candidates: [candidateOf(h)],
    account: h.account ?? currentAccountOf(h.row),
  };
}

/** 身份层（序列号 → 昵称/别名 → 技术名）：首个有命中的层定结果，都没命中返回 null。 */
function identityTiers(text, rows) {
  const tokens = deviceLineTokens(text);
  const textLc = lc(text);
  const tiers = [
    () => rows.filter((r) => textLc.includes(lc(r.serial))).map((row) => ({ row, matchedBy: 'serial' })),
    () => rows.flatMap((row) => {
      if (nameHit(text, tokens, row.nickname)) return [{ row, matchedBy: 'nickname' }];
      const aliases = Array.isArray(row.aliases) ? row.aliases : [];
      return aliases.some((a) => nameHit(text, tokens, a)) ? [{ row, matchedBy: 'alias' }] : [];
    }),
    () => rows.filter((row) => profileHit(text, tokens, row.profile)).map((row) => ({ row, matchedBy: 'profile' })),
  ];
  for (const tier of tiers) {
    const r = decide(tier());
    if (r) return r;
  }
  return null;
}

/** 身份层定出一台后与抖音层对账：点了别的手机的号 → 冲突不定案；点了本机的号 → 目标号取它。 */
function reconcileDouyin(r, dyHits) {
  const others = dyHits.filter((h) => h.row.serial !== r.phone.serial);
  if (others.length) {
    return { status: 'ambiguous', phone: null, matchedBy: 'conflict', candidates: [r.candidates[0], ...dedupeBySerial(others).map(candidateOf)], account: null };
  }
  const own = dyHits.find((h) => h.row.serial === r.phone.serial);
  return own ? { ...r, account: own.account } : r;
}

/**
 * @param {string} text  任务标题/备注/正文拼起来的文本
 * @param {object[]} rows phone_registry 行（DB 形状：serial/nickname/aliases/profile/model/douyin_accounts/enabled…）
 * @returns {{status:'unique'|'ambiguous'|'none', phone:object|null, matchedBy:string|null,
 *            candidates:{serial,nickname,host,matchedBy}[], account:{id,nickname,current}|null}}
 */
export function resolvePhone(text, rows) {
  const enabled = (Array.isArray(rows) ? rows : []).filter((r) => r && r.serial && r.enabled !== false);
  const src = String(text ?? '');
  if (!enabled.length || !src.trim()) return { ...NONE, candidates: [] };
  const dyHits = douyinHits(src, enabled);

  // 「设备：」行是主理人点名的地方：它单独能定案就以它为准，正文别处的顺带提及不干扰
  const lines = deviceLineValues(src);
  if (lines.length) {
    const onLines = identityTiers(lines.map((v) => `设备：${v}`).join('\n'), enabled);
    if (onLines?.status === 'unique') return reconcileDouyin(onLines, dyHits);
  }
  const id = identityTiers(src, enabled);
  if (id) return id.status === 'unique' ? reconcileDouyin(id, dyHits) : id;

  const dy = decide(dyHits);
  if (dy) return dy;

  const modelHits = enabled.filter((row) => modelHit(src, row.model)).map((row) => ({ row, matchedBy: 'model' }));
  if (modelHits.length) {
    return { status: 'ambiguous', phone: null, matchedBy: 'model', candidates: dedupeBySerial(modelHits).map(candidateOf), account: null };
  }
  return { ...NONE, candidates: [] };
}
