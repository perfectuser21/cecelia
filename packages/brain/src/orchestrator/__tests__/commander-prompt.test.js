import {test,expect,vi} from 'vitest';
const judge=vi.hoisted(()=>vi.fn(async()=>({content:'{}'})));
vi.mock('../../../scripts/coding-workflow/lib/codex-judge.mjs',()=>({callCodexJudge:judge}));
import {createCodexCommander} from '../commander-codex.js';
test('Commander只投影巨大runtime摘要，完整原输入与决策绑定不变',async()=>{
 const hashes=Object.fromEntries(Array.from({length:317},(_,i)=>['/frozen/program-'+i+'.mjs','a'.repeat(64)]));
 const request={protocol:'commander-decision/v1',run_id:'run',definition_sha256:'definition',sequence:2,state_sha256:'state',
  contract:{workflow:'101',activities:[{key:'collect'}]},allowed_actions:[{action:'dispatch',activity_key:'collect'},{action:'pause'}],
  accepted:[{activity_key:'preflight',outputs:{account:'approved'}}],input:{run_tag:'original',company_id:'company',keywords:['客户关键词'],
   verification:{policy_version:29,runtime_sha256:hashes,other_checks:['fresh_account','owned_lock']}}};
 const original=structuredClone(request);
 await createCodexCommander({manifestPath:'/frozen/manifest.json'})(request,{timeoutMs:1000});
 const prompt=judge.mock.calls.at(-1)[0].user,projected=JSON.parse(prompt);
 expect(request).toEqual(original);expect(prompt).not.toContain('/frozen/program-316.mjs');
 expect(projected.input.verification.runtime_sha256).toEqual({prompt_projection:'runtime_sha256_not_inlined',source_file:'/frozen/manifest.json',source_field:'run.input.verification.runtime_sha256',entries:317});
 projected.input.verification.runtime_sha256=hashes;expect(projected).toEqual(original);
 expect(prompt.length).toBeLessThan(JSON.stringify(original).length/4);
});
test('source均验收而finalize待宿主执行时，complete指令不能要求所有活动先完成',async()=>{
 const request={protocol:'commander-decision/v1',run_id:'run',definition_sha256:'definition',sequence:3,state_sha256:'state',
  contract:{workflow:'101',activities:[{key:'preflight',runtime:{phase:'source'}},{key:'collect',runtime:{phase:'source'}},{key:'cleanup',runtime:{phase:'finalize'}}]},
  allowed_actions:[{action:'complete'},{action:'pause'}],accepted:[{activity_key:'preflight',outputs:{account:'approved'}},{activity_key:'collect',outputs:{video_ids:['verified-video']}}],input:{run_tag:'original'}};
 await createCodexCommander({manifestPath:'/frozen/manifest.json'})(request,{timeoutMs:1000});
 const {system,user}=judge.mock.calls.at(-1)[0];
 expect(system.includes('所有活动已验收时选择complete')).toBe(false);
 expect(system).toContain('complete只确认source阶段');
 expect(system).toContain('finalize由宿主随后执行');
 expect(system).toContain('清理失败不能把业务结果判为成功');
 expect(system).toContain('业务证据不足或存在不确定性时仍选择pause');
 const projected=JSON.parse(user);expect(projected.allowed_actions).toEqual(request.allowed_actions);
 expect(projected.contract).toEqual(request.contract);expect(projected.accepted).toEqual(request.accepted);
});
