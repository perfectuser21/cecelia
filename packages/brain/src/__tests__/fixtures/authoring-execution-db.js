import {createIntakeTestDatabase} from './task-intake-db.js';
import {randomUUID} from 'node:crypto';
/** 全部对象和执行账均为scratch私有schema，生产结构只读复制，结束完整删除。 */
export async function authoringExecutionDatabase(){
 const f=await createIntakeTestDatabase();
 try{
  for(const table of ['value_streams','capabilities','workflows','activities','steps','workflow_activity_refs','warehouse_items','activity_uses',
   'skill_registry','activity_definition_versions','workflow_definition_versions','activity_versions','activity_version_builds',
   'activity_release_state','activity_release_events','workflow_production_recipes','task_events','task_runs','spans','runs'])
   await f.pool.query(`CREATE TABLE ${f.schema}.${table}(LIKE public.${table} INCLUDING ALL)`);
  // LIKE不复制外键；明确恢复实际执行对象的归属约束，防候选UUID无实体也伪造span。
  await f.pool.query('ALTER TABLE spans ADD FOREIGN KEY(activity_id) REFERENCES activities(id),ADD FOREIGN KEY(step_id) REFERENCES steps(id),ADD FOREIGN KEY(workflow_id) REFERENCES workflows(id)');
  const cap=randomUUID(),skill=randomUUID(),vs=randomUUID();
  await f.pool.query("INSERT INTO value_streams(id,name) VALUES($1,'隔离候选价值流')",[vs]);
  await f.pool.query("INSERT INTO capabilities(id,name,parent_journey_id,status) VALUES($1,'隔离候选能力',$2,'active')",[cap,vs]);
  await f.pool.query("INSERT INTO skill_registry(id,name,location,status) VALUES($1,'authoring-pure','fixture/SKILL.md','active')",[skill]);
  const schema={type:'object',properties:{text:{type:'string'}},required:['text'],additionalProperties:false};
  const definition={key:`pure${cap.slice(0,8)}`,name:'纯Skill候选',capability_id:cap,channel:'internal',form:'code',version:'1.0.0',
   source:{repo:'perfectuser21/cecelia',ref:'contracts/pure.json',revision:'a'.repeat(40)},runtime:{skill_id:skill,entrypoint:'pure',transport:'codex-bridge'},
   input_schema:schema,output_schema:schema,activities:[{key:'uppercase',name:'大写',executor_kind:'agent',mutation_intent:'none',acceptance:['大写结果'],
    input_schema:schema,output_schema:schema,
    implementation:{kind:'skill',skill_id:skill,ref:'skills/pure/SKILL.md',path:'skills/pure/SKILL.md',version:'1.0.0',repo:'perfectuser21/cecelia',revision:'contract'}}]};
  const content='---\nname: authoring-pure\nversion: 1.0.0\n---\n仅把输入text转成大写，输出text字段。禁止工具、文件、消息及其它副作用。';
  const reader=async s=>s.path===definition.source.ref?JSON.stringify(Object.fromEntries(Object.entries(definition).filter(([k])=>k!=='source'))):content;
  return {...f,definition,reader,content,skill};
 }catch(error){await f.close();throw error;}
}
