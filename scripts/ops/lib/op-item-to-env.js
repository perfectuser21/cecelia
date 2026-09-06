#!/usr/bin/env node
/**
 * 把 `op item get <item> --vault CS --format json` 的输出，转成 ~/.credentials/*.env
 * 能被 `source` 的内容。
 *
 * stdin  = 1Password 条目 JSON
 * stdout = KEY=VALUE 行
 *
 * ── 为什么单独一个文件而不是内联 node -e ────────────────────────────────
 * 这段逻辑之前内联在 sync-credentials.sh 的双引号 heredoc 里，没法测，
 * 结果一个过滤条件写反了没人发现，把 14 个凭据文件里的 9 个写成了垃圾
 * （2026-09-07 现场发现）。抽出来才能有回归守卫：
 * scripts/ops/__tests__/credentials/op-item-to-env.test.sh
 *
 * ── 三条规则，每条都对应一次真实事故 ──────────────────────────────────
 *
 * ① **CONCEALED 字段必须收。**
 *    老条件写的是 `f.type !== 'CONCEALED'`，本意大概是"跳过密码不外泄"，
 *    但 1Password 里**真凭据恰恰全是 CONCEALED 类型**（实测 Tencent Cloud /
 *    WeChat 小程序 / Cecelia Deploy Token 都是）。这一条把所有有用的东西
 *    排除掉，只剩 `valid from` / `expires` 两个 DATE 元数据字段。
 *
 * ② **label 必须是合法的 shell 变量名。**
 *    `valid from=0` 这一行 source 时会被当成命令 `valid` 带参数 `from=0`，
 *    直接 `command not found`。database.env 的 `ZenithJoy DB Host=...` 同理。
 *    过滤掉带空格/中文/短横线的 label，它们本来也不是凭据。
 *
 * ③ **notesPlain 里的 KEY=VALUE 必须解析。**
 *    多数条目（Tencent / GitHub / Cloudflare / N8N …）把凭据写在备注里，
 *    而不是独立字段。只读 fields 等于什么都没读到。
 *
 * ── 引号策略 ──────────────────────────────────────────────────────────
 * 值里没有空格和特殊字符时**保持裸写**。仓库里有两个消费者用
 * `grep -m1 '^KEY=' file | cut -d= -f2-` 解析（skill-notion-sync-hook.sh、
 * engine/skills/dev/scripts/status.js），无条件加引号会把引号一起 cut 给它们。
 * 只有真需要时才单引号包起来。
 */

'use strict';

/** shell 变量名：字母或下划线开头，后面字母数字下划线 */
const VALID_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** 不用引号也安全的值：不含空白、引号、以及任何 shell 元字符 */
const SAFE_BARE = /^[A-Za-z0-9_.:@/+=,-]+$/;

/** 单引号包起来；值里的单引号用 '\'' 的经典写法转义 */
function shellQuote(value) {
  return "'" + String(value).split("'").join("'\\''") + "'";
}

function renderLine(name, value) {
  const v = String(value);
  return name + '=' + (SAFE_BARE.test(v) ? v : shellQuote(v));
}

/**
 * @param {object} item  op item get --format json 的解析结果
 * @returns {string[]}   KEY=VALUE 行
 */
function itemToEnvLines(item) {
  const fields = (item && item.fields) || [];
  const seen = new Set();
  const lines = [];

  const push = (name, value) => {
    if (!VALID_NAME.test(name)) return;   // 规则 ②
    if (value === undefined || value === null || value === '') return;
    if (seen.has(name)) return;           // 独立字段优先于 notes 里的同名项
    seen.add(name);
    lines.push(renderLine(name, value));
  };

  // 独立字段。**绝不按 CONCEALED 过滤**——真凭据就是这个类型（规则 ①）。
  // 排掉的只有两类结构性元数据：
  //   NOTES —— 那一坨在下面单独解析
  //   DATE / MENU —— 1Password 给证书类条目自带的 valid from / expires / type，
  //                  永远不是凭据。'expires' 名字合法，光靠变量名规则拦不住它。
  const META_TYPES = new Set(['DATE', 'MENU']);
  for (const f of fields) {
    if (f.purpose === 'NOTES') continue;
    if (META_TYPES.has(f.type)) continue;
    push(f.label, f.value);
  }

  // notesPlain 里的 KEY=VALUE（规则 ③）
  const notes = fields.find((f) => f.purpose === 'NOTES');
  if (notes && notes.value) {
    for (const raw of String(notes.value).split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq <= 0) continue;
      // 只取第一个 = 之前作为名字，后面整段都是值（值里可以带 =）
      push(line.slice(0, eq).trim(), line.slice(eq + 1));
    }
  }

  return lines;
}

module.exports = { itemToEnvLines, renderLine, VALID_NAME, SAFE_BARE };

if (require.main === module) {
  let buf = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (c) => { buf += c; });
  process.stdin.on('end', () => {
    let item;
    try {
      item = JSON.parse(buf);
    } catch (e) {
      process.stderr.write('输入不是合法 JSON：' + e.message + '\n');
      process.exit(2);
    }
    const lines = itemToEnvLines(item);
    // 一条都没提取到 = 这个条目对同步来说是空的。让调用方能分辨，
    // 而不是写一个空文件出去假装成功。
    if (lines.length === 0) process.exit(3);
    process.stdout.write(lines.join('\n') + '\n');
  });
}
