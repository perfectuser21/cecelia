import { expect,it } from 'vitest';
import { versionsDatabase } from '../../../__tests__/fixtures/definition-versions-db.js';
import { randomUUID } from 'node:crypto';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import express from 'express';
import { createImplementationCiRouter } from '../../../routes/implementation-ci.js';
import { createMapManifestRouter } from '../../../routes/map-manifests.js';
import { createMapRouter } from '../../../routes/map.js';
import { runProjection } from '../../../map/projector.js';
it('正式CLI→真实server挂载/map/manifests→scratch提交激活三规范绑定',async()=>{
  const fixture=await versionsDatabase(),dir=mkdtempSync(join(tmpdir(),'pilot-registration-'));let server;
  try{
    const {db}=fixture;
    for(const table of ['decisions','map_scope_repositories','map_manifest_versions','map_projection_runs','map_projection_nodes','map_projection_edges','fact_snapshot_headers'])await db.query(`CREATE TABLE ${table}(LIKE public.${table} INCLUDING ALL)`);
    await db.query(`INSERT INTO journeys(id,name,parent_journey_id) VALUES('afa6abca-53c0-4815-8594-b7fb81ca547f','获客',NULL),
      ('a1000000-0000-4000-8000-000000000001','关键词','afa6abca-53c0-4815-8594-b7fb81ca547f'),('a1000000-0000-4000-8000-000000000002','对标','afa6abca-53c0-4815-8594-b7fb81ca547f')`);
    const decision=randomUUID();await db.query('INSERT INTO decisions(id) VALUES($1)',[decision]);
    await db.query("INSERT INTO fact_snapshot_headers(kind,repo,source_revision,scanner_version,row_count,scanned_at) VALUES('graph','zenithjoy-workspace',$1,'test',0,NOW())",['a'.repeat(40)]);
    const app=express();app.use(express.json());app.use('/api/brain/implementation-ci',createImplementationCiRouter({pool:db}));
    app.use('/api/brain/map',createMapRouter({pool:db}));
    app.use('/api/brain/map/manifests',createMapManifestRouter({pool:db,projector:({client,manifestVersion:m})=>runProjection({client,scopeKey:m.scope_key,manifestId:m.id,manifestDigest:m.digest,manifest:m.manifest})}));
    server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
    const script=fileURLToPath(new URL('../../../../../../scripts/map/register-capability-pilots.mjs',import.meta.url));
    let result;try{result=await promisify(execFile)(process.execPath,[script,'--pilot','phones','--revision','a'.repeat(40),'--decision',decision,'--output',join(dir,'manifest.json'),'--api-url',`http://127.0.0.1:${server.address().port}`,'--apply'],{env:{...process.env,CECELIA_INTERNAL_TOKEN:'fixture-internal-token'}});}catch(error){result=error;}
    expect(result.code,result.stderr).toBeUndefined();
    expect((await db.query("SELECT count(*)::int n FROM map_manifest_versions WHERE status='active'")).rows[0].n).toBe(1);
    expect((await db.query("SELECT count(*)::int n FROM map_projection_nodes WHERE attributes->>'mapping_status'='verified'")).rows[0].n).toBe(3);
  }finally{if(server)await new Promise(resolve=>server.close(resolve));await fixture.close();rmSync(dir,{recursive:true,force:true});}
});
