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

// main成功源码唯一自动发布入口；请求与精确SHA收据的控制字节逐项固定。
export const MAIN_AUTO_DEPLOY_WORKFLOW='9609e830c9e7b7610799e163e0263aa1bc5672d4cb2747d66d9eda9580363f38';
export const MAIN_AUTO_DEPLOY_INPUTS={
 '.github/workflows/ci.yml':'ed54842767cae9ea4ea9043d771dae65d9c311829b732c3ae1e8f2d7693e7ea5',
 'scripts/ci/__tests__/basic-workflow.test.mjs':'62cbed6a3c50366f32a2fdb82a830e07e9d61606b5dd99df61dea4917b887761',
 'scripts/ci/__tests__/basic-brain-auto-deploy.test.mjs':'be9571bb9be22e5157f5b02505e4c0eb8b69df344ec5061ae37d7a84f2a720fc',
 'scripts/ci/__tests__/basic-retired-cd-entrypoints.test.mjs':'29b2bb406c12d7d25328076f8ba6784043b628cb2e7c265f204d180bc2a54105',
 'scripts/ci/__tests__/basic-brain-candidate-host.test.mjs':'144acb2905beaf16a2cbe93e8b34610087bc1be31ce13f4b449d9b6dae69128e',
 'scripts/ci/gate3-trigger-deploy.sh':'709b03c67e1267b5077220e59dd4147530580c41c01531554ea89574621d1248',
 'scripts/ci/gate3-wait-deploy.sh':'e5a85778d3fe81ca81ad8abc86ae13cd68e3b71536b14c69a1da4a2a7a4189c0',
 'scripts/ci/__tests__/gate3-wait-deploy.test.sh':'393edfa83d7eed07d74e9c3c58e08415bbb9873db3037493c5cf9f6084781bb4',
 'scripts/deploy-local.sh':'0cdb2a144ed3f8781e121dbaa20a83dc42189422d57cc1cee4442a4110d98430',
 'scripts/brain-build.sh':'b16a6eeaeb1368e177898c691ad9e62b1b2675fe9f917d43839af426de166815',
 'scripts/lib/brain-candidate-docker.sh':'e5cc376b0817ca722c08b9372fed3a979094efdcc168fec249bf477b8d6ae2b2',
 'packages/brain/src/__tests__/deploy-root-guard.test.js':'955fe4f65acfc2788009e14ef095db25b2c92e1677996def63cc087381aee7af',
 'scripts/brain-deploy.sh':'c99bbb724b35d94c468f500c2b8c91dc1abd96a3b94190e046ebcac3743be521',
 'packages/brain/deploy/install.sh':'86496d1fca81d7cda9118e178da3a71872a7c6f8b3acc7d9d295ede559cc3821',
 'scripts/setup-autostart.sh':'482a92174d767613f0b67741298522b80c4d26929470484b16470a3acdb62b81',
 'scripts/__tests__/brain-deploy-sha-readonly.test.sh':'afb0b87df55a9d69e72d566d4a444f0119c819f94325b76494e19bdd179b716e',
 'packages/brain/scripts/cecelia-run.sh':'93123b44c00b0c4b2e335fcffb47a8a979eaa99aca0a9dab9fdd9e11bab14a37',
 'packages/brain/src/scheduler-jobs.js':'d9cd332019b7344924d23fd959c0ba932c14e1a0529ca8e0bc730ae30d66ad82',
 'packages/brain/src/tick-runner.js':'c26146b22105417fa2acad662ac8b626a97ddf0942a3fa1bd5db04522d82a2b4',
 'packages/brain/src/tick-state.js':'5e4edcc6e394186d5ae9ca3271fa6edbd77ab252caaff1da89fb902d82da1ed1',
 'scripts/smoke/brain-compose-envfile-authority-smoke.sh':'fb99738ec5aee443be010098c2e0728f4da1551e2dabdcad427f213157f20243',
 'scripts/promote-dashboard.sh':'191284b9b43d5f3c321bec7a8d90fecf71d1fe506e9c62e9dafb1b12453d24df',
 'scripts/check-deploy-fingerprint.sh':'5f1e48e5650f1a20c88daa544c6e64dc7573ada894f6edf891bda93eff34abc9',
 'scripts/__tests__/dashboard-release-bind.test.mjs':'dc5795d8802b42bb57705369468f22363fd98a67addb4d372d89915d59bfbdc9',
 'scripts/__tests__/dashboard-release-bind-fingerprint.test.mjs':'cae01ed84932401bff7de08a66a0513d1c6a2e5dce24abf135f37ab5ae870516',
 'scripts/__tests__/dashboard-release-promote.test.sh':'6c322d0e664368f8cfa0cefb75ee366e4b8c46542f3b051211ee5efb40145e9c',
 'scripts/__tests__/dashboard-release-rollback.test.sh':'20e37e0e40420aa6c0a9417e754d71aed59003979054692d982bbac69f2ae2a9',
 'packages/brain/src/routes/ops.js':'e9f088f7be3cc0c694c1433428fe4c147018764356b9a1894d4c0d7014294e63',
 'packages/brain/src/__tests__/deploy-receipt.test.js':'e3908cf4832dc6e528dbefb7470684220a486863dd72d9facd2c88b10c8f2df3',
 'packages/brain/src/__tests__/integration/deploy-rollback-flow.integration.test.js':'017ebf8100acbde5a0e4b4eef660718da549e2267dcf418063785a1444fc40eb',
 'scripts/post-merge-deploy.sh':null,
 'scripts/deploy.sh':null,
 'scripts/ci/assert-deploy-effect.sh':null,
 'scripts/ci/__tests__/assert-deploy-effect.test.sh':null,
 'packages/brain/src/cron/drift-sentinel.js':null,
 'packages/brain/src/cron/__tests__/drift-sentinel.test.js':null,
 'packages/brain/src/cron/__tests__/drift-sentinel-state.test.js':null,
 'tests/regression/drift-sentinel-init/tick-runner-drift-sentinel-wiring.test.js':null,
 '.github/workflows/deploy.yml':null,
 '.github/workflows/brain-ci-deploy.yml':null,
 'packages/brain/deploy/com.cecelia.brain.plist':null,
 'scripts/brain-docker-up.sh':null,
 'scripts/brain-docker-down.sh':null,
 'scripts/brain-docker-smoke.sh':null,
 'scripts/brain-reload.sh':null,
 'scripts/deploy-workspace/deploy-hk.sh':null,
 'scripts/deploy-workspace/docker-compose.hk.yml':null,
 'scripts/deploy-workspace/nginx.conf':null,
 'scripts/deploy-workspace/nginx-core.conf':null,
 'packages/brain/deploy/cecelia-watchdog.sh':null,
 'packages/brain/src/__tests__/deploy-rollback.test.js':null,
 'packages/brain/scripts/setup-pm2.sh':null,
 'packages/brain/ecosystem.config.cjs':null,
};
