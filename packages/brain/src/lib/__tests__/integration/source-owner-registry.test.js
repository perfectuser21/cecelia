import {afterEach,expect,it} from 'vitest';
import {implementationImpactDatabase,IMPACT_REPO} from '../../../__tests__/fixtures/implementation-impact-db.js';
import {exportImplementationSnapshot} from '../../implementation-ci-snapshot.js';
let fixture;
afterEach(async()=>{await fixture?.close();fixture=null;});
it('真实PG：被同SHA流程引用的retired owner没有同SHA定义也独立冻结，不伪造owner版本',async()=>{
 fixture=await implementationImpactDatabase();const {db}=fixture,revision='b'.repeat(40);
 await db.query("UPDATE workflows SET status='retired' WHERE id=$1",[fixture.ids.keyword]);
 await fixture.advance();
 await fixture.map(revision,[fixture.capabilities[0]]);
 const s=await exportImplementationSnapshot(db,{scope:'phones',repo:IMPACT_REPO,revision});
 expect(s.definitions.workflows.some(w=>w.workflow_id===fixture.ids.keyword)).toBe(false);
 expect(s.canonical.workflows.some(w=>w.id===fixture.ids.keyword)).toBe(false);
 expect(s.source_registry?.source_basis).toBe('current_registration');
 expect(s.source_registry.canonical.workflows).toContainEqual(expect.objectContaining({id:fixture.ids.keyword,status:'retired',source_capability:'keyword_acquisition'}));
 expect(s.source_registry.registry_sha256).toMatch(/^[0-9a-f]{64}$/);
 expect(s.source_registry.canonical.journeys.some(j=>j.id===fixture.capabilities[1])).toBe(true);
});
