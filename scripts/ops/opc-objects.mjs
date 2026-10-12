#!/usr/bin/env node
// OPC 经营对象表读写 CLI（飞书多维表格）。心跳专用。
//
// 历史坑：心跳曾用 dws（钉钉 Workspace CLI）读这张飞书表，认证域不同，
// 无论是否 auth login 都读不到，导致连续 83 轮空转。此脚本走飞书
// tenant token，凭据从网关配置直读，无需交互登录。
//
// 真身：cecelia/scripts/ops/opc-objects.mjs；部署副本：~/.openclaw/opc-objects.mjs。
// 用法（在当前 Gateway 主机执行；OPENCLAW_CONFIG_PATH 可显式选择配置）：
//   node /root/.openclaw/opc-objects.mjs list [--due]
//   node ~/.openclaw/opc-objects.mjs list --inspection-summary
//   node ~/.openclaw/opc-objects.mjs list --inspection-batches
//   node /root/.openclaw/opc-objects.mjs update <record_id> 状态=进行中 结果记录=...
//   node /root/.openclaw/opc-objects.mjs create 标题=维修：xxx 状态=待办 负责Agent=infra
import fs from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const APP = "Z1oobsDYbaUpcFsTjwWcx8Bmnge";
const TABLE = "tbliqtUekfBVWrjw";
const DUE_STATES = new Set(["待办", "进行中", "阻塞", "等审批"]);
const NUM_FIELDS = new Set(["下次检查时间", "审批截止时间", "阶段更新时间"]);
const INSPECTION_LIMIT = 50;
const HOUR_MS = 60 * 60 * 1000;
const LEGACY_CONFIG_PATHS = [
  "/root/.openclaw/clawdbot.json",
  "/opt/openclaw/state/clawdbot.json",
];

function die(msg) {
  console.log(JSON.stringify({ ok: false, error: msg }, null, 1));
  process.exit(1);
}

function loadCfg() {
  const explicit = process.env.OPENCLAW_CONFIG_PATH?.trim();
  const candidates = explicit ? [explicit] : [
    join(homedir(), ".openclaw", "openclaw.json"),
    ...LEGACY_CONFIG_PATHS,
  ];
  for (const p of candidates) {
    let raw;
    try {
      raw = fs.readFileSync(p, "utf8");
    } catch (err) {
      if (err?.code === "ENOENT") {
        if (explicit) die("指定网关配置不存在: " + p);
        continue;
      }
      die(`无法读取网关配置 (${err?.code || "READ_ERROR"}): ${p}`);
    }
    try {
      return JSON.parse(raw);
    } catch {
      // JSON.parse 的异常可能包含配置原文；不能让 appSecret 出现在错误输出。
      die("网关配置不是有效 JSON: " + p);
    }
  }
  die("找不到网关配置: " + candidates.join(", "));
}

async function token() {
  const acc = loadCfg()?.channels?.feishu?.accounts?.main;
  if (typeof acc?.appId !== "string" || !acc.appId.trim() ||
      typeof acc?.appSecret !== "string" || !acc.appSecret.trim()) {
    die("配置缺少 channels.feishu.accounts.main 的 appId/appSecret");
  }
  const r = await fetch(
    "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
    {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ app_id: acc.appId, app_secret: acc.appSecret }),
    },
  );
  const d = await r.json();
  if (d.code !== 0) die("取 token 失败: " + (d.msg || JSON.stringify(d)));
  return d.tenant_access_token;
}

// 多维表格字段值形态很杂：string / array / {text} / [{text}]，统一压成纯文本
function flat(v) {
  if (v == null) return "";
  if (Array.isArray(v)) return v.map(flat).join(" ").trim();
  if (typeof v === "object") return String(v.text ?? v.name ?? v.value ?? "").trim();
  return String(v).trim();
}

function parseFields(pairs) {
  const fields = {};
  for (const p of pairs) {
    const i = p.indexOf("=");
    if (i < 0) die("字段格式应为 k=v: " + p);
    const k = p.slice(0, i);
    const v = p.slice(i + 1);
    fields[k] = NUM_FIELDS.has(k) ? Number(v) : v;
  }
  return fields;
}

