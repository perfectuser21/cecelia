import { notionReq, getToken } from './recurring-notion-sync.js';
import { computeProgress } from './advancement-progress.js';

const JOURNEY_DB = '358c40c2-ba63-8148-bde7-e313d789931a';
const FEATURE_DB = '358c40c2-ba63-81e3-96c5-d762b3d34dff';
const ISSUES_DB  = 'a17c40c2-ba63-82fb-9888-8152cefe29ec';
// AI Notes DB — decisions 用 Type=Decision，initiative_contracts 用 Type=Contract
const DECISIONS_DB           = '185c40c2-ba63-828c-973f-81a9c4582cd6';
const INITIATIVE_CONTRACTS_DB = '185c40c2-ba63-828c-973f-81a9c4582cd6';

const SKILL_REGISTRY_DB  = '353c40c2-ba63-81bf-ae3e-f0e6fa3753d7';
const STEPS_DB           = '369c40c2-ba63-812c-9f35-e7e43db25014';
const STEP_LINKS_DB      = '369c40c2-ba63-81e2-b95a-e5e3d0592676';

const SUB_AREA_NOTION_IDS = {
  brain:         '5c0c40c2-ba63-8184-bc3d-f1c5e48caee4',
  engine:        '64bc40c2-ba63-81b0-a7e2-c2f7bb3b2e31',
  cecelia:       '7e7c40c2-ba63-8117-8d5d-e3e18a3c6b04',
  'multi-agent': '8acc40c2-ba63-810b-8e07-c5c3d34d8e13',
  zenithjoy:     'cf5c40c2-ba63-8182-9b3e-f2d1a4e5c6f0',
  dashboard:     'a17c40c2-ba63-83e2-9c3d-b4e2f1a5c7d8',
};

function buildRichText(text) {
  if (!text) return [];
  return [{ type: 'text', text: { content: String(text).slice(0, 2000) } }];
}

/**
 * 把一条 decision 映射成 Notion AI Notes 库的 properties。
 * 纯函数 — 不打 Notion 网络，可独立确定性验证（合同 Golden Path Step 2 oracle）。
 *
 * - level → Level 属性
 * - scope → Scope 属性
 * - ability 的 notion_id → Ability relation（链到对应 ability 页）
 *
 * @param {object} decision  decisions 裸行（含 level/scope/topic/decision...）
 * @param {string|null} abilityNotionId  target ability 的 journey_features.notion_id
 * @param {object} schemaProps  可选：AI Notes 库的 properties schema（{ Level: {type}, Scope: {type} }）。
 *   用于把 Level/Scope 发成库实际属性类型（status vs select）—— 参照 Feature 库 Status 必须用
 *   status 类型的教训（发错类型 Notion 返回 400）。schema 取不到时回退 select。
 */
export function buildDecisionNotionProperties(decision = {}, abilityNotionId = null, schemaProps = {}) {
  const title = decision.topic
    || (decision.decision ? String(decision.decision).slice(0, 100) : '')
    || String(decision.id || '');
  const properties = {
    Title: { title: [{ text: { content: title } }] },
    Type: { select: { name: 'Decision' } },
  };
  // 按库实际属性类型发 Level/Scope；schema 缺失时默认 select（多数自定义属性为 select）
  const typedValue = (propName, value) =>
    schemaProps?.[propName]?.type === 'status'
      ? { status: { name: value } }
      : { select: { name: value } };
  if (decision.level) properties.Level = typedValue('Level', decision.level);
  if (decision.scope) properties.Scope = typedValue('Scope', decision.scope);
  // ability relation —— 属性名优先用 schema 里的 relation 字段名，回退 'Ability'
  if (abilityNotionId) {
    const relProp = Object.keys(schemaProps || {}).find(
      (k) => schemaProps[k]?.type === 'relation' && /abilit/i.test(k)
    ) || 'Ability';
    properties[relProp] = { relation: [{ id: abilityNotionId }] };
  }
  return properties;
}

// 404 "Could not find page" = stale relation ID，永久标记为已同步阻止无限重试
function isStaleRelationError(err) {
  return err.message && err.message.includes('Could not find page');
}

async function logSyncError(pool, errMsg) {
  await pool.query(
    `INSERT INTO notion_sync_log (direction, records_synced, records_failed, error_message)
     VALUES ('to_notion', 0, 1, $1)`,
    [errMsg]
  ).catch(() => {});
}

