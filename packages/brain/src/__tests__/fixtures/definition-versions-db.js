import { randomUUID } from 'node:crypto';
import {privateFixtureDatabase} from './private-fixture-db.js';
import {minimumDefinitionSchema,migrationSql} from './minimum-definition-schema.js';
export async function versionsDatabase() {
 const fixture=await privateFixtureDatabase('versions',db=>minimumDefinitionSchema(db));
 return {...fixture,async migrate(){for(const file of ['511_shared_activity_refs.sql','513_definition_versions.sql'])await fixture.client.query(migrationSql(file));}};
}
export async function seedWorkflows(db){
  const valueStream=randomUUID(),keywordCapability=randomUUID(),benchmarkCapability=randomUUID(),keyword=randomUUID(),benchmark=randomUUID();
  await db.query(`INSERT INTO journeys(id,name,parent_journey_id) VALUES($1,'价值流',NULL),($2,'关键词',$1),($3,'对标',$1)`,[valueStream,keywordCapability,benchmarkCapability]);
  await db.query(`INSERT INTO workflows(id,capability_id,key,name,channel) VALUES($1,$3,'douyin_keyword_leadgen','关键词','douyin'),($2,$4,'douyin_benchmark_leadgen','对标','douyin')`,[keyword,benchmark,keywordCapability,benchmarkCapability]);
  return {valueStream,keyword,benchmark};
}
