import {timingSafeEqual} from 'node:crypto';
import {takeOverHeadedTask,headedOwner,headedPostcommitPool} from '../lib/headed-task-owner.js';
const METADATA_FIELDS=new Set(['title','description','priority','due_at','notion_id','notion_synced_at']);
function authenticate(req){
 const expected=process.env.CECELIA_INTERNAL_TOKEN;
 if(!expected)throw Object.assign(Error('INTERNAL_AUTH_NOT_CONFIGURED'),{statusCode:503});
 const authorization=String(req.headers.authorization??'');
 const supplied=authorization.startsWith('Bearer ')?authorization.slice(7).trim():String(req.headers['x-internal-token']??'');
 const a=Buffer.from(expected),b=Buffer.from(supplied);
 if(a.length!==b.length||!timingSafeEqual(a,b))throw Object.assign(Error('UNAUTHORIZED'),{statusCode:401});
}
function reject(res,error){return res.status(error.statusCode??(['55P03','40P01'].includes(error.code)?409:500)).json({error:error.message});}
export function registerHeadedTakeoverRoute(router,{pool,path='/tasks/:id/headed-takeover'}){
 router.post(path,async(req,res)=>{
  try{
   authenticate(req);
   const sessionId=String(req.headers['x-session-id']??'');
   if(req.body.sessionId!==sessionId)throw Object.assign(Error('headed_session_mismatch'),{statusCode:400});
   const result=await takeOverHeadedTask(pool,{...req.body,taskId:req.params.id,sessionId});
   res.json(result);
  }catch(error){reject(res,error);}
 });
}
/** 为原PATCH借用同一事务连接；完成COMMIT后才发送JSON，沿用既有审核/完成门禁。 */
export function headedTaskMutation(pool,operation){
 return async(req,res)=>{
  let db,owner,send,status,body,ownerFailure,checked=false;
  const fields=Object.keys(req.body??{});
  const metadataOnly=fields.length>0&&fields.every(field=>METADATA_FIELDS.has(field));
  const afterCommit=[];
  const requestPool={
   async query(sql,params){
    const initialRead=typeof sql==='string'&&/^\s*SELECT\b/i.test(sql)&&/FROM\s+tasks\b/i.test(sql)&&/WHERE\s+id\s*=/i.test(sql);
    const initialWrite=typeof sql==='string'&&/^\s*UPDATE\s+tasks\b/i.test(sql);
    if(!checked&&(initialRead||initialWrite)){
     checked=true;
     const id=req.params.id??req.params.task_id;
     const enriched=initialRead?sql.replace(/SELECT/i,"SELECT payload->'headed_takeover' AS headed_takeover,"):"SELECT payload->'headed_takeover' AS headed_takeover FROM tasks WHERE id=$1";
     const result=await pool.query(enriched,initialRead?params:[id]);
     if(!result.rows[0]?.headed_takeover||metadataOnly)return initialRead?result:pool.query(sql,params);
     send=res.json.bind(res);res.json=value=>{status=res.statusCode;body=value;return res;};
     try{
     authenticate(req);
     db=await pool.connect();await db.query('BEGIN');
     await db.query('SELECT id FROM tasks WHERE id=$1 FOR UPDATE',[id]);
     owner=await headedOwner(db,id);
     if(!owner||String(req.headers['x-session-id']??'')!==owner.session_id)throw Object.assign(Error('headed_session_mismatch'),{statusCode:409});
     await db.query("SELECT set_config('cecelia.headed_owner_generation',$1,true)",[owner.generation]);
     }catch(error){ownerFailure=error;throw error;}
     return db.query(initialRead?enriched:sql,params);
    }
    return (db??pool).query(sql,params);
   },
   connect:async()=>{if(db)throw Error('headed_nested_transaction_forbidden');return pool.connect();},
   afterCommit:async callback=>{if(!db)return callback(pool);afterCommit.push(callback);return null;},
  };
  try{
   await operation(req,res,requestPool);
   if(ownerFailure)throw ownerFailure;
   if(db){
    if(status>=400)await db.query('ROLLBACK');else{
     await db.query('COMMIT');
     for(const callback of afterCommit){const hook=await callback(headedPostcommitPool(pool,owner));if(hook?.relay&&body&&typeof body==='object')body.relay=hook.relay;}
    }
    res.json=send;res.status(status??200);send(body??{ok:true});
   }
  }catch(error){if(db)await db.query('ROLLBACK');if(send)res.json=send;reject(res,error);}
  finally{if(db)db.release();}
 };
}
