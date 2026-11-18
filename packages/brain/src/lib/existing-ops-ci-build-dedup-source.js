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

// 默认CI预览退役：完整旧组保留，只有本次已审字节与明确缺失清单获准。
export const PREVIEW_RETIREMENT_WORKFLOW='4c9734d4ebbf73d21e9526e8e2b2178436349290521577817bb8171c46c3badc';
export const PREVIEW_RETIREMENT_INPUTS={
 '.github/workflows/ci.yml':'fccfbbeee7d5afd14398949472f78245a1bf683cff5516f36884b2df2298275a',
 'scripts/ci/__tests__/basic-workflow.test.mjs':'51844d58d85f09bc7aa69b5acc12452caf679f1dccb7940990d66acdbfa75ba1',
 'scripts/ci/__tests__/basic-ops-coverage.test.mjs':'5d219550df110e7b75ae0e9d0bd5753d82dca527e75fb424ad58d547b5fc9e07',
 '.github/actions/preview-deploy/action.yml':null,
 '.github/actions/preview-cleanup/action.yml':null,
 'scripts/ci/preview-ui.mjs':null,
 'scripts/ci/__tests__/basic-preview-deploy.test.mjs':null,
 'scripts/ci/__tests__/basic-preview-cleanup.test.mjs':null,
 'scripts/ci/__tests__/basic-preview-ui.test.mjs':null,
 'scripts/request-preview-start.sh':null,
 'scripts/verify-preview-identity.sh':null,
 'scripts/wait-preview-active.sh':null,
 'scripts/__tests__/preview-start-request-retry.test.sh':null,
 'scripts/__tests__/preview-wait-restart-recovery.test.sh':null,
};