async function pushJourneys(pool, token) {
  const { rows } = await pool.query(`
    SELECT j.*, a.notion_id AS area_notion_id
    FROM journeys j
    LEFT JOIN areas a ON a.id = j.area_id
    WHERE j.notion_synced_at IS NULL
    LIMIT 10
  `);

  for (const j of rows) {
    try {
      const properties = {
        Name: { title: [{ text: { content: j.name } }] },
        Description: { rich_text: buildRichText(j.description) },
        'Journey Type': { select: { name: j.journey_type } },
        Maturity: { select: { name: j.maturity } },
        Status: { select: { name: j.status || 'active' } },
      };
      // E2E Test Path 字段在 Notion Journey DB 不存在，已移除推送
      if (j.area_notion_id) {
        properties['Area'] = { relation: [{ id: j.area_notion_id }] };
      }

      const page = await notionReq(token, '/pages', 'POST', {
        parent: { database_id: JOURNEY_DB },
        properties,
      });

      await pool.query(
        'UPDATE journeys SET notion_id=$1, notion_synced_at=NOW() WHERE id=$2',
        [page.id, j.id]
      );
    } catch (err) {
      console.warn(`[notion-push-sync] journey ${j.id} 推送失败: ${err.message}`);
      await logSyncError(pool, err.message);
    }
  }
}

async function pushJourneyFeatures(pool, token) {
  const { rows } = await pool.query(`
    SELECT f.*, j.notion_id AS journey_notion_id, a.notion_id AS area_notion_id
    FROM journey_features f
    LEFT JOIN journeys j ON j.id = f.journey_id
    LEFT JOIN areas a ON a.id = f.area_id
    WHERE f.notion_synced_at IS NULL
      AND (f.journey_id IS NULL OR j.notion_id IS NOT NULL)
    LIMIT 10
  `);

  for (const f of rows) {
    try {
      const properties = {
        Name: { title: [{ text: { content: f.name } }] },
        // Kind: Notion select 选项为首字母大写 Ability/Feature；DB 存小写 → 映射，避免自动创建重复小写选项
        Kind: { select: { name: (f.kind || 'feature') === 'ability' ? 'Ability' : 'Feature' } },
        // Status: Notion Feature 库该属性是 status 类型（非 select）；发 select 会 400「Status is expected to be status」。
        // DB 的值(planned/working/building/broken/deprecated/done)与 Notion status 选项一一匹配，仅类型需对齐。
        Status: { status: { name: f.status || 'planned' } },
      };
      if (f.thickness) {
        properties['Thickness'] = { select: { name: f.thickness } };
      }
      if (f.journey_notion_id) {
        properties['Journey'] = { relation: [{ id: f.journey_notion_id }] };
      }
      if (f.area_notion_id) {
        properties['Area'] = { relation: [{ id: f.area_notion_id }] };
      }
      if (f.unit_test_path) {
        properties['Unit Test Path'] = { rich_text: buildRichText(f.unit_test_path) };
      }

      const page = await notionReq(token, '/pages', 'POST', {
        parent: { database_id: FEATURE_DB },
        properties,
      });

      await pool.query(
        'UPDATE journey_features SET notion_id=$1, notion_synced_at=NOW() WHERE id=$2',
        [page.id, f.id]
      );
    } catch (err) {
      console.warn(`[notion-push-sync] feature ${f.id} 推送失败: ${err.message}`);
      await logSyncError(pool, err.message);
      if (isStaleRelationError(err)) {
        await pool.query('UPDATE journey_features SET notion_synced_at=NOW() WHERE id=$1', [f.id]).catch(() => {});
      }
    }
  }
}

async function pushIssues(pool, token) {
  const { rows } = await pool.query(
    'SELECT * FROM issues WHERE notion_synced_at IS NULL LIMIT 10'
  );

  for (const issue of rows) {
    try {
      const properties = {
        Issue: { title: [{ text: { content: issue.title } }] },
        Priority: { select: { name: issue.priority || 'P2' } },
        Status: { status: { name: issue.status || 'In progress' } },
      };
      if (issue.sub_area && SUB_AREA_NOTION_IDS[issue.sub_area]) {
        properties['Sub Area'] = { relation: [{ id: SUB_AREA_NOTION_IDS[issue.sub_area] }] };
      }

      const page = await notionReq(token, '/pages', 'POST', {
        parent: { database_id: ISSUES_DB },
        properties,
        children: issue.body ? [{
          object: 'block',
          type: 'paragraph',
          paragraph: { rich_text: buildRichText(issue.body) },
        }] : undefined,
      });

      await pool.query(
        'UPDATE issues SET notion_id=$1, notion_synced_at=NOW() WHERE id=$2',
        [page.id, issue.id]
      );
    } catch (err) {
      console.warn(`[notion-push-sync] issue ${issue.id} 推送失败: ${err.message}`);
      await logSyncError(pool, err.message);
      if (isStaleRelationError(err)) {
        await pool.query('UPDATE issues SET notion_synced_at=NOW() WHERE id=$1', [issue.id]).catch(() => {});
      }
    }
  }
}

