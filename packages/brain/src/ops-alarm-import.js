/**
 * ops-alarm-import — 闹钟总账静态快照导入（统一树+闹钟总账第 4 步，E.4，任务 fe10d1a0）。
 *
 * 输入：2026-10-04 盘点产出的 417 条闹钟（name/host/mech/freq/en/node/last/ok/st/note）。
 * 规则（方案 E.4）：
 *  - 已被采集腿/代码自动写入的来源（openclaw@mmv、crontab@mmv、crontab@us-vps、gha、Brain job、recurring）
 *    **不重复插行**，只在已有行上补挂树列（journey_id / tree_bucket_manual），并把采集腿存量行标
 *    registered_via='external-legacy'、ledger_status='registered'（存量基线，棘轮只许降）；
 *  - 其余来源（hk-vps cron/timer、m4/m1、xian-pc、NAS、zenithjoy-api 内部、MMV LaunchAgents、
 *    Brain 进程内循环……）以 source='inventory-20261004'、registered_via='external-legacy' 一次性插入静态快照，
 *    等对应采集腿上线后由采集覆盖并下线快照行；
 *  - 不迁移、不关停任何现有定时任务：本模块只写 ops_schedule_entries，不碰被登记对象本身；
 *  - 人工列（owner_manual/note_manual）永不写；已有 journey_id / tree_bucket_manual 不覆盖（人的结论优先）。
 * 幂等：重跑只会刷新快照行的机器列，已补的挂树列不动。
 */
import { INVENTORY_SOURCE } from './ops-alarm-ledger.js';
import { TREE_NODES_SQL } from './lib/tree-nodes-sql.js';

const BJ_OFFSET = '+08:00'; // 盘点时间全是北京时间
const VALID_STATUS = new Set(['正常', '失败', '静默', '无记录']);

/** 盘点来源 → 已有采集/自动写入行的键（source, host_alias）。null=没有采集腿，走静态快照。 */
function collectedTarget(item) {
  const host = String(item.host || '').trim();
  switch (item.mech) {
    case 'brain-job': return { source: 'brain', host: 'us-vps', via: 'brain-job' };
    case 'recurring_tasks': return { source: 'brain', host: 'local', via: 'recurring' };
    case 'openclaw-cron': return host === 'MMV' ? { source: 'openclaw', host: 'mmv', via: 'collector' } : null;
    case 'crontab':
      if (host === 'MMV') return { source: 'crontab', host: 'mmv', via: 'collector' };
      if (host === 'us-vps') return { source: 'crontab', host: 'us-vps', via: 'collector' };
      return null;
    case 'gha-schedule': return { source: 'gha', host: 'github', via: 'collector' };
    default: return null;
  }
}

