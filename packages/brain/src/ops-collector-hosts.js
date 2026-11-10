export const OWN_LABEL_RE = /(cecelia|zenithjoy|perfect21|openclaw|claude|n8n|cloudflare)/i;
export function parseLaunchctlList(out, labelRe = OWN_LABEL_RE) {
  const rows = [];
  for (const line of String(out).split('\n').slice(1)) {
    const m = line.trim().match(/^(-|\d+)\s+(-?\d+)\s+(\S+)$/);
    if (!m) continue;
    const [, pid, status, label] = m;
    if (!labelRe.test(label)) continue;
    rows.push({ label, pid: pid === '-' ? null : Number(pid), lastExitCode: Number(status) });
  }
  return rows;
}

export function parsePlistDump(out) {
  const plists = new Map();
  const badFiles = [];
  for (const block of String(out).split(/^== /m).slice(1)) {
    const nl = block.indexOf('\n');
    const path = block.slice(0, nl).trim();
    const body = block.slice(nl + 1).trim();
    if (!body) continue;
    try {
      const j = JSON.parse(body);
      if (j.Label) plists.set(j.Label, {
        path,
        StartInterval: j.StartInterval ?? null,
        StartCalendarInterval: j.StartCalendarInterval ?? null,
      });
    } catch { badFiles.push(path); }
  }
  return { plists, badFiles };
}

const WEEKDAY_NUM = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** StartCalendarInterval → 下次触发绝对 UTC（DST 正确：逐分钟用 Intl 在目标时区比对）。算不出=null。 */
export function computeNextRunUTC(cal, from, timeZone, horizonDays = 8) {
  const entries = (Array.isArray(cal) ? cal : [cal]).filter(Boolean);
  if (!entries.length) return null;
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone, weekday: 'short', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: 'numeric', hourCycle: 'h23',
  });
  const start = Math.ceil((from.getTime() + 1) / 60000) * 60000;
  for (let i = 0; i < horizonDays * 24 * 60; i++) {
    const t = new Date(start + i * 60000);
    const parts = Object.fromEntries(fmt.formatToParts(t).map((p) => [p.type, p.value]));
    const local = {
      Minute: Number(parts.minute), Hour: Number(parts.hour),
      Day: Number(parts.day), Month: Number(parts.month),
      Weekday: WEEKDAY_NUM[parts.weekday],
    };
    for (const e of entries) {
      let match = true;
      for (const [k, v] of Object.entries(e)) {
        if (!(k in local)) continue; // 未知键容忍（schema_drift 不失败）
        const want = k === 'Weekday' && Number(v) === 7 ? 0 : Number(v);
        if (local[k] !== want) { match = false; break; }
      }
      if (match) return t.toISOString();
    }
  }
  return null;
}

export function extractOpenclawAgents(config) {
  const entries = config?.agents?.entries;
  const list = Array.isArray(entries) ? entries
    : entries && typeof entries === 'object'
      ? Object.entries(entries).map(([id, v]) => ({ id, ...(v || {}) }))
      : null;
  if (!list) throw new Error('schema_drift: agents.entries 缺失或形状未知');
  return list
    .map((e) => {
      const sa = e.subagents;
      // 编排关系：subagents.allowAgents = 这个 agent 能编排的下级 agent 清单（图，dev 可被多父编排）。
      const orchestrates = Array.isArray(sa?.allowAgents)
        ? sa.allowAgents.filter((x) => typeof x === 'string')
        : [];
      // model 可能是字符串或 { primary, fallbacks }
      const model = typeof e.model === 'string' ? e.model
        : (typeof e.model?.primary === 'string' ? e.model.primary : null);
      const id = e.identity || {};
      return {
        name: String(e.id || e.name || ''),
        agent_type: 'openclaw_agent',
        meta: { // 白名单——clawdbot.json 含明文凭据（apiKey/auth），绝不整份入库
          model,
          workspace: typeof e.workspace === 'string' ? e.workspace : null,
          agent_dir: typeof e.agentDir === 'string' ? e.agentDir : null,
          orchestrates,
          delegation_mode: typeof sa?.delegationMode === 'string' ? sa.delegationMode : null,
          // 人设（agent 是什么角色）
          identity_name: typeof id.name === 'string' ? id.name : null,
          identity_theme: typeof id.theme === 'string' ? id.theme : null,
          identity_emoji: typeof id.emoji === 'string' ? id.emoji : null,
          // skill 才是最小执行单元——agent 只是承载它的容器
          skills: Array.isArray(e.skills) ? e.skills.filter((x) => typeof x === 'string') : [],
          tools_allow: Array.isArray(e.tools?.alsoAllow) ? e.tools.alsoAllow.filter((x) => typeof x === 'string') : [],
          tools_deny: Array.isArray(e.tools?.deny) ? e.tools.deny.filter((x) => typeof x === 'string') : [],
          // 组织维度（花名册）：归属 + 岗位类型
          org: inferAgentOrg(String(e.id || e.name || '')),
          role_type: inferAgentRoleType(String(e.id || e.name || '')),
        },
      };
    })
    .filter((a) => a.name);
}

