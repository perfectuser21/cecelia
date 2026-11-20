import {expect,test} from 'vitest';
import {nativeAgentStartRequest} from '../native-agent-protocol.js';
const task={id:'10000000-0000-4000-8000-000000000001',tenant_id:'fixture-native',title:'完整标题任务：检查资料并交付结论',payload:{qiumi_source:{body:''}}};
test('严格读取确认正文为空的标题交办仍可执行，不迫使用户写内部参数',()=>{
 const current=structuredClone(task);current.payload.native_agent_content={protocol:'notion-complete-body/v1',complete:true,empty_body:true,page_ids:['en-page']};
 expect(nativeAgentStartRequest(current).prompt).toContain(task.title);
});
test('旧queued仅有正文却无完整读取证据必须阻塞，不能假定完整',()=>{
 const current=structuredClone(task);current.payload.qiumi_source.body='有部分正文但未核分页和子块';
 expect(()=>nativeAgentStartRequest(current)).toThrow('native_agent_body_incomplete');
});