/** 主机别名归一："hk-vps（n8n 容器）" → hk-vps；"MMV" → mmv（与采集腿 host_alias 同口径）。 */
export function normalizeHost(host) {
  const h = String(host ?? '').split(/[（(]/)[0].trim();
  return h === 'MMV' ? 'mmv' : h;
}

/**
 * 盘点名 → 采集腿已有行。盘点写的是逻辑名（"opc-okr-sync.py（5 条 cron 行）"、
 * "Kuaishou Publisher E2E（kuaishou-e2e.yml）"），采集腿 label 是 "脚本 @ cron" / "repo/workflow.yml"：
 * 以名字本身、首个词、括号里的文件名作标识符，按"整名 / 前缀 + ' @' / gha 文件后缀"匹配，可一对多。
 * 对不上的如实留在 unmatched，不猜——它们保持 unregistered，正是总账要暴露的存量。
 */
export function matchCollectedRows(item, target, existingRows) {
  const name = String(item.name);
  const tokens = new Set([name, name.split(/[（(\s]/)[0]]);
  for (const m of name.matchAll(/[\w.-]+\.(?:ya?ml|py|sh|mjs|js)/g)) tokens.add(m[0]);
  tokens.delete('');
  return existingRows.filter((r) => {
    if (r.source !== target.source || r.host_alias !== target.host) return false;
    const label = String(r.label);
    for (const t of tokens) {
      if (label === t || label.startsWith(`${t} @`)) return true;
      if (target.source === 'gha' && (label.endsWith(`/${t}`) || label.endsWith(`/${t}.yml`))) return true;
    }
    return false;
  });
}

/** "2026-10-04 09:24（推断）" → ISO（北京时间）；只有日期按 00:00；无记录/无法解析 → null。 */
export function parseInventoryTime(text) {
  const m = /(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/.exec(String(text ?? ''));
  if (!m) return null;
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4] ?? '00'}:${m[5] ?? '00'}:00${BJ_OFFSET}`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** "启用 / 启用（Ready）" → true；"禁用… / 未加载" → false；"待确认" 按启用算（备注里保留原文）。 */
export function parseEnabled(text) {
  const s = String(text ?? '');
  return !(s.startsWith('禁用') || s.startsWith('未加载'));
}

/**
 * journeys（价值流=无 parent，能力=有 parent，能力名形如「价值流 · 能力」）→ 解析器。
 * node 路径格式「部门 / 价值流 / 能力」（分隔符是带空格的 " / "，能力名里的 "GTD/秋米" 不能拆）。
 * 返回 { journeyId, bucket }：能找到能力→挂能力；只找到价值流→挂价值流并留 bucket 备注缺哪个能力；
 * 找不到（个人区/无/树上没有）→ journeyId=null，原文进 bucket（tree_bucket_manual 暂存，E.3）。
 */
export function buildJourneyResolver(journeys) {
  const live = journeys.filter((j) => j.status !== 'deleted');
  const streams = new Map(live.filter((j) => !j.parent_journey_id).map((j) => [j.name.trim(), j]));
  const capsByParent = new Map();
  for (const j of live) {
    if (!j.parent_journey_id) continue;
    const short = j.name.split(' · ').pop().trim();
    if (!capsByParent.has(j.parent_journey_id)) capsByParent.set(j.parent_journey_id, new Map());
    capsByParent.get(j.parent_journey_id).set(short, j);
    capsByParent.get(j.parent_journey_id).set(j.name.trim(), j);
  }
  // 盘点写「客户智能获客」、库里叫「客户智能获客路径」：前缀包含且唯一才算命中，歧义不猜
  const fuzzyStream = (seg) => {
    const hits = [...streams.values()].filter((j) => j.name.startsWith(seg) || seg.startsWith(j.name));
    return hits.length === 1 ? hits[0] : null;
  };
  return function resolve(node) {
    const text = String(node ?? '').trim();
    const segs = text.split(' / ').map((x) => x.trim());
    if (segs.length < 3) return { journeyId: null, bucket: text || null };
    const stream = streams.get(segs[1]) ?? fuzzyStream(segs[1]);
    if (!stream) return { journeyId: null, bucket: text };
    const caps = capsByParent.get(stream.id);
    let cap = caps?.get(segs[2]);
    if (!cap && caps) {
      // 盘点写「F0 提案拍板」、库里是「F0 提案拍板闭环」/「GP-C 朋友圈发布」：互相包含且唯一才算命中，歧义不猜
      const hits = [...new Set(caps.values())].filter((c) => {
        const short = c.name.split(' · ').pop().trim();
        return short.includes(segs[2]) || segs[2].includes(short);
      });
      if (hits.length === 1) cap = hits[0];
    }
    if (cap) return { journeyId: cap.id, bucket: null };
    return { journeyId: stream.id, bucket: `${text}（树上暂无该能力，先挂价值流）` };
  };
}

/**
 * 纯函数：把盘点条目规划成 {补挂树更新, 静态快照插入, 未匹配}。existingRows 是已有行（source/host_alias/label）。
 */
export function planInventoryImport(items, journeys, existingRows) {
  const resolve = buildJourneyResolver(journeys);
  const plan = { tree_updates: [], inserts: [], unmatched: [], unresolved_tree: [] };
  const usedLabels = new Set();

  for (const item of items) {
    const { journeyId, bucket } = resolve(item.node);
    if (!journeyId) plan.unresolved_tree.push({ name: item.name, node: item.node });
    const target = collectedTarget(item);

    if (target) {
      const rows = target.via === 'collector'
        ? matchCollectedRows(item, target, existingRows)
        : existingRows.filter((r) => r.source === target.source && r.host_alias === target.host && r.label === item.name);
      if (rows.length > 0) {
        for (const row of rows) {
          plan.tree_updates.push({
            id: row.id, label: row.label, source: row.source,
            journey_id: journeyId, bucket, baseline: target.via === 'collector',
          });
        }
        continue;
      }
      // recurring 模板只有"活"的才会被代码落表；盘点里已停用的模板没有行可挂，转静态快照留档
      if (target.via !== 'recurring') { plan.unmatched.push({ name: item.name, source: target.source, host: target.host }); continue; }
    }

    // 静态快照行：同 (host,name) 重名加序号，防唯一键互相覆盖
    const host = normalizeHost(item.host);
    let label = item.name;
    let n = 2;
    while (usedLabels.has(`${host}|${label}`)) label = `${item.name} #${n++}`;
    usedLabels.add(`${host}|${label}`);
    const enabled = parseEnabled(item.en);
    plan.inserts.push({
      host_alias: host, label, kind: item.mech, schedule_desc: String(item.freq ?? ''),
      enabled, last_state: enabled ? null : 'disabled',
      last_run_at: parseInventoryTime(item.last), last_success_at: parseInventoryTime(item.ok),
      last_status: VALID_STATUS.has(item.st) ? item.st : '无记录',
      note: item.note ? String(item.note) : null,
      journey_id: journeyId, bucket,
    });
  }
  return plan;
}

