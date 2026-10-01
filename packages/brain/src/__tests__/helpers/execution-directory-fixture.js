// 历史消费者单测的显式legacy-v1配置；生产初始化始终只读PostgreSQL。
import { legacyRecords } from '../../execution-directory/legacy-policy.js';
export async function seedExecutionDirectoryFixture({machineIds}={}){
 const {directory}=await import('../../execution-directory/directory.js');
 const rows=legacyRecords({env:{FLEET_WORKER_US_MAC_M4_URL:'http://100.71.151.105:5231',FLEET_WORKER_XIAN_MAC_M1_URL:'http://100.88.166.55:5231',FLEET_WORKER_XIAN_MAC_M4_URL:'http://100.86.57.69:5231'}});
 rows[0].endpoints.legacy_executor={claude:{executor:'claude',url:'http://localhost:3457',default:true}};
 rows[2].endpoints.legacy_executor={codex:{executor:'codex',url:'http://100.86.57.69:3458',default:true}};
 return directory.refresh({pool:{query:async()=>({rows:machineIds?rows.filter(n=>machineIds.includes(n.canonical_id)):rows})}});
}
await seedExecutionDirectoryFixture();

