import test from 'node:test';
import assert from 'node:assert/strict';
import {buildPrImplementationSnapshot,verifySnapshotSource,advanceExistingOpsScratchManifest} from '../implementation-snapshot.mjs';
import {waitForSourceRuntime,expectedSourceRuntime} from '../implementation-source-ready.mjs';
import {publishRecoveryBaseline,assertRecoveryPurpose} from '../implementation-source-recovery.mjs';
const retired={code:'IMPLEMENTATION_CI_FACTORY_COLLECTION_RETIRED',status:410};
const snapshot={scope:'cecelia-factory',repo:'perfectuser21/cecelia',revision:'a'.repeat(40)};
test('退休factory候选与取源验证在读取DB/Git之前明确拒绝',async()=>{
 const db=new Proxy({}, {get(){throw Error('factory CLI must not access DB');}});
 await assert.rejects(buildPrImplementationSnapshot(db,snapshot,snapshot.revision,'/missing-retired-repo'),retired);
 await assert.rejects(verifySnapshotSource(snapshot,'/missing-retired-repo',{db}),retired);
 await assert.rejects(advanceExistingOpsScratchManifest(db,snapshot),retired);
});
test('旧readiness与recovery入口明确退休，不调用网络或读取候选',async()=>{
 const forbidden=new Proxy({}, {get(){throw Error('retired consumer must not read input');}});
 assert.throws(()=>expectedSourceRuntime(forbidden),retired);
 await assert.rejects(waitForSourceRuntime(forbidden),retired);
 await assert.rejects(publishRecoveryBaseline(forbidden),retired);
 assert.throws(()=>assertRecoveryPurpose({source_baseline:{purpose:'admission_source_only'}},'pr'),retired);
 assert.throws(()=>assertRecoveryPurpose({source_baseline:{}},'release'),{code:'SOURCE_RECOVERY_RELEASE_FORBIDDEN'});
 assert.doesNotThrow(()=>assertRecoveryPurpose({},'release'));
});
