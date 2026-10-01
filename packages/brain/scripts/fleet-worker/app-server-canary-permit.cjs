'use strict';
const {createHmac,timingSafeEqual}=require('node:crypto');
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
function verifyCanaryPermit(permit,identity,key,now=Date.now()){
 const p=permit?.payload;
 if(!permit||Object.keys(permit).some(k=>!['payload','signature'].includes(k))||!p
  ||Object.keys(p).some(k=>!['authorization_id','nonce','expires_at','identity'].includes(k))
  ||!UUID.test(p.authorization_id)||!UUID.test(p.nonce)||!Number.isSafeInteger(p.expires_at)||p.expires_at<=now||p.expires_at>now+600000
  ||typeof key!=='string'||key.length<32||!p.identity||Object.keys(p.identity).length!==Object.keys(identity).length
  ||Object.entries(identity).some(([k,v])=>p.identity[k]!==v)||!/^[a-f0-9]{64}$/.test(permit.signature??''))throw Error('appserver_canary_permit_invalid');
 const expected=createHmac('sha256',key).update(JSON.stringify(p)).digest('hex');
 if(!timingSafeEqual(Buffer.from(expected),Buffer.from(permit.signature)))throw Error('appserver_canary_permit_invalid');
 return {authorization_id:p.authorization_id,nonce:p.nonce,expires_at:p.expires_at};
}
module.exports={verifyCanaryPermit};
