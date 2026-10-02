import { afterEach, beforeEach, expect, it } from 'vitest';
import {
  loadHistoricalImplementationContext,
  loadImplementationRevisionContext,
  resolveImplementationRegistryRepo,
} from '../../implementation-context.js';
import { implementationImpactDatabase, IMPACT_REPO } from '../../../__tests__/fixtures/implementation-impact-db.js';

const revision = 'a'.repeat(40);
const query = { scope: 'phones', repo: IMPACT_REPO, revision };
let fixture;
beforeEach(async () => { fixture = await implementationImpactDatabase(); });
afterEach(async () => { await fixture?.close(); });

it('缺失或歧义历史投影保持未知，固定Workflow membership不借head改写', async () => {
  const { db, ids } = fixture;
  const version = (await db.query(
    'SELECT current_definition_version_id id, capability_id FROM workflows WHERE id=$1', [ids.benchmark],
  )).rows[0];
  const historyQuery = { ...query, versionId: version.id };
  await fixture.advance({ remove: true });
  const gaps = [];
  const original = await loadImplementationRevisionContext(db, query, revision, 'phone-source', null, gaps);
  expect(gaps).toEqual([]);
  expect(original.mapped.has(version.capability_id)).toBe(true);
  await db.query(
    `INSERT INTO map_projection_runs
      (scope_key,manifest_version_id,manifest_digest,fact_revisions,projector_version,projection_digest,status,activated_at)
     VALUES('phones',$1,$2,$3,'ambiguous-v1',$4,'superseded',NOW())`,
    [original.manifest_version_id, original.manifest_digest, { 'phone-source': revision }, 'e'.repeat(64)],
  );
  const ambiguousGaps = [];
  const ambiguous = await loadHistoricalImplementationContext(db, historyQuery, ambiguousGaps);
  expect(ambiguous).toMatchObject({ scope_status: 'unknown', projection_run_id: null });
  expect([...ambiguous.mapped.entries()]).toEqual([[version.capability_id, null]]);
  expect(ambiguousGaps).toContainEqual({ code: 'projection_snapshot_ambiguous', revision });
  await db.query("DELETE FROM map_projection_runs WHERE fact_revisions->>'phone-source'=$1", [revision]);
  const missingGaps = [];
  const missing = await loadHistoricalImplementationContext(db, historyQuery, missingGaps);
  expect(missing).toMatchObject({ scope_status: 'unknown', projection_run_id: null });
  expect([...missing.mapped.entries()]).toEqual([[version.capability_id, null]]);
  expect(missingGaps).toContainEqual({ code: 'projection_snapshot_missing', revision });
});

it('显式repo别名按scope唯一定位，跨scope不串，未登记和多登记均拒绝', async () => {
  const { db } = fixture;
  await expect(resolveImplementationRegistryRepo(db, query)).resolves.toBe('phone-source');
  await expect(resolveImplementationRegistryRepo(db, { ...query, scope: 'other' }))
    .rejects.toMatchObject({ code: 'MAP_IMPLEMENTATION_REPO_NOT_CONFIGURED', status: 422 });
  await db.query(
    `INSERT INTO map_scope_repositories(scope_key,repo,adapter_key,adapter_config)
     VALUES('other','other-source','legacy-ledger-v1',$1),('phones','second-phone-source','legacy-ledger-v1',$1)`,
    [{ source_repo: IMPACT_REPO }],
  );
  await expect(resolveImplementationRegistryRepo(db, { ...query, scope: 'other' })).resolves.toBe('other-source');
  await expect(resolveImplementationRegistryRepo(db, query))
    .rejects.toMatchObject({ code: 'MAP_IMPLEMENTATION_REPO_NOT_CONFIGURED', status: 422 });
});

it('新manifest已推进但图仍旧SHA时不污染base历史；混合来源不能核验',async()=>{
  const {db}=fixture;
  const {exportImplementationSnapshot}=await import('../../implementation-ci-snapshot.js');
  const original=await exportImplementationSnapshot(db,query);
  await fixture.advance();
  await db.query("UPDATE map_projection_runs SET fact_revisions=$1 WHERE scope_key='phones' AND status='active'",[{'phone-source':revision}]);
  const gaps=[],context=await loadImplementationRevisionContext(db,query,revision,'phone-source',null,gaps);
  expect(context?.manifest_version_id).toBe(original.map.manifest.id);expect(gaps).toEqual([]);
  const snapshot=await exportImplementationSnapshot(db,query);
  expect(snapshot.status,JSON.stringify(snapshot.gaps)).toBe('verified');expect(snapshot.map.manifest.id).toBe(original.map.manifest.id);
  await db.query("UPDATE map_manifest_versions SET manifest=jsonb_set(manifest,'{value_streams,0,brain_binding,source_revision}',to_jsonb($1::text)) WHERE id=$2",['b'.repeat(40),original.map.manifest.id]);
  const mixed=[];expect(await loadImplementationRevisionContext(db,query,revision,'phone-source',null,mixed)).toBeNull();expect(mixed.length).toBeGreaterThan(0);
  expect((await exportImplementationSnapshot(db,query)).status).toBe('unknown');
});
