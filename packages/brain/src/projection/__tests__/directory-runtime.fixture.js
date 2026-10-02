import { buildDirectorySchemas } from '../directory-schema.js';
export const fixtureEntityId = n => `10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
export function runtimeFixture() {
  const dbs=Object.fromEntries(['areas','value_streams','capabilities','workflows','activities','steps'].map((k,i)=>[k,fixtureEntityId(i+1)]));
  const config={dbs,value_stream_bindings:[{journey_id:fixtureEntityId(22),scope:'cecelia',node_key:'product'}],area_bindings:[]};
  const source={areas:[{id:fixtureEntityId(21),notion_id:fixtureEntityId(41),name:'组织'}],journeys:[
    {id:fixtureEntityId(22),name:'产品',kind:'value_stream',area_id:fixtureEntityId(21)},
    {id:fixtureEntityId(23),name:'能力',kind:'capability',parent_journey_id:fixtureEntityId(22)}],
    workflows:[{id:fixtureEntityId(24),name:'A',key:'a',capability_id:fixtureEntityId(23)}],
    activities:[{id:fixtureEntityId(25),name:'动作',capability_key:'cap',activity_key:'one',contract:{}}],
    steps:[{id:fixtureEntityId(26),key:'step',active:true,activity_id:fixtureEntityId(25),readback:{}}],
    refs:[{workflow_id:fixtureEntityId(24),activity_id:fixtureEntityId(25),slot_key:'one',sequence_no:1,active:true}],
    map_nodes:[{scope:'cecelia',node_key:'product',name:'产品',notion_id:fixtureEntityId(42),active:true}]};
  const schemas=buildDirectorySchemas(dbs);
  const databases=new Map(Object.entries(schemas).map(([layer,properties])=>[dbs[layer],{id:dbs[layer],properties:Object.fromEntries(Object.entries(properties).map(([k,v])=>[k,{...v,type:Object.keys(v)[0]}]))}]));
  const pages=new Map([[fixtureEntityId(41),{id:fixtureEntityId(41),parent:{database_id:dbs.areas},properties:{Name:{title:[{text:{content:'组织'}}]}}}],
    [fixtureEntityId(42),{id:fixtureEntityId(42),parent:{database_id:dbs.value_streams},properties:{Name:{title:[{text:{content:'产品'}}]}}}]]);
  const links=[],writes=[],memory=new Map(); let next=100;
  const query=async(sql,args=[])=>{
    if(sql.includes('pg_try_advisory_lock'))return{rows:[{locked:true}]};
    if(sql.includes('FROM projection_targets'))return{rows:[{enabled:true,config}]};
    if(sql.includes('AS source'))return{rows:[{source:structuredClone(source)}]};
    if(sql.includes('FROM working_memory'))return{rows:memory.has(args[0])?[{value_json:memory.get(args[0])}]:[]};
    if(sql.includes('INSERT INTO working_memory')){memory.set(args[0],JSON.parse(args[1]));return{rows:[]};}
    if(sql.includes('FROM projection_links'))return{rows:links.filter(l=>sql.includes('entity_type=$1')?l.entity_type===args[0]&&l.entity_id===args[1]:
      sql.includes('external_id=$1')?l.external_id===args[0]&&(l.entity_type!==args[1]||l.entity_id!==args[2]):true)};
    if(sql.includes('INSERT INTO projection_links')){
      const row={entity_type:args[0],entity_id:args[1],external_id:args[2],content_hash:args[3]};
      const found=links.find(l=>l.entity_type===row.entity_type&&l.entity_id===row.entity_id);
      if(found)Object.assign(found,row);else links.push(row);return{rows:[row],rowCount:1};
    }
    return{rows:[]};
  };
  const notionReq=async(_token,path,method,body)=>{
    if(method==='PATCH'||path==='/pages')writes.push({path,body});
    const id=path.split('/')[2];
    if(path.startsWith('/databases/')){
      if(path.endsWith('/query'))return{results:[...pages.values()].filter(p=>p.parent.database_id===id&&
        p.properties['Brain ID']?.rich_text?.[0]?.text?.content===body.filter.rich_text.equals),has_more:false};
      const db=databases.get(id);if(method==='PATCH')Object.assign(db.properties,body.properties);return structuredClone(db);
    }
    if(path==='/pages'){
      const page={id:fixtureEntityId(next++),parent:body.parent,properties:body.properties};pages.set(page.id,page);return structuredClone(page);
    }
    const page=pages.get(id);if(!page)throw new Error('404');
    if(method==='PATCH')Object.assign(page.properties,body.properties);return structuredClone(page);
  };
  const pool={query,connect:async()=>({query,release(){}})};
  return {dbs,config,source,databases,pages,links,writes,memory,notionReq,pool};
}
