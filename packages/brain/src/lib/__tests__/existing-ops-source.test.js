import {it,expect} from 'vitest';
import {buildExistingOpsSources} from '../existing-ops-source.js';

it('来源输入在解析或读源前拒绝非工厂scope、跨仓库、浮动SHA和非法路径',async()=>{
 const path='packages/brain/src/lib/existing-ops-source.js';let reads=0;
 const input={scope:'cecelia-factory',repo:'perfectuser21/cecelia',revision:'f'.repeat(40),paths:[path],readSource:async()=>{reads++;throw Error('unexpected read');}};
 for(const override of [{scope:'cecelia'},{scope:'cecelia-kr'},{repo:'foreign/repo'},{revision:'main'},
  {paths:['packages/brain/migrations/*.sql']},{paths:['../outside.js']},{paths:[path,path]}])
  await expect(buildExistingOpsSources({...input,...override})).rejects.toThrow('OPS_SOURCE_INPUT_INVALID');
 expect(reads).toBe(0);
});

it('F2退役只保历史身份：不读部署、迁移或staging源码，也不留下成功绑定',async()=>{
 const reads=[];
 const paths=['.github/workflows/brain-ci-deploy.yml','scripts/ci/gate3-trigger-deploy.sh','packages/brain/src/routes/ops.js','scripts/deploy-local.sh','scripts/brain-deploy.sh','packages/brain/src/migrate.js','scripts/lib/internal-auth-token.sh'];
 const proof=await buildExistingOpsSources({scope:'cecelia-factory',repo:'perfectuser21/cecelia',revision:'f'.repeat(40),paths,readSource:async path=>{reads.push(path);return 'retired source';}});
 const f2=proof.consumers.find(c=>c.workflow_key==='factory_f2_ops');
 expect(f2).toMatchObject({status:'unknown',gaps:[{code:'consumer_retired'}],bindings:[],input_relations:[]});
 expect(reads).toEqual([]);
 expect(proof.consumers.find(c=>c.workflow_key==='factory_f3_ops').gaps).not.toContainEqual({code:'consumer_retired'});
});
