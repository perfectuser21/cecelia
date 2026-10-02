import {createRequire} from 'node:module';
import {calculatePhysicalCapacity} from '../platform-utils.js';
import {readPhoneCapacityObservation} from './http-client.js';
const {BASE_SLOT}=createRequire(import.meta.url)('../../scripts/fleet-worker/attempt-resource-policy.cjs');
/** Raw native-HTTP authority plus the locked authorized DB profile; never caller capacity. */
export function derivePhoneCapacity(value,binding,profile,now=Date.now()){
 const proof=readPhoneCapacityObservation(value,binding);
 if(!Number.isSafeInteger(profile?.capacity)||profile.capacity<=0)throw Error('phone_capacity_profile_invalid');
 const times=[Date.parse(value.observed_at),Date.parse(value.physical_observed_at),proof.receivedAt];
 if(times.some(t=>!Number.isFinite(t)||now-t>5000||t-now>1000))return null;
 const r=value.resources,m=value.maintenance;
 if(r.data_free_bytes<5*1024**3||value.adb_daemon.reachable!==true||value.external_locks.occupied!==0||m.pending!==0||m.in_flight!==0||m.draining!==false||m.stable!==true)return null;
 const physical=calculatePhysicalCapacity(r.memory_total_bytes/1024**2,r.cpu_count,BASE_SLOT.memoryBytes/1024**2,BASE_SLOT.cpus),effective=Math.min(physical,profile.capacity);
 return {verified:true,machine:binding.physical.machine_id,captured_at:Math.min(...times),expires_at:Math.min(...times)+5000,
  capacity:{ok:true,available:effective,physical_base_slots:physical,effective_base_slots:effective}};
}
