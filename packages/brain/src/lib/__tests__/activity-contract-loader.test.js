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

it('同一业务能力可登记多个独立流程契约，不能被冒名挂到其他能力', async () => {
  const f = contractsFixture(), key = 'douyin_video_processing';
  f.docs[key] = { ...structuredClone(f.docs.keyword_acquisition), contract_key: key,
    workflow: 'douyin-video-processing', brain_workflow_key: key, source_repo: 'perfectuser21/zenithjoy-workspace' };
  f.refresh();
  const owner = { key: 'douyin_keyword_leadgen', capability_id: 'a1000000-0000-4000-8000-000000000001',
    source_repo: 'perfectuser21/zenithjoy-workspace', source_capability: 'keyword_acquisition',
    source_path: 'product-map/contracts/keyword_acquisition.yaml', source_workflow: 'social-keyword-leadgen', status: 'retired' };
  const workflow = { ...owner, key, source_capability: key, source_path: `product-map/contracts/${key}.yaml`,
    source_workflow: 'douyin-video-processing', status: 'paused' };
  const read = async path => yaml.dump(f.docs[path.match(/contracts\/(\w+)\.yaml/)[1]]);
  const result = await loadActivityContracts([workflow], f.digest, read, [owner, workflow]);
  expect(result[0].contract.capability).toBe('keyword_acquisition');
  expect(result[0].activities[0].activity.from).toBe(key);
  for (const owners of [[workflow], [{ ...owner, source_repo: 'untrusted/repo' }, workflow],
    [owner, { ...owner, key: 'ambiguous_owner', capability_id: 'other' }, workflow]]) {
    await expect(loadActivityContracts([workflow], f.digest, read, owners)).rejects.toThrow(/能力归属/);
  }
  await expect(loadActivityContracts([{ ...workflow, capability_id: 'a1000000-0000-4000-8000-000000000002' }],
    f.digest, read, [owner, workflow])).rejects.toThrow(/能力归属/);
});