/** 执行导入（一个事务）。dryRun=true 只返回规划摘要。 */
export async function importInventorySnapshot(pool, items, { dryRun = false, now = new Date() } = {}) {
  const { rows: journeys } = await pool.query(`SELECT id, name, parent_journey_id, status FROM ${TREE_NODES_SQL} n`);
  const { rows: existingRows } = await pool.query(
    `SELECT id, source, host_alias, label FROM ops_schedule_entries
      WHERE source IN ('brain','openclaw','crontab','gha')`);
  const plan = planInventoryImport(items, journeys, existingRows);
  const summary = {
    items: items.length, tree_updates: plan.tree_updates.length, inserts: plan.inserts.length,
    unmatched: plan.unmatched, unresolved_tree: plan.unresolved_tree.length, dry_run: dryRun,
  };
  if (dryRun) return { ...summary, unresolved_tree_sample: plan.unresolved_tree.slice(0, 20) };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const u of plan.tree_updates) {
      // 只补空：已有 journey_id / tree_bucket_manual 是人的结论，不覆盖。
      // baseline（采集腿存量行）才升 registered；Brain job / recurring 行本来就是 registered，不动登记列。
      await client.query(
        `UPDATE ops_schedule_entries SET
           journey_id = COALESCE(journey_id, $2),
           tree_bucket_manual = COALESCE(tree_bucket_manual, $3),
           registered_via = CASE WHEN $4 THEN COALESCE(registered_via, 'external-legacy') ELSE registered_via END,
           ledger_status = CASE WHEN $4 AND ledger_status = 'unregistered' THEN 'registered' ELSE ledger_status END
         WHERE id = $1`,
        [u.id, u.journey_id, u.bucket, u.baseline],
      );
    }
    for (const r of plan.inserts) {
      await client.query(
        `INSERT INTO ops_schedule_entries
           (source, host_alias, label, kind, schedule_desc, last_state, active, enabled,
            last_run_at, last_success_at, last_status, note, journey_id, tree_bucket_manual,
            registered_via, ledger_status, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,TRUE,$7,$8,$9,$10,$11,$12,$13,'external-legacy','registered',$14)
         ON CONFLICT (source, host_alias, label) DO UPDATE SET
           kind=EXCLUDED.kind, schedule_desc=EXCLUDED.schedule_desc, last_state=EXCLUDED.last_state,
           active=TRUE, enabled=EXCLUDED.enabled, last_run_at=EXCLUDED.last_run_at,
           last_success_at=EXCLUDED.last_success_at, last_status=EXCLUDED.last_status, note=EXCLUDED.note,
           journey_id=COALESCE(ops_schedule_entries.journey_id, EXCLUDED.journey_id),
           tree_bucket_manual=COALESCE(ops_schedule_entries.tree_bucket_manual, EXCLUDED.tree_bucket_manual),
           registered_via=EXCLUDED.registered_via, ledger_status=EXCLUDED.ledger_status, updated_at=EXCLUDED.updated_at`,
        [INVENTORY_SOURCE, r.host_alias, r.label, r.kind, r.schedule_desc, r.last_state, r.enabled,
          r.last_run_at, r.last_success_at, r.last_status, r.note, r.journey_id, r.bucket, now.toISOString()],
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  return summary;
}
