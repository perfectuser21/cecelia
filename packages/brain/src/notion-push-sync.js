import { notionReq, getToken } from './recurring-notion-sync.js';

const JOURNEY_DB = '358c40c2-ba63-8148-bde7-e313d789931a';
const FEATURE_DB = '358c40c2-ba63-81e3-96c5-d762b3d34dff';
const ISSUES_DB  = 'a17c40c2-ba63-82fb-9888-8152cefe29ec';
const DECISIONS_DB           = '1b2c40c2-ba63-8101-ae1e-d1e2f3a4b5c6';
const INITIATIVE_CONTRACTS_DB = '2c3d40c2-ba63-8102-bf2f-e2f3a4b5c6d7';

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
      if (j.e2e_test_path) {
        properties['E2E Test Path'] = { rich_text: buildRichText(j.e2e_test_path) };
      }
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
        Thickness: { select: { name: f.thickness } },
        Status: { select: { name: f.status || 'planned' } },
      };
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
        properties['Source'] = { rich_text: buildRichText(s.location) };
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
        Name:   { title: [{ text: { content: s.name } }] },
        Status: { select: { name: s.status || 'planned' } },
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
      AND j.notion_id IS NOT NULL
      AND s.notion_id IS NOT NULL
    LIMIT 10
  `);
  for (const l of rows) {
    try {
      const properties = {
        Name:   { title: [{ text: { content: `${l.journey_name} — ${l.step_name}` } }] },
        Status: { select: { name: l.status || 'planned' } },
        Order:  { number: l.step_order },
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
  const { rows } = await pool.query(
    'SELECT * FROM decisions WHERE notion_synced_at IS NULL LIMIT 10'
  );

  for (const d of rows) {
    try {
      const properties = {
        Name: { title: [{ text: { content: d.topic || d.decision || String(d.id) } }] },
        Status: { select: { name: d.status || 'active' } },
      };
      if (d.category) {
        properties['Category'] = { rich_text: buildRichText(d.category) };
      }
      if (d.decision) {
        properties['Decision'] = { rich_text: buildRichText(d.decision) };
      }
      if (d.reason) {
        properties['Reason'] = { rich_text: buildRichText(d.reason) };
      }

      const page = await notionReq(token, '/pages', 'POST', {
        parent: { database_id: DECISIONS_DB },
        properties,
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
      const properties = {
        Name: { title: [{ text: { content: `Contract ${ic.initiative_id} v${ic.version}` } }] },
        Status: { select: { name: ic.status || 'draft' } },
        Version: { number: ic.version },
      };
      if (ic.prd_content) {
        properties['PRD'] = { rich_text: buildRichText(ic.prd_content) };
      }

      const page = await notionReq(token, '/pages', 'POST', {
        parent: { database_id: INITIATIVE_CONTRACTS_DB },
        properties,
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
}