function epochMs(v, label) {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v :
    (typeof v === "string" && /^\d+$/.test(v) ? Number(v) : Number.NaN);
  if (!Number.isFinite(n)) die(`${label} 不是有效毫秒时间戳`);
  return n;
}

function startOfTodayShanghai(now) {
  const offset = 8 * HOUR_MS;
  const local = new Date(now + offset);
  return Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - offset;
}

async function fetchAll(T) {
  const items = [];
  let pt = null;
  const seenPageTokens = new Set();
  for (;;) {
    let u = `https://open.feishu.cn/open-apis/bitable/v1/apps/${APP}/tables/${TABLE}/records?page_size=100&automatic_fields=true`;
    if (pt) u += "&page_token=" + pt;
    const r = await fetch(u, { headers: { Authorization: "Bearer " + T } });
    const d = await r.json();
    if (d.code !== 0) die("读表失败: " + (d.msg || JSON.stringify(d)));
    if (!d.data || !Array.isArray(d.data.items)) die("读表响应无法解析: data.items 不是数组");
    items.push(...d.data.items);
    if (typeof d.data.has_more !== "boolean") die("读表响应无法解析: data.has_more 不是布尔值");
    if (!d.data.has_more) break;
    pt = d.data.page_token;
    if (!pt || seenPageTokens.has(pt)) die("读表响应无法解析: 分页 page_token 缺失或重复");
    seenPageTokens.add(pt);
  }
  return items;
}

async function cmdInspectionSummary(batched = false) {
  const items = await fetchAll(await token());
  const now = Date.now();
  const today = startOfTodayShanghai(now);
  const records = [];

  for (const it of items) {
    if (!it || typeof it !== "object" || !it.record_id || !it.fields || typeof it.fields !== "object") {
      die("读表响应无法解析: record 缺少 record_id 或 fields");
    }
    const f = it.fields;
    const status = flat(f["状态"]);
    const createdAt = epochMs(it.created_time, `${it.record_id}.created_time`);
    const stageUpdatedAt = epochMs(f["阶段更新时间"], `${it.record_id}.阶段更新时间`);
    const nextCheckAt = epochMs(f["下次检查时间"], `${it.record_id}.下次检查时间`);
    const reasons = [];

    if (status === "阻塞" && createdAt == null) {
      die(`${it.record_id} 无法解析创建时间，不能完整判断“今天新增”`);
    }
    if (status === "等审批" && stageUpdatedAt == null && createdAt == null) {
      die(`${it.record_id} 无法解析等待起始时间，不能完整判断“等待已超48小时”`);
    }
    if (status === "阻塞" && createdAt != null && createdAt >= today && createdAt <= now) {
      reasons.push("状态=阻塞且今天新增");
    }
    if (status === "等审批") {
      const waitingSince = stageUpdatedAt ?? createdAt;
      if (waitingSince != null && waitingSince <= now - 48 * HOUR_MS) {
        reasons.push("状态=等审批且等待已超48小时");
      }
    }
    if (nextCheckAt != null && nextCheckAt <= now - 2 * HOUR_MS) {
      reasons.push("下次检查时间已过期超过2小时");
    }
    if (reasons.length === 0) continue;

    records.push({
      record_id: it.record_id,
      标题: flat(f["标题"]),
      状态: status,
      负责Agent: flat(f["负责Agent"]),
      所属部门: flat(f["所属部门"]),
      优先级: flat(f["优先级"]),
      审批级别: flat(f["审批级别"]),
      created_time: createdAt,
      阶段更新时间: stageUpdatedAt,
      下次检查时间: nextCheckAt,
      异常原因: reasons,
    });
  }

  if (!batched && records.length > INSPECTION_LIMIT) {
    die(`巡检摘要命中 ${records.length} 条，超过安全上限 ${INSPECTION_LIMIT}，拒绝输出不完整 records`);
  }
  // 单次完整读取、同一个 now；分批只改变输出装箱，不重查或截断尾页。
  const batches = [];
  if (batched) {
    for (let i = 0; i < records.length; i += INSPECTION_LIMIT) {
      const part = records.slice(i, i + INSPECTION_LIMIT);
      batches.push({ index: batches.length, count: part.length, records: part });
    }
  }
  console.log(JSON.stringify({
    ok: true,
    mode: batched ? "inspection-batches" : "inspection-summary",
    source_count: items.length,
    count: records.length,
    limit: INSPECTION_LIMIT,
    truncated: false,
    now_ms: now,
    timezone: "Asia/Shanghai",
    ...(batched ? { batch_count: batches.length, batches } : { records }),
  }));
}