/**
 * skill 提取：skill 是最小执行单元（真正定义"怎么干"的那层），与 agent 多对多——
 * 实证 social-leadgen-workflow 被 4 个 agent 共用。汇总每个 skill 被哪些 agent 使用。
 */
export function extractOpenclawSkills(config) {
  const entries = config?.agents?.entries;
  const list = Array.isArray(entries) ? entries
    : entries && typeof entries === 'object'
      ? Object.entries(entries).map(([id, v]) => ({ id, ...(v || {}) }))
      : [];
  const usedBy = new Map();
  for (const e of list) {
    const owner = String(e?.id || e?.name || '');
    for (const s of e?.skills || []) {
      if (typeof s !== 'string') continue;
      if (!usedBy.has(s)) usedBy.set(s, []);
      if (owner) usedBy.get(s).push(owner);
    }
  }
  return [...usedBy.entries()].map(([name, used]) => ({ name, used_by: used.sort() }))
    .sort((a, b) => b.used_by.length - a.used_by.length || a.name.localeCompare(b.name));
}


// ─── 组织维度（数字员工花名册）────────────────────────────────────────
// 主理人 2026-09-06 定调：管理单位是 agent（数字员工，组部门/分职责），
// skill 是可共享能力——同一套 social-* skill 装在悦升号和金诺号两个不同身份上。
const ORG_PREFIX = [
  ['zenithjoy-', '悦升'], ['jinoshengyuan-', '金诺盛源'],
  ['affine-jinnuo', '金诺盛源'], ['affine-yuesheng', '悦升'],
];
/** 组织归属：按命名前缀推（无前缀=自家内部平台 agent）。认不出不硬猜租户。 */
export function inferAgentOrg(name = '') {
  const n = String(name);
  for (const [p, org] of ORG_PREFIX) if (n.startsWith(p)) return org;
  return '内部平台';
}

const ROLE_RULES = [
  [/-router$|^.*-router$/, 'router'],
  [/commander/, 'commander'],
  [/-worker$|worker$/, 'worker'],
  [/^verifier$|verifier/, 'verifier'],
  [/^curator$|curator/, 'curator'],
  [/social-media|ai-office|office-operator|research/, 'operator'],
];
/** 岗位类型：同一 skill 可装在不同岗位上，故岗位与能力分开表达。认不出=通用 agent。 */
export function inferAgentRoleType(name = '') {
  const n = String(name);
  for (const [re, role] of ROLE_RULES) if (re.test(n)) return role;
  return 'agent';
}

export function parseGhaCron(out) {
  const rows = [];
  for (const line of String(out).split('\n')) {
    const m = line.match(/\.github\/workflows\/([^:]+):\d+:.*cron:\s*'([^']+)'/);
    if (!m) continue;
    const repo = line.includes('/cecelia/') ? 'cecelia' : 'zenithjoy';
    rows.push({ label: `${repo}/${m[1]}`, schedule_desc: `cron(UTC): ${m[2]}`, kind: 'gha_cron' });
  }
  return rows;
}

