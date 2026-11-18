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

// 相同CI下只接受各自完整的旧挂载组与新挂载修复组，不以未知成员回退。
export const BIND_MOUNT_MARKER='scripts/ci/__tests__/basic-deploy-root-mounts.test.mjs';
export const BIND_MOUNT_HELPER='scripts/lib/deploy-runtime-inputs.sh';
export const BIND_MOUNT_LEGACY_INPUTS={
 'docker-compose.us-vps.yml':'7d152cec3fea0f50cab0a707bd7830a01c620953ffcc99851be27e384aca405b',
 'scripts/lib/deploy-runtime-inputs.sh':null,
 'scripts/ci/__tests__/basic-deploy-root-mounts.test.mjs':null,
};
export const BIND_MOUNT_INPUTS={
 'docker-compose.us-vps.yml':'2781316cd25ea94566d9fb9ee3208f60d6c9357188b646bba0d317e64283c205',
 'scripts/lib/deploy-runtime-inputs.sh':'a2329e0ede4ed19f8cd8ab1200e0340ad438432c713894de32b442ec606cc62e',
 'scripts/deploy-local.sh':'d5ca8f439fac2cd70d719074f4b28af0b1e7a8341bae8e49c67dbad4a883bce6',
 'packages/brain/src/__tests__/deploy-root-guard.test.js':'45c0add857032273de821451ed9a5f45b1ef97a9cf2999501053d0b44abd1951',
 'scripts/ci/__tests__/basic-deploy-root-mounts.test.mjs':'c0bca7021f6144bb175ee67aa3e0b934881a20c99efb6b6229f1ba41307031dc',
};

// Builder协议以既有真实回归的已审字节作为类型标记，不猜测未知版本。
export const CANDIDATE_BUILDER_MARKER='scripts/ci/__tests__/basic-brain-candidate-host.test.mjs';
export const CANDIDATE_BUILDER_LEGACY_INPUTS={
 'packages/brain/Dockerfile':'977505fc83d033b115e0d0048d0239a9b82628daf446679811a43e4a1772cedf',
};
export const CANDIDATE_BUILDER_INPUTS={
 'scripts/brain-build.sh':'7f15b390721d25523023a63b15f0dd48793b720ad3a29f0655cef0ac256b5f13',
 'packages/brain/Dockerfile':'aaa8aeb233e5db637e87c1f1bcecaa4588605e8b2c9a81483600b6f5826a6e1e',
 'scripts/ci/run-basic-check.mjs':'7046018e346afbf77042cb6d9f1d3ba6f567bab3cf88ba169db70ed4bce9688c',
 'scripts/ci/__tests__/basic-fixed-core.test.mjs':'16e18d9a685db4a59722b742bc73f1e17c44d07d0e807eee108b12c38db2bde8',
 'scripts/ci/__tests__/basic-brain-candidate-host.test.mjs':'7fe5134563e43af1a539c4de195bec2e33ef172257479053cb5404cdb41753ac',
};

// Builder族内以真实root回归的已审版本区分幂等恢复，旧Builder合同不变。
export const RUNTIME_IDEMPOTENCE_MARKER='packages/brain/src/__tests__/deploy-root-guard.test.js';
export const RUNTIME_IDEMPOTENCE_INPUTS={
 'scripts/lib/deploy-runtime-inputs.sh':'c57401abf7c8286d2eec132e46748563ba853e9bb29187136d47016aec6eb710',
 'packages/brain/src/__tests__/deploy-root-guard.test.js':'2fbb67aae7046f00e16e8be19f739cdd0d854cddd36bc25e6a3e6a3d37c85f76',
};

