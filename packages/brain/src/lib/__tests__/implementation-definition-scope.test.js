import { expect,it } from 'vitest';
import * as impact from '../implementation-impact.js';
const factory='7743d66a-d3e0-4ebf-b82d-3f5d2d769fb1';
it('相同repo和SHA的公司KR定义与不可执行工厂来源历史分别进入自己的真实scope',()=>{
  const native={id:'native',workflow_id:'native-wf',payload:{key:'company_kr_analysis'}};
  const consumer={id:'consumer',workflow_id:factory,payload:{definition_scope:'consumer_evidence',source_scope:'cecelia-factory'}};
  expect(impact.selectScopedDefinitionVersions).toBeTypeOf('function');
  expect(impact.selectScopedDefinitionVersions([native,consumer],'cecelia-kr')).toEqual([native]);
  expect(impact.selectScopedDefinitionVersions([native,consumer],'cecelia-factory')).toEqual([consumer]);
});
it('不能用来源标志冒充不存在的工厂身份或把不可执行历史混入其它scope',()=>{
  expect(impact.selectScopedDefinitionVersions([{workflow_id:'foreign',payload:{definition_scope:'consumer_evidence',source_scope:'cecelia-factory'}}],'cecelia-factory')).toEqual([]);
  expect(impact.selectScopedDefinitionVersions([{workflow_id:factory,payload:{definition_scope:'consumer_evidence',source_scope:'other'}}],'cecelia-factory')).toEqual([]);
});
