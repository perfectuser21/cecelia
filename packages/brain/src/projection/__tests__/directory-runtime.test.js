import { describe,it,expect } from 'vitest';
import { runDirectoryProjection } from '../directory-projector.js';
import { runtimeFixture,uid } from './directory-runtime.fixture.js';
import { readFileSync } from 'node:fs';
describe('目录运行循环',()=>{
  it('整轮预算耗尽拒绝新外部调用，不能靠scheduler超时放开锁后继续写',async()=>{
    const f=runtimeFixture();
    await expect(runDirectoryProjection(f.pool,{token:'test',notionReq:f.notionReq,force:true,budgetMs:0})).rejects.toThrow(/预算/);
    expect(f.writes).toEqual([]);
  });
  it('未映射的旧Areas报catalog gap，不创建/写页或刷failed',async()=>{
    const f=runtimeFixture();f.source.areas.push({id:uid(997),name:'旧域'});
    const result=await runDirectoryProjection(f.pool,{token:'test',notionReq:f.notionReq,force:true});
    expect(result.failed).toBe(0);expect(result.catalog_gaps).toContainEqual({id:uid(997),gap:'area_page_binding_missing'});
    expect(f.pages.size).toBe(6);
  });
  it('正式路由和现代scheduler永久接线，smoke包括真实PG',()=>{
    expect(readFileSync(new URL('../../routes.js',import.meta.url),'utf8')).toContain('createDirectoryProjectionRouter');
    expect(readFileSync(new URL('../../scheduler-jobs.js',import.meta.url),'utf8')).toContain("name: 'notion-directory'");
    expect(readFileSync(new URL('../../../scripts/smoke/directory-projection-smoke.sh',import.meta.url),'utf8')).toContain('directory-projection.pg.integration.test.js');
  });
  it('未绑定的历史VS只报catalog gap，不打Notion且不让正式同步failed',async()=>{
    const f=runtimeFixture();f.source.journeys.push({id:uid(998),name:'历史',kind:'value_stream'});
    const result=await runDirectoryProjection(f.pool,{token:'test',notionReq:f.notionReq,force:true});
    expect(result.failed).toBe(0);expect(result.catalog_gaps).toContainEqual({id:uid(998),gap:'value_stream_binding_missing'});
    expect(f.pages.size).toBe(6);
  });
  it('六库预检发现错relation时零页面写、零成功link',async()=>{
    const f=runtimeFixture();f.databases.get(f.dbs.steps).properties['所属Activity'].relation.database_id=uid(999);
    await expect(runDirectoryProjection(f.pool,{token:'test',notionReq:f.notionReq,force:true})).rejects.toThrow(/relation/);
    expect(f.writes).toEqual([]);expect(f.links).toEqual([]);
  });
  it('每轮有限行并持久游标，跨轮收口所有层且幂等无重复页',async()=>{
    const f=runtimeFixture();
    const first=await runDirectoryProjection(f.pool,{token:'test',notionReq:f.notionReq,force:true,batchSize:2});
    expect(first.processed).toBe(2);expect(f.pages.size).toBe(2);
    for(let n=0;n<5;n++)await runDirectoryProjection(f.pool,{token:'test',notionReq:f.notionReq,force:true,batchSize:2});
    expect(f.links).toHaveLength(6);expect(f.pages.size).toBe(6);
    expect(f.pages.get(uid(41)).properties.Name.title[0].text.content).toBe('组织');
    const activity=f.links.find(l=>l.entity_id===uid(25));
    expect(f.pages.get(activity.external_id).properties['所属Workflows'].relation).toHaveLength(1);
    f.writes.length=0;
    for(let n=0;n<3;n++)await runDirectoryProjection(f.pool,{token:'test',notionReq:f.notionReq,force:true,batchSize:2});
    expect(f.writes).toEqual([]);
  });
});
