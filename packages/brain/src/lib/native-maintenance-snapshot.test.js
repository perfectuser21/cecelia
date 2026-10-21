import {expect,it} from 'vitest';
import {isNativeMaintenanceObservationDefinition} from './native-maintenance-snapshot.js';
it.each([{}, {payload:{definition_scope:'native_maintenance_observation'}},
 {workflow_id:'foreign',payload:{protocol:'workflow-assembly-native-v1',definition_scope:'native_maintenance_observation'}}])('未知或自报维护标记不能隔离业务定义 %j',async row=>{
 const db={query:()=>{throw Error('unknown_identity_must_not_query');}};
 expect(await isNativeMaintenanceObservationDefinition(db,row)).toBe(false);
});