async function pushSkillRegistry(pool, token) {
  const { rows } = await pool.query(
    `SELECT * FROM skill_registry WHERE notion_synced_at IS NULL LIMIT 10`
  );
  for (const s of rows) {
    try {
      const properties = {
        Name:        { title: [{ text: { content: s.name } }] },
        Description: { rich_text: buildRichText(s.description) },
        Status:      { select: { name: s.status || 'active' } },
      };
      if (s.location) {
        properties['Source'] = { select: { name: s.location } };
      }
      const page = await notionReq(token, '/pages', 'POST', {
        parent: { database_id: SKILL_REGISTRY_DB },
        properties,
      });
      await pool.query(
        'UPDATE skill_registry SET notion_id=$1, notion_synced_at=NOW() WHERE id=$2',
        [page.id, s.id]
      );
    } catch (err) {
      console.warn(`[notion-push-sync] skill ${s.id} 推送失败: ${err.message}`);
      await logSyncError(pool, err.message);
    }
  }
}

async function pushJourneySteps(pool, token) {
  const { rows } = await pool.query(`
    SELECT s.*, j.notion_id AS journey_notion_id
    FROM journey_steps s
    LEFT JOIN journeys j ON j.id = s.journey_id
    WHERE s.notion_synced_at IS NULL
      AND j.notion_id IS NOT NULL
    LIMIT 10
  `);
  for (const s of rows) {
    try {
      const properties = {
        Name: { title: [{ text: { content: s.name } }] },
        // Status 字段在 Notion Steps DB 不存在，已移除推送
      };
      if (s.description) {
        properties['Description'] = { rich_text: buildRichText(s.description) };
      }
      if (s.journey_notion_id) {
        properties['Journey'] = { relation: [{ id: s.journey_notion_id }] };
      }
      const page = await notionReq(token, '/pages', 'POST', {
        parent: { database_id: STEPS_DB },
        properties,
      });
      await pool.query(
        'UPDATE journey_steps SET notion_id=$1, notion_synced_at=NOW() WHERE id=$2',
        [page.id, s.id]
      );
    } catch (err) {
      console.warn(`[notion-push-sync] step ${s.id} 推送失败: ${err.message}`);
      await logSyncError(pool, err.message);
    }
  }
}

async function pushJourneyStepLinks(pool, token) {
  const { rows } = await pool.query(`
    SELECT l.*, j.notion_id AS journey_notion_id, s.notion_id AS step_notion_id,
           j.name AS journey_name, s.name AS step_name
    FROM journey_step_links l
    LEFT JOIN journeys j ON j.id = l.journey_id
    LEFT JOIN journey_steps s ON s.id = l.step_id
    WHERE l.notion_synced_at IS NULL
      AND l.cell_kind IS NULL
      AND j.notion_id IS NOT NULL
      AND s.notion_id IS NOT NULL
    LIMIT 10
  `);
  if (rows.length === 0) return;

  let schemaProps = {};
  try {
    const schema = await notionReq(token, `/databases/${STEP_LINKS_DB}`, 'GET');
    schemaProps = schema?.properties || {};
  } catch {
    schemaProps = {};
  }

  for (const l of rows) {
    try {
      const properties = {
        Name:   { title: [{ text: { content: `${l.journey_name} — ${l.step_name}` } }] },
        Status: { select: { name: l.status || 'planned' } },
        ...('Order' in schemaProps && { Order: { number: l.step_order } }),
      };
      if (l.journey_notion_id) {
        properties['Journey'] = { relation: [{ id: l.journey_notion_id }] };
      }
      if (l.step_notion_id) {
        properties['Step'] = { relation: [{ id: l.step_notion_id }] };
      }
      const page = await notionReq(token, '/pages', 'POST', {
        parent: { database_id: STEP_LINKS_DB },
        properties,
      });
      await pool.query(
        'UPDATE journey_step_links SET notion_id=$1, notion_synced_at=NOW() WHERE id=$2',
        [page.id, l.id]
      );
    } catch (err) {
      console.warn(`[notion-push-sync] step_link ${l.id} 推送失败: ${err.message}`);
      await logSyncError(pool, err.message);
    }
  }
}

