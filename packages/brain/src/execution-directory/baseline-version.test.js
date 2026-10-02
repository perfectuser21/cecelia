import {it,expect,vi} from 'vitest';
import {createBaselineVersionStore} from './baseline-version.js';
const body={expected_current_version_id:'11111111-1111-4111-8111-111111111111',expected_config_hash:'a'.repeat(64),expected_worker_boot_id:'22222222-2222-4222-8222-222222222222',expected_worker_config_digest:'b'.repeat(64),supported_os_floor:'26.6.2'};
it.each(Object.keys(body))('维护CAS字段%s非字符串必须在事务/HTTP前拒绝',async field=>{
 const query=vi.fn(),connect=vi.fn(),client={maintenance:vi.fn()},store=createBaselineVersionStore({pool:{query,connect},client});
 await expect(store.publish('xian-mac-m4',{...body,[field]:[body[field]]})).rejects.toThrow('execution_baseline_request_invalid');expect(connect).not.toHaveBeenCalled();expect(query).not.toHaveBeenCalled();expect(client.maintenance).not.toHaveBeenCalled();
});

it.each(['us-mac-m4','xian-mac-m1'])('4378窄维护不得登记其它既有Mac %s，正规请求zeroSQL',async machine=>{
 const connect=vi.fn(),query=vi.fn();const store=createBaselineVersionStore({pool:{connect,query}});
 await expect(store.publish(machine,body)).rejects.toThrow('execution_baseline_existing_mac_required');expect(connect).not.toHaveBeenCalled();expect(query).not.toHaveBeenCalled();
});
