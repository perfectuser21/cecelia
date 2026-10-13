import { createHash } from 'node:crypto';

// 保留旧ID和内容；这里只检查/补充对象身份，不给旧版本重新编号。
export const IDENTITY_CONSTRAINTS = [
  {key:'build_owner',table:'activity_version_builds',columns:['activity_id','build_id'],target:'activity_definition_versions',targetColumns:['activity_id','id']},
  {key:'first_build_owner',table:'activity_versions',columns:['activity_id','first_build_id'],target:'activity_definition_versions',targetColumns:['activity_id','id']},
  {key:'event_from_owner',table:'activity_release_events',columns:['activity_id','from_version_id'],target:'activity_versions',targetColumns:['activity_id','id']},
  {key:'event_to_owner',table:'activity_release_events',columns:['activity_id','to_version_id'],target:'activity_versions',targetColumns:['activity_id','id']},
];
const HISTORY_TABLES = ['workflow_definition_versions','activity_definition_versions','activity_versions',
  'activity_version_builds','activity_release_events','workflow_production_recipes','release_versions','release_observations','run_definition_bindings'];
const identifier = value => {
  if (typeof value!=='string' || !/^[a-z][a-z0-9_]{0,62}$/.test(value)) throw Error('非法 schema / identifier');
  return `"${value}"`;
};
const failure = (code,message) => Object.assign(Error(message),{code});
const fingerprint = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const same = (a,b) => JSON.stringify(a)===JSON.stringify(b);
const qualified = (schema,table) => `${identifier(schema)}.${identifier(table)}`;

async function auditInTransaction(db,{schema='public'}={}) {
  identifier(schema);
  const database=(await db.query('SELECT current_database() AS name')).rows[0].name;
  const relations=(await db.query(`SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname=$1 AND c.relkind IN ('r','p')`,[schema])).rows.map(x=>x.relname);
  const columnRows=(await db.query('SELECT table_name,column_name FROM information_schema.columns WHERE table_schema=$1',[schema])).rows;
  const columnsFor=table=>columnRows.filter(r=>r.table_name===table).map(r=>r.column_name);
  const foreignKeys=(await db.query(`SELECT c.relname AS table_name,t.relname AS target_table,tn.nspname AS target_schema,
    k.conname,k.convalidated,ARRAY(SELECT a.attname FROM unnest(k.conkey) WITH ORDINALITY v(attnum,ord)
      JOIN pg_attribute a ON a.attrelid=k.conrelid AND a.attnum=v.attnum ORDER BY v.ord)::text[] AS columns,
    ARRAY(SELECT a.attname FROM unnest(k.confkey) WITH ORDINALITY v(attnum,ord)
      JOIN pg_attribute a ON a.attrelid=k.confrelid AND a.attnum=v.attnum ORDER BY v.ord)::text[] AS target_columns
    FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_class t ON t.oid=k.confrelid JOIN pg_namespace tn ON tn.oid=t.relnamespace
    WHERE k.contype='f' AND n.nspname=$1`,[schema])).rows;
  const constraints=[];
  for (const spec of IDENTITY_CONSTRAINTS) {
    const missingColumns=[...spec.columns.filter(c=>!columnsFor(spec.table).includes(c)).map(c=>`${spec.table}.${c}`),
      ...spec.targetColumns.filter(c=>!columnsFor(spec.target).includes(c)).map(c=>`${spec.target}.${c}`)];
    const available=relations.includes(spec.table)&&relations.includes(spec.target)&&missingColumns.length===0;
    const existing=foreignKeys.find(k=>k.table_name===spec.table&&k.target_table===spec.target&&k.target_schema===schema
      &&same(k.columns,spec.columns)&&same(k.target_columns,spec.targetColumns));
    let mismatches=null;
    if (available) {
      const source=qualified(schema,spec.table),target=qualified(schema,spec.target);
      mismatches=(await db.query(`SELECT count(*)::int AS n FROM ${source} s LEFT JOIN ${target} t
        ON s.${identifier(spec.columns[1])}=t.${identifier(spec.targetColumns[1])}
        WHERE s.${identifier(spec.columns[1])} IS NOT NULL
        AND (s.activity_id IS NULL OR t.id IS NULL OR s.activity_id IS DISTINCT FROM t.activity_id)`)).rows[0].n;
    }
    constraints.push({...spec,available,missing_columns:missingColumns,enforced:Boolean(existing),validated:existing?.convalidated??false,
      constraint_name:existing?.conname??null,mismatches});
  }
  const tables={};
  for (const table of HISTORY_TABLES.filter(t=>relations.includes(t))) {
    // 在PG内逐行哈希再合并；只回摘要，不输出合同、密钥、客户数据或巨大JSON。
    tables[table]=(await db.query(`SELECT count(*)::int AS rows,
      encode(sha256(convert_to(COALESCE(string_agg(row_digest,'' ORDER BY row_digest),''),'UTF8')),'hex') AS digest
      FROM (SELECT encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') AS row_digest FROM ${qualified(schema,table)} t) r`)).rows[0];
  }
  const coverage={};
  const counts={
    ops_agents:"source='openclaw' AND agent_type='openclaw_agent'",
    skill_registry:"presence='present' AND status<>'deprecated'",
    workflows:"status='active'",activities:"status<>'deprecated'",
  };
  for(const[table,where]of Object.entries(counts)) if(relations.includes(table)) {
    const columns=columnsFor(table);
    const required={ops_agents:['source','agent_type'],skill_registry:['presence','status'],workflows:['status'],activities:['status']}[table];
    if(required.every(c=>columns.includes(c)))coverage[table]=(await db.query(`SELECT count(*)::int AS n FROM ${qualified(schema,table)} WHERE ${where}`)).rows[0].n;
    else coverage[table]=null;
  }
  return {schema_version:1,database,schema,constraints,coverage,baseline:{tables,sha256:fingerprint(tables)},
    ready_for_identity_constraints:constraints.every(c=>c.available&&c.mismatches===0),
    production_migration_applied:false};
}