// 精确绑定Nightly活性/status有界读取与本轮已审退出控制，不扩旧组身份。
export const NIGHTLY_STATUS_MARKER='packages/brain/src/__tests__/deploy-receipt.test.js';
export const NIGHTLY_STATUS_LEGACY_INPUTS={
 'scripts/brain-image-retention/ledger.mjs':'1de1ba852d4a31f303bc3c51384e282c69e40d402202bde3cc6e37472e968db8',
 'scripts/brain-image-retention/docker.mjs':'a341fdbd0611a4c70a6667b2d85d3d08bac07c8d059e192d8c42ed48897212c2',
 'scripts/brain-image-retention/process.mjs':'5e7a77267d55d6df019bd7db44e300ba84cda8680fc01c411555af4a9384a586',
 'scripts/brain-image-retention-settlement.test.mjs':null,
 'scripts/__tests__/fixtures/deploy-settlement-process.mjs':null,
 '.github/workflows/heartbeat-sentinel.yml':'abb7f91734c52be6ce432a846f7ed82b1961940abff5fe02c2609a0e3ee0f1bc',
 'scripts/ci/__tests__/basic-alert-failure-propagation.test.mjs':'cf38bc6866df2b3db0797a7e288ec2787cea86ef85fc45e9512e3608a4e8e1bf',
 'packages/brain/src/__tests__/nightly-regression-config.test.js':'7990b8de86fff817bb79f7a047ec9a5153185d722bf2763f122ad1e229f40c87',
 'scripts/ci/brain-test-debt.json':'5323d7fe01dfc6a03e5fa90de7233240356d9a299650dea6b1ad8b7a1b7d47c9',
 'packages/brain/src/__tests__/consciousness-loop-disabled.test.js':null,
 'packages/brain/src/lib/implementation-ci-snapshot.js':'2c1934fa3181f8000411c7ef07b4c8ce53be552338e646af2f6af6923c93dfd7',
 'scripts/ci/implementation-snapshot.mjs':'3f41b74643389da84353a32cd531204d79ce53522cf740208b73f2559a39730c',
 'packages/brain/src/lib/company-kr-source.js':'afc209676f6c814350d55b7285ffb4dd5bec8499e46a5ec8acc3109c746a6d8d',
 'packages/brain/src/projection/company-kr-registration-notion.js':'faf2852c3640586dc564e306b2263bf191e93854aedecac625c8e1d907762d57',
 'packages/brain/src/lib/__tests__/implementation-ci-snapshot.test.js':'018becb678dedae30cba39cc9aad2f28d8efb243aff7fd1a01a970a9ef62e624',
 'packages/brain/src/guard-drill.js':'c0cc76c2f26e6a5a39761090b14cd0e090726ba4bec285b9e841b47572bce403',
 'packages/brain/src/__tests__/guard-drill.test.js':'efc72a11caa3149effb56f4a6e83031c3c1a9f683d7f764aa1b073d3fa00b262',
 'packages/brain/scripts/smoke/shared-activities-smoke.sh':'77b5bc04267ea38be0d75e2cd28d68991ed345191318aae6e10bf1cd0111454e',
 'packages/brain/src/__tests__/integration/shared-activities.pg.integration.test.js':'50a61f5980a3990832c21db7bcbf57383354611c9b2a06856bc62b56788bbe27',
 'scripts/ci/check-nightly-green.sh':'bd113a4d67a4d207a88eb58683f7f23a570212a83bca731ac9a2b2a4950271e7',
 'scripts/ci/__tests__/check-nightly-green.test.sh':'9bdc7ba6fd0eeba96740e40537b9aa3774eb70a74573eab2f15d3db70c6a809f',
 'scripts/ci/__tests__/basic-nightly-time-evidence.test.mjs':'f5e13defa8bba64fde6716966fedc39bbf5c36b31fc61d17cb49970662d87be7',
 'packages/brain/src/lib/company-kr-registration.js':'380741cd6e3fc94a4fbb5c1dee9daa6dff79750319661686c6eba2ebad8efa9b',
 'packages/brain/src/lib/__tests__/company-kr-registration.test.js':'b8058b71d66eeab450b5e484122393232c105d988f6918d3e37b5afd57500453',
 'packages/brain/src/__tests__/integration/company-kr-fixed-source.pg.integration.test.js':'c83f42b8bc1c35a0deb4610819898300f4c2d8b45034db6e3584a8f920928798',
 'packages/brain/src/__tests__/integration/company-kr-registration.pg.integration.test.js':'3d7c14500101b0190fb963140de45d8e3d37f03d40db294a8c6b092dd606d156',
 'packages/brain/src/lib/__tests__/integration/implementation-ci-company.test.js':'872c5c6ee4ca8ff6e6282dd2508470150caa7401642091e1b9ab4158cbbed678',
 'packages/brain/src/__tests__/integration/harness-commander-phase1.integration.test.js':'36c9793e40e5b2890bc754c0d740059e79d0493865bad96a54e9f99f56598dae',
 'packages/brain/src/__tests__/integration/harness-commander-phase2.integration.test.js':'46ec3b9a9dcc5a59b62e9f318c78e134ad2f18589945e7c60bdf3779a78a1e4f',
 'packages/brain/src/quota-guard.js':'322fa6058410477d3126a8df135c486e6e16d6cd3b17e465c42139bffe4b3505',
};
export const NIGHTLY_STATUS_INPUTS={
 'packages/brain/src/routes/ops.js':'6e93b7aacfc22d0bc71ddcc69900cd1efa84058326a4ebd070b4d3ba80f2ffeb',
 'packages/brain/src/__tests__/deploy-receipt.test.js':'db29ab1769576f06d2d3c29dd6e8f75caa9fd494aee51410faafc55365430308',
 'scripts/brain-image-retention/ledger.mjs':'be4eba4ff10b7510f71ae461bb9b543f6a092ccdaca150d32b3f76af5586d129',
 'scripts/brain-image-retention/docker.mjs':'3588f732e156fa7cf97407f938b674a9ca88861002a1e0bbb167fa176fd8d67f',
 'scripts/brain-image-retention/process.mjs':'dc6311ce2ada55e4bb4116e8c49b04ffebe3a85eced06ae983876371e1d8e6f5',
 'scripts/brain-image-retention-settlement.test.mjs':'a682c780cc51250de4415f8333c6b2e64e5b7f2777a687a1b2f84d34fc386efd',
 'scripts/__tests__/fixtures/deploy-settlement-process.mjs':'c4a0af891a38ebb8a19df5c62ddbf80c87669b6eeafe051817525f1bf5ca04bc',
 '.github/workflows/heartbeat-sentinel.yml':'2d55237fda93fd03de91cdfe0d2f27f216aa22c72038a56b82d89b9a9d70c366',
 'scripts/ci/__tests__/basic-alert-failure-propagation.test.mjs':'a97b336ee8f5b48dec974a2c06fdab92e7de31d5fb923bffde02e674312c9c4c',
 'packages/brain/src/__tests__/nightly-regression-config.test.js':'21b6da67c353f46fc140522e1606a9f0669731689ce19a3d989ecdbb1ad96c37',
 'packages/brain/vitest.config.js':'314e3a8103a28fdbc4db339cf5b22c1c0134c082003983d66998adac1a92dd1c',
 'scripts/ci/deep-integration.config.mjs':'52023156a9fd8da30ba64a90a886ee8833c70acc89ef7913b295955aa0876173',
 'scripts/ci/brain-test-debt.json':'f9fd4491ef4e11dc34e5096367f4bfaa38bfe2c37343fd2f9b649586f982ea55',
 'packages/brain/src/__tests__/consciousness-loop-disabled.test.js':'a8f03a02335424030e11f2ecff7f6c96c1769e32f3ad1f4b75c4a7730182e97f',
 'packages/brain/src/lib/implementation-ci-snapshot.js':'839dd1193922545b1f5360d8e541a1ddc9f9b4b13236dee6ab15ec456ee3093c',
 'scripts/ci/implementation-snapshot.mjs':'a28b93c1000f13fbd871152e46b965f0df976eb9ac322332d959fa18c773f399',
 'packages/brain/src/lib/company-kr-source.js':'b26ef2cce6e08c1a2f25f15a6cf9a771de246eeff1cc8046d98a9b1862622a4c',
 'packages/brain/src/projection/company-kr-registration-notion.js':'95ca4677642113b53bea8db2010498c295570ed994ce333b87d17c6bf8cdc2be',
 'packages/brain/src/lib/__tests__/implementation-ci-snapshot.test.js':'ba4104edec98600da706f22797aff0c93ede638182f09011416ee3c8b7ec3ed2',
 'packages/brain/src/guard-drill.js':'5c75498b907e2a135a29b6acf4b13d257832a9386c99714711bd08687354202a',
 'packages/brain/src/__tests__/guard-drill.test.js':'996f690ff48f4ed09ac1dc5a39778f03e5ffa693538d2653c23e8b1156a0793c',
 'packages/brain/scripts/smoke/shared-activities-smoke.sh':'e608665e602b5797741c4ff1172ddc482589692671a7b7ce1390ceef5719c981',
 'packages/brain/src/__tests__/integration/shared-activities.pg.integration.test.js':'7622e6df2a7d97b829e252a9b91ffb6fc05c40746d50979ee32817d5a1dbb2de',
 'scripts/ci/check-nightly-green.sh':null,
 'scripts/ci/__tests__/check-nightly-green.test.sh':null,
 'scripts/ci/__tests__/basic-nightly-time-evidence.test.mjs':null,
 'packages/brain/src/lib/company-kr-registration.js':null,
 'packages/brain/src/lib/__tests__/company-kr-registration.test.js':null,
 'packages/brain/src/__tests__/integration/company-kr-fixed-source.pg.integration.test.js':null,
 'packages/brain/src/__tests__/integration/company-kr-registration.pg.integration.test.js':null,
 'packages/brain/src/lib/__tests__/integration/implementation-ci-company.test.js':null,
 'packages/brain/src/__tests__/integration/harness-commander-phase1.integration.test.js':null,
 'packages/brain/src/__tests__/integration/harness-commander-phase2.integration.test.js':null,
 'packages/brain/src/quota-guard.js':null,
};