// OpenClaw 落点迁移史：hk-vps → us-vps(2026-09-12) → MMV(2026-09-20)。
// 前两版都把落点写死在命令里（`ssh hk-vps ...` / `docker exec openclaw-gateway ...`），
// 于是每迁一次这条腿就坏一次：上一版的注释原话是「旧 ssh hk-vps 版在迁移后必然
// No such container，腿常年 unreachable」—— 0920 迁 MMV 后同一句话又应验了一遍。
//
// 这一版改走 **ssh 别名 mmv**：落点变了只需改 us-vps 的 ~/.ssh/config，不必改代码。
// （2026-09-21 实证：那条别名原先指向过期 IP 100.108.7.63，已修为 100.71.151.105。）
// 命令仍经 buildHostCmd 逃出容器到 us-vps 宿主，再由宿主 ssh 到 MMV。
const MMV_SSH = 'ssh -o BatchMode=yes -o ConnectTimeout=20 mmv';
// 读 OpenClaw 真在用的 openclaw.json；clawdbot.json 自 09-21 起不再更新，新建的 agent 全不在里面（任务 7951bd36）
export const OPENCLAW_CONFIG_CMD = `${MMV_SSH} 'cat ~/.openclaw/openclaw.json'`;
export const OPENCLAW_CRON_CMD = `${MMV_SSH} '/opt/homebrew/bin/openclaw cron list --all --json'`;

/**
 * `openclaw cron list --all --json` → ops_schedule_entries 行。
 *
 * 为什么要收：41 条 OpenClaw cron（含 18 条业务）此前从不进台账，Notion 上零留痕
 * —— 团队要能调用 OpenClaw 的全部任务，前提是先看得见。
 *
 * 禁用的活也收（标 last_state=disabled）：看不见的禁用等于悄悄少干活。
 * 0 条视为可疑直接抛错，不当真空——否则一次取数失败就会把整份台账标成 inactive
 * （同 launchd 腿「0=可疑，禁当真空」的处置）。
 */
export function parseOpenclawCrons(raw) {
  let doc;
  try {
    doc = JSON.parse(raw);
  } catch {
    throw new Error(`parse_error: openclaw cron list 非法 JSON（前100字符: ${String(raw).slice(0, 100)}）`);
  }
  const jobs = Array.isArray(doc?.jobs) ? doc.jobs : [];
  if (jobs.length === 0) {
    throw new Error('parse_error: openclaw cron list 解析出 0 条（0=可疑，禁当真空把台账清空）');
  }
  return jobs.map((j) => {
    const sch = j?.schedule ?? {};
    const kind = String(sch.kind ?? 'unknown');
    let desc;
    if (kind === 'cron') {
      desc = `cron(${sch.tz || 'UTC'}): ${sch.expr ?? ''}`.trim();
    } else if (kind === 'every') {
      // 锚点是注册时刻，不是整点——写“约每 N 秒”，禁假精确（同 launchd_interval 的处置）
      desc = `约每 ${Math.round(Number(sch.everyMs ?? 0) / 1000)} 秒`;
    } else {
      desc = JSON.stringify(sch);
    }
    const next = j?.state?.nextRunAtMs ?? j?.nextRunAtMs ?? null;
    const lastRunMs = Number(j?.state?.lastRunAtMs ?? j?.lastRunAtMs ?? 0);
    const lastRunAt = Number.isFinite(lastRunMs) && lastRunMs > 0 ? new Date(lastRunMs).toISOString() : null;
    const lastState = j?.enabled === false
      ? 'disabled'
      : (j?.lastRunStatus ?? j?.status ?? null);
    return {
      label: String(j?.name || j?.id || '(未命名)'),
      kind: `openclaw_${kind}`,
      schedule_desc: desc,
      next_run_utc: Number.isFinite(Number(next)) && next ? new Date(Number(next)).toISOString() : null,
      last_state: lastState,
      last_exit_code: null,
      interval_sec: kind === 'every' && Number(sch.everyMs) > 0 ? Math.round(Number(sch.everyMs) / 1000) : null,
      last_run_at: lastRunAt,
      last_success_at: lastState === 'ok' ? lastRunAt : null,
    };
  });
}

