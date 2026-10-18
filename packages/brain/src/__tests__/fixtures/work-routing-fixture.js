export async function seedActiveF1(client, scope='cecelia', node='F1') {
  await client.query(`SELECT pg_advisory_xact_lock(hashtext('work-routing-active-f1-fixture'))`);
  let manifest = (await client.query(
    `SELECT id,scope_key,digest FROM map_manifest_versions WHERE scope_key='${scope}' AND status='active'`,
  )).rows[0];
  if (!manifest) {
    const decisionId = crypto.randomUUID();
    const manifestId = crypto.randomUUID();
    const digest = crypto.randomUUID().replaceAll('-', '').repeat(2);
    const version = (await client.query(
      `SELECT COALESCE(MAX(version),0)+1 AS version FROM map_manifest_versions WHERE scope_key='${scope}'`,
    )).rows[0].version;
    await client.query(
      `INSERT INTO decisions(id,category,topic,decision) VALUES($1,'testing','routing fixture','active F1')`,
      [decisionId],
    );
    await client.query(
      `INSERT INTO map_manifest_versions(
         id,scope_key,version,source_decision_id,manifest,digest,status,activated_at
       ) VALUES($1,'${scope}',$2,$3,$4::jsonb,$5,'active',NOW())`,
      [manifestId, version, decisionId, JSON.stringify({
        scope_key: scope, schema_version: 1, source_decision_id: decisionId,
      }), digest],
    );
    manifest = { id: manifestId, scope_key: scope, digest };
  }
  let runId = (await client.query(
    `SELECT id FROM map_projection_runs WHERE scope_key='${scope}' AND status='active'`,
  )).rows[0]?.id;
  if (!runId) {
    runId = crypto.randomUUID();
    await client.query(
      `INSERT INTO map_projection_runs(
         id,scope_key,manifest_version_id,manifest_digest,fact_revisions,
         projector_version,projection_digest,status,activated_at
       ) VALUES($1,'${scope}',$2,$3,'{}','test-v1',$4,'active',NOW())`,
      [runId, manifest.id, manifest.digest, crypto.randomUUID().replaceAll('-', '').repeat(2)],
    );
  }
  await client.query(
    `INSERT INTO map_projection_nodes(run_id,node_id,node_type,node_key,name)
     SELECT $1,$2,'capability','${node}','Factory F1'
      WHERE NOT EXISTS (
        SELECT 1 FROM map_projection_nodes WHERE run_id=$1 AND node_key='${node}'
      )`,
    [runId, crypto.randomUUID().replaceAll('-', '').repeat(2)],
  );
}

export async function ensureRouteValidationFixtureSchema(client) {
  await client.query(
    'ALTER TABLE work_routing_receipts ADD COLUMN IF NOT EXISTS map_scope_validation_version text',
  );
  await client.query(
    'ALTER TABLE work_routing_receipts ADD COLUMN IF NOT EXISTS direct_contract_seed jsonb',
  );
}
