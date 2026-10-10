import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validatePatrolSecretIgnore} from '../implementation-device-patrol-gate.mjs';
const commit='a'.repeat(40),row=commit+':scripts/phone-account-patrol/test_deploy.py:generic-api-key:7';
const publicLine="good = {key: '66fe22f5-1a60-4e23-bcfb-7b4df2f0fbff' for key in ['single_workflow_id', 'batch_workflow_id', 'schedule_id', 'project_id']}";
test('仅接受固定Git测试单行公开UUID误报，不扩大ignore范围',()=>{
 assert.equal(validatePatrolSecretIgnore('# prior\n','# prior\n# public fixture\n'+row+'\n',()=>publicLine).fingerprint,row);
 for(const bad of ['*',commit+':any.py:generic-api-key:7',row+'\n'+row,commit+':scripts/phone-account-patrol/test_deploy.py:generic-api-key:8'])assert.throws(()=>validatePatrolSecretIgnore('# prior\n','# prior\n'+bad+'\n',()=>publicLine));
 assert.throws(()=>validatePatrolSecretIgnore('# prior\n','# prior\n'+row+'\n',()=>"api_key = 'real-secret'"));
});
