import { it,expect } from 'vitest';
import { loadActivityContracts } from '../activity-contract-loader.js';
import { contractsFixture,hash } from '../../__tests__/fixtures/shared-activity-contracts.js';
import yaml from 'js-yaml';
it('已登记但无活动的契约仍验证digest并产生空计划',async()=>{
  const f=contractsFixture(),cap='keyword_acquisition';
  f.docs[cap].activities=[];
  f.digest.capabilities[cap]={sha256:hash(f.docs[cap]),activities:{}};
  const result=await loadActivityContracts([{source_capability:cap,source_path:`product-map/contracts/${cap}.yaml`,source_workflow:'social-keyword-leadgen'}],f.digest,async()=>yaml.dump(f.docs[cap]));
  expect(result[0].activities).toEqual([]);
  f.digest.capabilities[cap].sha256='bad';
  await expect(loadActivityContracts([{source_capability:cap,source_path:`product-map/contracts/${cap}.yaml`,source_workflow:'social-keyword-leadgen'}],f.digest,async()=>yaml.dump(f.docs[cap]))).rejects.toThrow('digest');
});
it.each(['brain_workflow_key', 'source_repo'])('显式%s不能与已登记身份冲突', async field => {
  const f = contractsFixture(), cap = 'keyword_acquisition';
  f.docs[cap][field] = field === 'brain_workflow_key' ? 'wrong_workflow' : 'wrong/repo'; f.refresh();
  const registration = { key: 'douyin_keyword_leadgen', source_repo: 'perfectuser21/zenithjoy-workspace', source_capability: cap, source_path: `product-map/contracts/${cap}.yaml`, source_workflow: 'social-keyword-leadgen' };
  await expect(loadActivityContracts([registration], f.digest, async () => yaml.dump(f.docs[cap]))).rejects.toThrow(/身份|映射/);
});
