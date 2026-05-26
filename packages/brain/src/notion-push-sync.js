import { notionReq, getToken } from './recurring-notion-sync.js';

const JOURNEY_DB = '358c40c2-ba63-8148-bde7-e313d789931a';
const FEATURE_DB = '358c40c2-ba63-81e3-96c5-d762b3d34dff';
const ISSUES_DB  = 'a17c40c2-ba63-82fb-9888-8152cefe29ec';

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
}