async function pushDecisions(pool, token) {
  // 去重：只取未同步行（notion_synced_at IS NULL）；LEFT JOIN journey_features
  // 取 target ability 的 notion_id，供映射成 Notion relation 链
  const { rows } = await pool.query(
    `SELECT d.*, jf.notion_id AS ability_notion_id
       FROM decisions d
       LEFT JOIN journey_features jf
         ON jf.id = d.target_id AND d.target_type = 'journey_feature'
      WHERE d.notion_synced_at IS NULL
      LIMIT 10`
  );
  // 无待同步行直接返回，不触碰 Notion API（与其他 push 函数一致的去重边界）
  if (rows.length === 0) return;

  // 取一次 AI Notes 库 schema：决定 Level/Scope 属性类型（status vs select），
  // 并据此判断 Level/Scope/ability relation 等自定义属性是否真实存在 —— 库里没有的属性
  // 一旦发出 Notion 会 400「is not a property that exists」，故缺列时跳过该属性。
  let schemaProps = {};
  try {
    const schema = await notionReq(token, `/databases/${DECISIONS_DB}`, 'GET');
    schemaProps = schema?.properties || {};
  } catch {
    schemaProps = {};
  }

  for (const d of rows) {
    try {
      // Type=Decision / Title / Level / Scope / ability relation 由 buildDecisionNotionProperties 统一构造
      const mapped = buildDecisionNotionProperties(d, d.ability_notion_id, schemaProps);
      // Title/Type 是 AI Notes 基础属性恒发；其余自定义属性（Level/Scope/Ability）只在库 schema
      // 真实存在时才发，避免对未建列的库 400（合同 assumption：Level/Scope 字段「已有或可加」）
      const properties = {};
      for (const [k, v] of Object.entries(mapped)) {
        if (k === 'Title' || k === 'Type' || k in schemaProps) properties[k] = v;
      }
      if (d.created_at) {
        properties.Date = { date: { start: d.created_at.toISOString?.() || d.created_at } };
      }
      const bodyLines = [
        d.decision && `**决策**: ${d.decision}`,
        d.reason && `**原因**: ${d.reason}`,
        d.category && `**分类**: ${d.category}`,
      ].filter(Boolean).join('\n\n');

      const page = await notionReq(token, '/pages', 'POST', {
        parent: { database_id: DECISIONS_DB },
        properties,
        children: bodyLines ? [{ object: 'block', type: 'paragraph', paragraph: { rich_text: buildRichText(bodyLines) } }] : [],
      });

      await pool.query(
        'UPDATE decisions SET notion_id=$1, notion_synced_at=NOW() WHERE id=$2',
        [page.id, d.id]
      );
    } catch (err) {
      console.warn(`[notion-push-sync] decision ${d.id} 推送失败: ${err.message}`);
      await logSyncError(pool, err.message);
    }
  }
}

async function pushInitiativeContracts(pool, token) {
  const { rows } = await pool.query(
    'SELECT * FROM initiative_contracts WHERE notion_synced_at IS NULL LIMIT 10'
  );

  for (const ic of rows) {
    try {
      const title = `Contract ${String(ic.initiative_id).slice(0, 8)} v${ic.version}`;
      const properties = {
        Title: { title: [{ text: { content: title } }] },
        Type: { select: { name: 'Contract' } },
        ...(ic.approved_at ? { Date: { date: { start: ic.approved_at.toISOString?.() || ic.approved_at } } } : {}),
      };
      const bodyLines = [
        ic.status && `**状态**: ${ic.status}`,
        ic.review_rounds != null && `**GAN 轮次**: ${ic.review_rounds}`,
        ic.prd_content && `**Sprint PRD**:\n${ic.prd_content.slice(0, 1800)}`,
      ].filter(Boolean).join('\n\n');

      const page = await notionReq(token, '/pages', 'POST', {
        parent: { database_id: INITIATIVE_CONTRACTS_DB },
        properties,
        children: bodyLines ? [{ object: 'block', type: 'paragraph', paragraph: { rich_text: buildRichText(bodyLines) } }] : [],
      });

      await pool.query(
        'UPDATE initiative_contracts SET notion_id=$1, notion_synced_at=NOW() WHERE id=$2',
        [page.id, ic.id]
      );
    } catch (err) {
      console.warn(`[notion-push-sync] initiative_contract ${ic.id} 推送失败: ${err.message}`);
      await logSyncError(pool, err.message);
    }
  }
}

