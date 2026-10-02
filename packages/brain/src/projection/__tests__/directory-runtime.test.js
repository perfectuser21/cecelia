import { describe,it,expect } from 'vitest';
import { runDirectoryProjection } from '../directory-projector.js';
import { runtimeFixture,uid } from './directory-runtime.fixture.js';
describe('目录运行循环',()=>{
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
  });
});
