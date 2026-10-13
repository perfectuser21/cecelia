import { it,expect } from 'vitest';
import { validateAuthoringAdapterConfig, selectAuthoringDefinitions,isAuthoringReleaseSnapshot } from './ci-adapter.js';
const config={source_repo:'perfectuser21/zenithjoy-workspace',definition_protocol:'definition-freeze-v1',workflow_keys:['workflow_report.internal']};
it('显式authoring来源只选已登记key，普通product-map集合不混入',()=>{
  expect(validateAuthoringAdapterConfig(config)).toBe(true);
  expect(validateAuthoringAdapterConfig({...config,workflow_keys:[]})).toBe(false);
  expect(validateAuthoringAdapterConfig({...config,workflow_keys:['x','x']})).toBe(false);
  const rows=[{payload:{key:'workflow_report.internal',registration_protocol:'definition-freeze-v1'}},{payload:{key:'phone'}}];
  expect(selectAuthoringDefinitions(config,rows)).toEqual([rows[0]]);
});
it('发布runner仅接收登记集合完整、来源与父能力均匹配的authoring快照',()=>{
  const key=config.workflow_keys[0],repo=config.source_repo,revision='a'.repeat(40),path='contracts/report.json';
  const snapshot={scope:'commander-generic',repo,revision,map:{repositories:[{scope_key:'commander-generic',adapter_config:config}]},
    definitions:{workflows:[{workflow_id:'w',source_repo:repo,source_path:path,source_commit:revision,payload:{key,registration_protocol:'definition-freeze-v1',contract:{key,capability_id:'c',source:{repo,ref:path,revision}}}}]},
    canonical:{workflows:[{id:'w',key,status:'active',capability_id:'c',source_repo:repo,source_path:path}]}};
  expect(isAuthoringReleaseSnapshot(snapshot)).toBe(true);
  for(const change of [s=>s.map.repositories=[],s=>s.definitions.workflows=[],s=>s.canonical.workflows[0].capability_id='wrong',s=>s.definitions.workflows[0].source_commit='b'.repeat(40)]){
    const bad=structuredClone(snapshot);change(bad);expect(isAuthoringReleaseSnapshot(bad)).toBe(false);
  }
});
