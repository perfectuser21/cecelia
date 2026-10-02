import { expect,it } from 'vitest';
const {classifyGovernanceChange,assertGovernanceCoverage,GOVERNANCE_CHECKS,GOVERNANCE_POLICY_SHA256}=await import('../implementation-ci-governance.js').catch(()=>({}));
it('仅Cecelia固定治理白名单；源码、测试、技能和任意文档不被glob吞掉',()=>{
 expect(classifyGovernanceChange).toBeTypeOf('function');
 expect(classifyGovernanceChange('perfectuser21/cecelia','DEFINITION.md','old','new')).toBe('governance');
 for(const path of ['src/controller.js','tests/a.test.js','SKILL.md','docs/business.md'])expect(classifyGovernanceChange('perfectuser21/cecelia',path,'old','new')).toBeNull();
 expect(classifyGovernanceChange('other/repo','DEFINITION.md','old','new')).toBeNull();
});
it('package及lock仅version字段变化可分类；依赖版本或integrity变化保持业务unknown',()=>{
 expect(classifyGovernanceChange).toBeTypeOf('function');
 const before={name:'x',version:'1.0.0',packages:{'':{version:'1.0.0'},'node_modules/x':{version:'2.0.0',integrity:'same'}}};
 const after=structuredClone(before);after.version='1.0.1';after.packages[''].version='1.0.1';
 expect(classifyGovernanceChange('perfectuser21/cecelia','package-lock.json',JSON.stringify(before),JSON.stringify(after))).toBe('version_only');
 after.packages['node_modules/x'].version='3.0.0';
 expect(classifyGovernanceChange('perfectuser21/cecelia','package-lock.json',JSON.stringify(before),JSON.stringify(after))).toBeNull();
});
it('仅给文件分类标签或将断言命令塞入报告不能当治理验证',()=>{
 expect(assertGovernanceCoverage).toBeTypeOf('function');
 expect(()=>assertGovernanceCoverage({source:{repo:'perfectuser21/cecelia'},governance_evidence:{files:[{path:'DEFINITION.md',kind:'governance'}]}},'DEFINITION.md')).toThrow();
});

it('完整固定来源与三项独立检查可证治理文件，不能把同证据套到业务文件',()=>{
 const hash='a'.repeat(64),path='DEFINITION.md',source={repo:'perfectuser21/cecelia',base_revision:'a'.repeat(40),head_revision:'b'.repeat(40)};
 const report={source,governance_evidence:{source,policy_sha256:GOVERNANCE_POLICY_SHA256,
 files:[{path,kind:'governance',base_sha256:hash,head_sha256:hash}],
 checks:GOVERNANCE_CHECKS.map(r=>({id:r.id,path:r.path,exit_code:0,script_sha256:hash,stdout_sha256:hash,stderr_sha256:hash}))}};
 expect(assertGovernanceCoverage(report,path)).toBe(true);
 report.governance_evidence.files[0].path='src/business.js';
 expect(()=>assertGovernanceCoverage(report,'src/business.js')).toThrow();
 report.governance_evidence.files[0].path=path;report.governance_evidence.checks.pop();
 expect(()=>assertGovernanceCoverage(report,path)).toThrow();
});