export const PLIST_DUMP_CMD =
  'for f in /Library/LaunchDaemons/*.plist; do echo "== $f"; /usr/bin/plutil -convert json -o - "$f" 2>/dev/null; echo ""; done';

/**
 * us-vps 宿主 crontab -> ops_schedule_entries 行（排程台账第四来源）。
 *
 * 为什么要收：台账已有 gha/github、openclaw/mmv、launchd/local 三家，唯独宿主
 * crontab 的 19 条业务活（Notion 派单轮询、opc-* 五个 Notion 同步、磁盘/网关守卫、
 * 库备份）完全不在里面，Notion 上零留痕。看不见的活没法被团队调度。
 *
 * 真表（2026-09-21）里有三类行，必须分清：
 *  1. 活的                 -> 收，last_state=null（crontab 不记运行历史）
 *  2. 被注释掉的活         -> 收，last_state='disabled'
 *     形如 `#[retired-0921] 45 20 * * * docker restart ...`。沿用 openclaw 腿的原则：
 *     看不见的禁用等于悄悄少干活。判据是「剥掉 # 和 [标记] 之后仍是合法排期开头」，
 *     而不是看有没有 # —— 否则纯说明注释会被当成活收进来。
 *  3. 纯说明注释           -> 跳过
 *
 * label 是 (source, host_alias, label) 唯一键的一部分，必须稳定且互不相同：
 * 优先取行尾的 `# 名字`（人给的名字比推断的好）；没有就用
 * `<命令里第一个脚本的 basename> @ <排期>` —— 带上排期是因为同一个脚本常配多条
 * 不同排期（opc-kr-current.py 就有三条），只用 basename 会互相覆盖只剩一条。
 *
 * next_run_utc 一律 null：算 cron 下次运行要完整实现 cron 语义（列表/步长/星期与
 * 日期的或关系/DST），算错比不算更坏。同 parseGhaCron 的口径——禁假精确。
 */
const CRON_FIELD = String.raw`[0-9*,\-/]+`;
const CRON_EXPR_RE = new RegExp(`^(${CRON_FIELD}(?:\\s+${CRON_FIELD}){4})\\s+(.*)$`);
const CRON_MACRO_RE = /^(@(?:reboot|yearly|annually|monthly|weekly|daily|midnight|hourly))\s+(.*)$/;
/** 被注释掉的活：`#` + 可选 `[任意标记]` + 空白，剥掉后再按正常行判。 */
const DISABLED_PREFIX_RE = /^#\s*(?:\[[^\]]*\]\s*)?/;

function splitCronLine(line) {
  const macro = line.match(CRON_MACRO_RE);
  if (macro) return { schedule: macro[1], command: macro[2] };
  const m = line.match(CRON_EXPR_RE);
  if (!m) return null;
  return { schedule: m[1], command: m[2] };
}

/** 从命令里挑一个能当名字的脚本 basename；挑不出就用命令首词。 */
function inferCronLabelBase(command) {
  const script = command.match(/([\w.-]+\.(?:sh|py|mjs|js|ts))\b/);
  if (script) return script[1];
  const words = command.trim().split(/\s+/);
  const firstReal = words.find((w) => !/^[A-Z_]+=/.test(w) && w !== 'cd' && w !== 'set') || words[0] || 'job';
  return firstReal.split('/').pop();
}

