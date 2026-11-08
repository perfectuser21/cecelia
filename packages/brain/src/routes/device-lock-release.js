/** 显式维护释放：可选原lease xmin CAS；不承担自动回收或停止判定。 */
export function registerDeviceLockRelease(router,pool){
 router.post('/device-locks/release',async(req,res)=>{
  try{
   const {device_name,locked_by}=req.body??{};
   if(!device_name||!locked_by)return res.status(400).json({success:false,error:'device_name and locked_by are required'});
   const hasVersion=Object.hasOwn(req.body,'expected_lease_version'),version=req.body.expected_lease_version;
   if(hasVersion&&(typeof version!=='string'||!/^\d{1,10}$/.test(version)||String(Number(version))!==version||Number(version)<1||Number(version)>4294967295)){
    return res.status(400).json({success:false,code:'INVALID_DEVICE_LOCK_LEASE_VERSION',error:'expected_lease_version must be a canonical positive XID decimal string'});
   }
   const {rows}=await pool.query(`UPDATE device_locks
     SET locked_by=NULL,locked_at=NULL,expires_at=NULL
     WHERE device_name=$1 AND locked_by=$2${hasVersion?' AND xmin::text=$3':''}
     RETURNING *,xmin::text AS lease_version`,hasVersion?[device_name,locked_by,version]:[device_name,locked_by]);
   if(rows.length===0)return res.status(409).json(hasVersion
    ?{success:false,code:'DEVICE_LOCK_LEASE_VERSION_MISMATCH',error:`Device ${device_name} does not match owner and expected lease version`}
    :{success:false,error:`Device ${device_name} is not locked by ${locked_by}`});
   // 返回释放UPDATE之后free行的新版本；消费的是请求内expected_lease_version。
   return res.json({success:true,released:rows[0]});
  }catch(error){
   console.error('[API] device-locks/release error:',error.message);
   return res.status(500).json({success:false,error:error.message});
  }
 });
}
