/** 仅授权本次已审优化的完整控制字节；不从候选摘要推导授权。 */
import yaml from 'js-yaml';
import {createHash} from 'node:crypto';
const sorted=x=>Array.isArray(x)?x.map(sorted):x&&typeof x==='object'
 ?Object.fromEntries(Object.keys(x).sort().map(k=>[k,sorted(x[k])])):x;
export const workflowHash=text=>createHash('sha256').update(JSON.stringify(sorted(yaml.load(text)))).digest('hex');
export const CI_BUILD_DEDUP_WORKFLOW='f538e3ab8b331efc3297be6e4a8bb6230ff9b3c6877fb279512f28cbdd21ccae';
export const CI_BUILD_DEDUP_INPUTS={
 '.github/workflows/ci.yml':'d55635631b7147b731c2f08d07b9398079f8e79d668c06125ff97ed592966d90',
 'scripts/ci/__tests__/basic-workflow.test.mjs':'1b98649240576dba65322ca9e4856457fac94d3b4417d831b6262443f304a1b4',
 'scripts/ci/__tests__/basic-fixed-core.test.mjs':'bc4c36a0ba5fa52f6f2fd896b90390d631260fd92c1f0afabac8620bdc7db936',
};