// 调用方须提供专用连接；统一建立一致只读快照，不使用Brain默认pool。
export async function auditVersionIdentity(db,options={}) {
  await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try {
    await db.query("SET LOCAL lock_timeout='2500ms'");
    await db.query("SET LOCAL statement_timeout='30000ms'");
    const result=await auditInTransaction(db,options);
    await db.query('COMMIT');return result;
  } catch(error){await db.query('ROLLBACK');throw error;}
}

export async function applyScratchIdentityConstraints(db,{schema='public',expectedDigest}={}) {
  // 检查真实连接身份，而不是信任环境变量；生产不提供旁路参数。
  const database=(await db.query('SELECT current_database() AS name')).rows[0].name;
  if(database!=='cecelia_scratch')throw failure('SCRATCH_REQUIRED','写入仅允许 cecelia_scratch');
  identifier(schema);
  if(!/^[0-9a-f]{64}$/.test(expectedDigest||''))throw failure('BASELINE_REQUIRED','需要预检的历史摘要');
  await db.query('BEGIN');
  try {
    await db.query("SET LOCAL lock_timeout='2500ms'");
    await db.query("SET LOCAL statement_timeout='30000ms'");
    // 阻止先检查后加约束之间插入错误记录；遇锁即失败，事务整体回滚。
    const existing=(await db.query(`SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname=$1 AND c.relkind IN ('r','p')`,[schema])).rows.map(r=>r.relname);
    const required=[...new Set([...IDENTITY_CONSTRAINTS.map(c=>c.table),...HISTORY_TABLES.filter(t=>existing.includes(t))])].sort();
    for(const table of required) {
      await db.query(`LOCK TABLE ${qualified(schema,table)} IN SHARE ROW EXCLUSIVE MODE`);
    }
    const before=await auditInTransaction(db,{schema});
    if(before.baseline.sha256!==expectedDigest)throw failure('BASELINE_CHANGED','原件摘要改变，请重新预检');
    if(!before.ready_for_identity_constraints)throw failure('HISTORICAL_IDENTITY_MISMATCH','存在未核实或错配历史；保留原件，禁止自动修写');
    const added=[];
    for(const spec of before.constraints) {
      const name=spec.constraint_name||`runtime_identity_${spec.key}`;
      if(!spec.enforced) {
        await db.query(`ALTER TABLE ${qualified(schema,spec.table)} ADD CONSTRAINT ${identifier(name)}
          FOREIGN KEY (${spec.columns.map(identifier).join(',')}) REFERENCES ${qualified(schema,spec.target)}
          (${spec.targetColumns.map(identifier).join(',')}) NOT VALID`);
        added.push(spec.key);
      }
      if(!spec.validated)await db.query(`ALTER TABLE ${qualified(schema,spec.table)} VALIDATE CONSTRAINT ${identifier(name)}`);
    }
    const after=await auditInTransaction(db,{schema});
    if(after.baseline.sha256!==before.baseline.sha256)throw failure('HISTORY_CHANGED','迁移改变了历史内容');
    await db.query('COMMIT');
    return {...after,added,scratch_constraints_applied:true};
  } catch(error) {
    await db.query('ROLLBACK');throw error;
  }
}