async function pushAdvancementItems(pool, token) {
  // 按 ability 聚合该 ability **全部**推进项的累积进度（非仅未同步子集）——
  // WHERE 子查询只用来判断"这个 ability 这一轮有没有变化值得推"，
  // 但 COUNT 必须覆盖全量行，否则 done/total 只反映本轮新增/变化的子集，
  // 会把之前已推的正确进度（如 2/4=50%）覆盖成错误的子集进度（如 0/1=0%）。
  const { rows } = await pool.query(`
    SELECT ai.ability_id, jf.notion_id AS ability_notion_id,
           COUNT(*) FILTER (WHERE ai.status='done')  AS done,
           COUNT(*) FILTER (WHERE ai.status='doing') AS doing,
           COUNT(*) FILTER (WHERE ai.status='todo')  AS todo
    FROM advancement_items ai
    JOIN journey_features jf ON jf.id = ai.ability_id
    WHERE jf.notion_id IS NOT NULL
      AND ai.ability_id IN (
        SELECT ability_id FROM advancement_items WHERE notion_synced_at IS NULL
      )
    GROUP BY ai.ability_id, jf.notion_id
    LIMIT 10
  `);
  if (rows.length === 0) return;

  // 取一次 Feature 库 schema：只有目标属性真实存在才 PATCH，避免对未建列的库 400
  // （同 pushDecisions 的 schema-check 安全模式）
  let schemaProps = {};
  try {
    const schema = await notionReq(token, `/databases/${FEATURE_DB}`, 'GET');
    schemaProps = schema?.properties || {};
  } catch {
    schemaProps = {};
  }
  const progressProp = Object.keys(schemaProps).find((k) => /advancement.*progress/i.test(k));

  for (const r of rows) {
    try {
      if (progressProp) {
        const { done, total, pct } = computeProgress({
          done: Number(r.done), doing: Number(r.doing), todo: Number(r.todo),
        });
        await notionReq(token, `/pages/${r.ability_notion_id}`, 'PATCH', {
          properties: {
            [progressProp]: { rich_text: buildRichText(`${done}/${total} 完成 (${pct}%)`) },
          },
        });
      }
      // 无论是否真的发了 PATCH（属性不存在时跳过），都标记已同步——
      // 属性缺失是"Notion 库未建列"的运维状态，不是"应无限重试"的瞬时错误
      // 已知限制（PR3 前提）：PATCH /api/brain/advancements/:itemId（routes/abilities.js）
      // 改 status 时不会把 notion_synced_at 重置回 NULL，所以已同步过的推进项状态再变化
      // 不会触发下一轮重新推送——这需要改 abilities.js 的 PATCH 端点（本 PR 范围外，不动
      // 现有三个 advancement 端点），留给 PR3 军师上游 producer 一并接线。
      await pool.query(
        `UPDATE advancement_items SET notion_synced_at=NOW() WHERE ability_id=$1 AND notion_synced_at IS NULL`,
        [r.ability_id]
      );
    } catch (err) {
      console.warn(`[notion-push-sync] advancement ability ${r.ability_id} 推送失败: ${err.message}`);
      await logSyncError(pool, err.message);
    }
  }
}

export async function runNotionPushSync(pool) {
  let token;
  try {
    token = getToken();
  } catch {
    return;
  }

  await pushJourneys(pool, token);
  await pushJourneyFeatures(pool, token);
  await pushIssues(pool, token);
  await pushSkillRegistry(pool, token);
  await pushJourneySteps(pool, token);
  await pushJourneyStepLinks(pool, token);
  await pushDecisions(pool, token);
  await pushInitiativeContracts(pool, token);
  await pushAdvancementItems(pool, token);
}

export function scheduleLegacyNotionPush(pool, {
  env = process.env,
  setIntervalFn = setInterval,
  run = runNotionPushSync,
  logger = console,
} = {}) {
  if (env.NOTION_LEGACY_PUSH_ENABLED !== 'true') {
    logger.log('[legacy-notion-push] disabled; canonical Tasks/Projects projection remains active');
    return { enabled: false, timer: null };
  }

  const execute = async () => {
    try {
      await run(pool);
    } catch (error) {
      logger.warn('[legacy-notion-push] run failed:', error.message);
    }
  };
  const timer = setIntervalFn(execute, 5 * 60 * 1000);
  if (typeof timer?.unref === 'function') timer.unref();
  logger.log('[legacy-notion-push] enabled (5min interval)');
  return { enabled: true, timer };
}
