import {expect,test} from 'vitest';
import {nativeAgentReceipt} from '../native-agent-protocol.js';
const source='a'.repeat(64),other='b'.repeat(64);
test('首个完整终态回执必须来自该任务冻结bundle，不能先接受异源再冻结',()=>{
 const request={tenant:'tenant-a',department:'main',role:'agent',account_ref:'team2',task_id:'task',run_id:'run',request_nonce:'nonce',input_digest:source,model:'gpt-6.2-sol',thinking:'high',skill_ids:[],timeout_ms:60000,deadline_ms:100000};
 const receipt={...request,protocol:'native-agent/v1',status:'completed',launch_state:'stopped',execution_stopped:true,result:{child_exited:true,exit_code:0},frozen:{config_digest:source,profile_digest:source,command_digest:source,skills_digest:source,source_digest:other,auth_identity_sha256:source}};
 expect(()=>nativeAgentReceipt({host:{bundle_sha256:source},request},receipt)).toThrow('native_agent_receipt_source');
});
