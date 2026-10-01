import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {generationOwner,workerIdentity,receiptMatches} from '../identity.js';
it('generation owner稳定于原代，任一HOME/intent/reservation/generation变化都换owner且回执不可重绑',()=>{
 const identity={home_key:'a'.repeat(64),reservation_id:randomUUID(),intent_id:randomUUID(),launch_generation:1};
 const owner=generationOwner(identity);expect(generationOwner({...identity})).toBe(owner);
 for(const key of Object.keys(identity))expect(generationOwner({...identity,[key]:key==='launch_generation'?2:'b'.repeat(64)})).not.toBe(owner);
 const row={id:identity.reservation_id,...identity,machine_id:'xian-mac-m1',worker_id:'worker',worker_boot_id:randomUUID(),owner_key:owner,config_digest:'c'.repeat(64),config:{profile:'chat'}};
 const receipt=workerIdentity(row);expect(receiptMatches(row,receipt)).toBe(true);
 for(const key of Object.keys(receipt))expect(receiptMatches(row,{...receipt,[key]:'other'})).toBe(false);
});