async function cmdList(dueOnly) {
  const items = await fetchAll(await token());
  const now = Date.now();
  const records = [];
  for (const it of items) {
    const f = it.fields || {};
    const rec = {
      record_id: it.record_id,
      标题: flat(f["标题"]),
      状态: flat(f["状态"]),
      负责Agent: flat(f["负责Agent"]),
      所属部门: flat(f["所属部门"]),
      优先级: flat(f["优先级"]),
      审批级别: flat(f["审批级别"]),
      执行机器: flat(f["执行机器"]),
      下一步动作: flat(f["下一步动作"]),
      阻塞原因: flat(f["阻塞原因"]),
      结果记录: flat(f["结果记录"]),
      下次检查时间: f["下次检查时间"] ?? null,
    };
    if (dueOnly) {
      const nxt = f["下次检查时间"];
      if (!DUE_STATES.has(rec["状态"])) continue;
      if (typeof nxt !== "number" || nxt > now) continue;
    }
    records.push(rec);
  }
  console.log(JSON.stringify({ ok: true, count: records.length, now_ms: now, records }, null, 1));
}

async function cmdUpdate(rid, pairs) {
  const fields = parseFields(pairs);
  const T = await token();
  const r = await fetch(
    `https://open.feishu.cn/open-apis/bitable/v1/apps/${APP}/tables/${TABLE}/records/${rid}`,
    {
      method: "PUT",
      headers: { Authorization: "Bearer " + T, "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ fields }),
    },
  );
  const d = await r.json();
  const ok = d.code === 0;
  console.log(JSON.stringify({ ok, record_id: rid, updated: Object.keys(fields), error: ok ? null : d.msg }, null, 1));
  if (!ok) process.exit(1);
}

async function cmdCreate(pairs) {
  const fields = parseFields(pairs);
  if (!fields["标题"]) die("新建对象必须带 标题=...");
  const T = await token();
  const r = await fetch(
    `https://open.feishu.cn/open-apis/bitable/v1/apps/${APP}/tables/${TABLE}/records`,
    {
      method: "POST",
      headers: { Authorization: "Bearer " + T, "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ fields }),
    },
  );
  const d = await r.json();
  const ok = d.code === 0;
  console.log(JSON.stringify({
    ok,
    record_id: ok ? d.data.record.record_id : null,
    created: Object.keys(fields),
    error: ok ? null : d.msg,
  }, null, 1));
  if (!ok) process.exit(1);
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === "list" && rest.length === 0) await cmdList(false);
  else if (cmd === "list" && rest.length === 1 && rest[0] === "--due") await cmdList(true);
  else if (cmd === "list" && rest.length === 1 && rest[0] === "--inspection-summary") await cmdInspectionSummary();
  else if (cmd === "list" && rest.length === 1 && rest[0] === "--inspection-batches") await cmdInspectionSummary(true);
  else if (cmd === "update" && rest.length >= 2) await cmdUpdate(rest[0], rest.slice(1));
  else if (cmd === "create" && rest.length >= 1) await cmdCreate(rest);
  else die("用法: list [--due|--inspection-summary|--inspection-batches] | update <record_id> k=v ... | create 标题=... k=v ...");
}

try {
  await main();
} catch (err) {
  die("执行失败: " + (err instanceof Error ? err.message : String(err)));
}
