import {createHash} from 'node:crypto';
import profile from '../../scripts/fleet-worker/app-server-profile.cjs';
export const {generationOwner}=profile;
export const HASH=/^[a-f0-9]{64}$/;
export const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const HOME_FIELDS=['homeId','homeKey','provider','account','repo','profile','configDigest'];
export function validateHome(home) {
 if(!home||Object.keys(home).some(k=>!HOME_FIELDS.includes(k))||!/^chat-[a-z0-9-]{1,80}$/.test(home.homeId)
  ||!HASH.test(home.homeKey)||home.provider!=='codex'||!/^[a-z0-9-]{1,64}$/.test(home.account)
  ||!/^perfectuser21\/(cecelia|zenithjoy-workspace)$/.test(home.repo)||!/^[a-z][a-z0-9-]{0,63}$/.test(home.profile)||!HASH.test(home.configDigest))throw Error('appserver_home_configuration_invalid');
 return Object.freeze(Object.fromEntries(HOME_FIELDS.map(k=>[k,home[k]])));
}
export function workerIdentity(row){return {reservation_id:row.id,intent_id:row.intent_id,launch_generation:row.launch_generation,machine_id:row.machine_id,
 worker_id:row.worker_id,worker_boot_id:row.worker_boot_id,owner_key:row.owner_key,home_key:row.home_key,config_digest:row.config_digest,profile:row.config.profile};}
export function receiptMatches(row,receipt){return Object.entries(workerIdentity(row)).every(([k,v])=>receipt?.[k]===v);}
