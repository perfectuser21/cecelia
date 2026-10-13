import pg from 'pg';
export async function scratchOnlyConnection(env=process.env) {
  const config={host:env.DB_HOST||'/tmp',port:Number(env.DB_PORT||5432),
    user:env.DB_USER||'administrator',password:env.DB_PASSWORD,database:'cecelia_scratch'};
  const requested=env.DB_NAME||'cecelia_scratch';
  if(requested==='cecelia_scratch')return config;
  if(requested!=='cecelia_test'||env.CI!=='true')throw Error('测试只允许scratch或隔离CI创建scratch');
  const admin=new pg.Pool({...config,database:'cecelia_test'});
  try {
    if(!(await admin.query("SELECT 1 FROM pg_database WHERE datname='cecelia_scratch'")).rows.length) {
      try {await admin.query('CREATE DATABASE cecelia_scratch');}
      catch(error){if(error.code!=='42P04'&&!(error.code==='23505'&&error.constraint==='pg_database_datname_index'))throw error;}
    }
  } finally {await admin.end();}
  return config;
}