export function parseCrontab(out) {
  const rows = [];
  const seen = new Set();
  for (const raw of String(out).split('\n')) {
    const line = raw.trim();
    if (!line) continue;

    let disabled = false;
    let body = line;
    if (line.startsWith('#')) {
      body = line.replace(DISABLED_PREFIX_RE, '').trim();
      // 剥掉 # 后仍是合法排期才算"被注释掉的活"；否则就是人写的说明。
      if (!splitCronLine(body)) continue;
      disabled = true;
    }
    // VAR=value 环境行不是活
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(body)) continue;

    const parsed = splitCronLine(body);
    if (!parsed) continue;

    // 行尾 `# 名字`：只认注释里没有空白分隔的单个 token，避免把中文说明当名字
    const tail = parsed.command.match(/#\s*([\w.-]+)\s*$/);
    let label = tail ? tail[1] : `${inferCronLabelBase(parsed.command)} @ ${parsed.schedule}`;
    // 极端情况下仍可能撞名（同名 tail 注释），加序号保证唯一——撞名会静默互相覆盖。
    if (seen.has(label)) {
      let n = 2;
      while (seen.has(`${label} #${n}`)) n += 1;
      label = `${label} #${n}`;
    }
    seen.add(label);

    rows.push({
      label,
      kind: 'crontab',
      schedule_desc: `cron(UTC): ${parsed.schedule}`,
      next_run_utc: null,
      last_state: disabled ? 'disabled' : null,
    });
  }
  if (rows.length === 0) {
    throw new Error('parse_error: crontab 解析出 0 条（0=可疑，禁当真空；空表会把整份台账标 inactive）');
  }
  return rows;
}

/**
 * 取数命令自带落点证明：先 `hostname` 再 `crontab -l`。
 *
 * 0921 上产即错：我按「buildHostCmd 逃出容器就是到 us-vps 宿主」写了腿4，
 * 而 `CECELIA_HOST_EXEC_SSH` 生产值是 `administrator@100.71.151.105` —— **MMV**。
 * 结果采到 MMV 的 crontab（janitor.sh / rescan-if-changed.sh / refresh-claude-tokens.sh）
 * 却标成 host_alias='us-vps'，真正缺的 us-vps 那 22 条一条没采到。
 * 台账"有数据"但数据是错机器的，比没数据更坏——它看起来是好的。
 *
 * 落点假设不能写在注释里靠人记。每轮自己验：hostname 对不上就抛错。
 */
const HOSTNAME_PROBE = 'hostname; crontab -l';

/** MMV：走 buildHostCmd 的默认逃逸（CECELIA_HOST_EXEC_SSH 就指向它）。 */
export const CRONTAB_CMD_MMV = HOSTNAME_PROBE;

/**
 * us-vps：Brain 容器跑在 us-vps 上，但 host-exec 的逃逸目标是 MMV，
 * 所以必须显式 ssh 回本机宿主。172.17.0.1 是 docker 默认网关 = 宿主，
 * 不依赖 tailscale 也不依赖 host.docker.internal（Linux 上后者不解析，
 * 生产日志里一直在报 `Could not resolve hostname host.docker.internal`）。
 */
export const CRONTAB_CMD_USVPS =
  'ssh -o BatchMode=yes -o ConnectTimeout=8 -o StrictHostKeyChecking=no '
  + `-o UserKnownHostsFile=/dev/null root@172.17.0.1 '${HOSTNAME_PROBE}'`;

/** 各腿期望的 hostname 特征。对不上即抛——宁可缺数据，不要错机器的数据。 */
export const CRONTAB_HOST_EXPECT = Object.freeze({
  'us-vps': /^ubuntu-s-/,
  mmv: /macminivault|^aad\d/,
});

/**
 * 带落点自证的 crontab 解析：首行必须是 hostname 且匹配 expect。
 *
 * @param {string} out  `hostname; crontab -l` 的完整输出
 * @param {RegExp} expect 该腿期望的 hostname 特征
 */
export function parseCrontabWithHost(out, expect) {
  const lines = String(out).split('\n');
  const host = (lines[0] || '').trim();
  if (!host || !expect.test(host)) {
    throw new Error(
      `parse_error: 落点不符 —— 期望 hostname 匹配 ${expect}，实得 ${JSON.stringify(host)}。`
      + '（采到了别的机器的 crontab；宁可缺数据也不入错机器的数据）'
    );
  }
  return parseCrontab(lines.slice(1).join('\n'));
}



export const GHA_CRON_CMD =
  "grep -RnoE \"cron: *'[^']+'\" /Users/administrator/perfect21/cecelia/.github/workflows /Users/administrator/perfect21/zenithjoy-workspace/.github/workflows 2>/dev/null || true";

