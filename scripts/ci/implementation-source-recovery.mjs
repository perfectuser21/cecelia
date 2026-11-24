/** 工厂来源恢复已退役；历史来源标记不能被升级为正式发布证明。 */
const retired=()=>{throw Object.assign(Error('工厂消费者来源采集及恢复已退役'),{code:'IMPLEMENTATION_CI_FACTORY_COLLECTION_RETIRED',status:410});};
export async function publishRecoveryBaseline(){retired();}
export function verifyRecoveryGateProof(){retired();}
export function assertRecoveryPurpose(snapshot,mode){
 if(snapshot?.source_baseline&&mode!=='pr')throw Object.assign(Error('SOURCE_RECOVERY_RELEASE_FORBIDDEN'),{code:'SOURCE_RECOVERY_RELEASE_FORBIDDEN'});
 if(snapshot?.source_baseline)retired();
}
