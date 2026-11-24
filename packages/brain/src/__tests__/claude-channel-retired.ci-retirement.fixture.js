/** 仅已知完整历史组与经独审的现役源码整组取得只读数据资格。 */
import {describe,it,expect} from 'vitest';
import path from 'node:path';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
const COHORTS=[
  {
    "existing-ops-source.js": "1cf2ae6448fb9ec58c84a679d0b2c9016965c2d0edf4921553044e88f20e9b62",
    "existing-ops-workspace-source.js": "13572f4ef0c99c0804c579f31b6c29887a36eeb99e5bcf361b6d2c6dc13a7c18",
    "existing-ops-build-source.js": "210f644726dbf3d0049b7c90ced280fc8fcf65d04e1ae30c2775c2234ed0331a",
    "existing-ops-build-envelopes.js": "e68813c0304ade2b9f11c4c93ec731e1cb77414aca17d488d8f203c93559888f",
    "existing-ops-runtime-source.js": "0502b6667a7675c94ae8af8e6c74ffea1cbd464d9f8d20671d0eb770c54958ec",
    "existing-ops-us-compose-source.js": "0e7594aec56b98f42dd65073050ce68d2a31fcc9add81c8111a47831644be45b",
    "existing-ops-stage-source.js": "ea7ab17886cb70a7c347225e4896a1ae0a192b7bf903b87c3e22cb60184d9981",
    "existing-ops-stage-envelopes.js": "1fda2fc1f3bf3ef7684930e46ac8dc0364bd1af1f8f27e97c7eb197fe23a6d8f",
    "existing-ops-stage-modes.js": "cccab22f5265503733294f12aeb141e8153c39c77d2b4d90fed458b50e601620",
    "existing-ops-provenance-envelope.js": "ade6df8d35b187ce0495ebd163fa0489379f37114fe2111b4677a4b622933a95",
    "existing-ops-provenance-core-envelope.js": "c3e8769e7f053fc63d52074235b521df5134e65c31d34f151bb6a9400fa4ab93",
    "existing-ops-provenance-entry-envelopes.js": "126a93b9db9856fe06894a394ecb9e0afd099860b9fb54e8927c56c8b96a15bb",
    "existing-ops-provenance-local-envelopes.js": "ef359ef987229815f3d258ff78535fb55dc909bb64eae88d67ce63d0ea55c7f4",
    "existing-ops-native-evidence-source.js": "04632ac4b6c0c25e141938d3ff68a7c3eda079056f6e82a35ebfede5f35050de",
    "existing-ops-native-evidence-envelopes.js": "44abae0d93238048356f5573765320b92ad54e481ba78f5925a3c558a8b86013",
    "../../../../scripts/ci/implementation-snapshot.mjs": "3bd83218b5db7125a0af7c92bf916bb4bde5cc159905acd8746c263bac3e2511"
  },
  {
    "existing-ops-source.js": "1cf2ae6448fb9ec58c84a679d0b2c9016965c2d0edf4921553044e88f20e9b62",
    "existing-ops-workspace-source.js": "13572f4ef0c99c0804c579f31b6c29887a36eeb99e5bcf361b6d2c6dc13a7c18",
    "existing-ops-build-source.js": "210f644726dbf3d0049b7c90ced280fc8fcf65d04e1ae30c2775c2234ed0331a",
    "existing-ops-build-envelopes.js": "e68813c0304ade2b9f11c4c93ec731e1cb77414aca17d488d8f203c93559888f",
    "existing-ops-runtime-source.js": "0502b6667a7675c94ae8af8e6c74ffea1cbd464d9f8d20671d0eb770c54958ec",
    "existing-ops-us-compose-source.js": "0e7594aec56b98f42dd65073050ce68d2a31fcc9add81c8111a47831644be45b",
    "existing-ops-stage-source.js": "37caaed041146e25319c8d90906a4953344f1d0f968faf57c57111909dde46cf",
    "existing-ops-stage-envelopes.js": "1fda2fc1f3bf3ef7684930e46ac8dc0364bd1af1f8f27e97c7eb197fe23a6d8f",
    "existing-ops-stage-modes.js": "cccab22f5265503733294f12aeb141e8153c39c77d2b4d90fed458b50e601620",
    "existing-ops-provenance-envelope.js": "ade6df8d35b187ce0495ebd163fa0489379f37114fe2111b4677a4b622933a95",
    "existing-ops-provenance-core-envelope.js": "c3e8769e7f053fc63d52074235b521df5134e65c31d34f151bb6a9400fa4ab93",
    "existing-ops-provenance-entry-envelopes.js": "126a93b9db9856fe06894a394ecb9e0afd099860b9fb54e8927c56c8b96a15bb",
    "existing-ops-provenance-local-envelopes.js": "ef359ef987229815f3d258ff78535fb55dc909bb64eae88d67ce63d0ea55c7f4",
    "existing-ops-native-evidence-source.js": "04632ac4b6c0c25e141938d3ff68a7c3eda079056f6e82a35ebfede5f35050de",
    "existing-ops-native-evidence-envelopes.js": "44abae0d93238048356f5573765320b92ad54e481ba78f5925a3c558a8b86013",
    "../../../../scripts/ci/implementation-snapshot.mjs": "3bd83218b5db7125a0af7c92bf916bb4bde5cc159905acd8746c263bac3e2511"
  },
  {
    "existing-ops-source.js": "1cf2ae6448fb9ec58c84a679d0b2c9016965c2d0edf4921553044e88f20e9b62",
    "existing-ops-workspace-source.js": "13572f4ef0c99c0804c579f31b6c29887a36eeb99e5bcf361b6d2c6dc13a7c18",
    "existing-ops-build-source.js": "210f644726dbf3d0049b7c90ced280fc8fcf65d04e1ae30c2775c2234ed0331a",
    "existing-ops-build-envelopes.js": "e68813c0304ade2b9f11c4c93ec731e1cb77414aca17d488d8f203c93559888f",
    "existing-ops-runtime-source.js": "0502b6667a7675c94ae8af8e6c74ffea1cbd464d9f8d20671d0eb770c54958ec",
    "existing-ops-us-compose-source.js": "0e7594aec56b98f42dd65073050ce68d2a31fcc9add81c8111a47831644be45b",
    "existing-ops-stage-source.js": "722088ae9df5598fbf7327eb7cb0b94d077d664bdb97ae3b9a28f675bd487d4d",
    "existing-ops-stage-envelopes.js": "1fda2fc1f3bf3ef7684930e46ac8dc0364bd1af1f8f27e97c7eb197fe23a6d8f",
    "existing-ops-stage-modes.js": "cccab22f5265503733294f12aeb141e8153c39c77d2b4d90fed458b50e601620",
    "existing-ops-provenance-envelope.js": "ade6df8d35b187ce0495ebd163fa0489379f37114fe2111b4677a4b622933a95",
    "existing-ops-provenance-core-envelope.js": "c3e8769e7f053fc63d52074235b521df5134e65c31d34f151bb6a9400fa4ab93",
    "existing-ops-provenance-entry-envelopes.js": "126a93b9db9856fe06894a394ecb9e0afd099860b9fb54e8927c56c8b96a15bb",
    "existing-ops-provenance-local-envelopes.js": "ef359ef987229815f3d258ff78535fb55dc909bb64eae88d67ce63d0ea55c7f4",
    "existing-ops-native-evidence-source.js": "04632ac4b6c0c25e141938d3ff68a7c3eda079056f6e82a35ebfede5f35050de",
    "existing-ops-native-evidence-envelopes.js": "44abae0d93238048356f5573765320b92ad54e481ba78f5925a3c558a8b86013",
    "../../../../scripts/ci/implementation-snapshot.mjs": "3bd83218b5db7125a0af7c92bf916bb4bde5cc159905acd8746c263bac3e2511"
  },
  {
    "existing-ops-source.js": "1cf2ae6448fb9ec58c84a679d0b2c9016965c2d0edf4921553044e88f20e9b62",
    "existing-ops-workspace-source.js": "13572f4ef0c99c0804c579f31b6c29887a36eeb99e5bcf361b6d2c6dc13a7c18",
    "existing-ops-build-source.js": "210f644726dbf3d0049b7c90ced280fc8fcf65d04e1ae30c2775c2234ed0331a",
    "existing-ops-build-envelopes.js": "e68813c0304ade2b9f11c4c93ec731e1cb77414aca17d488d8f203c93559888f",
    "existing-ops-runtime-source.js": "0502b6667a7675c94ae8af8e6c74ffea1cbd464d9f8d20671d0eb770c54958ec",
    "existing-ops-us-compose-source.js": "0e7594aec56b98f42dd65073050ce68d2a31fcc9add81c8111a47831644be45b",
    "existing-ops-stage-source.js": "3f95110c2d222ab1596c50ace88c8908f2423afcb561a6616ebe4a9b545060ab",
    "existing-ops-stage-envelopes.js": "1fda2fc1f3bf3ef7684930e46ac8dc0364bd1af1f8f27e97c7eb197fe23a6d8f",
    "existing-ops-stage-modes.js": "cccab22f5265503733294f12aeb141e8153c39c77d2b4d90fed458b50e601620",
    "existing-ops-provenance-envelope.js": "ade6df8d35b187ce0495ebd163fa0489379f37114fe2111b4677a4b622933a95",
    "existing-ops-provenance-core-envelope.js": "c3e8769e7f053fc63d52074235b521df5134e65c31d34f151bb6a9400fa4ab93",
    "existing-ops-provenance-entry-envelopes.js": "126a93b9db9856fe06894a394ecb9e0afd099860b9fb54e8927c56c8b96a15bb",
    "existing-ops-provenance-local-envelopes.js": "ef359ef987229815f3d258ff78535fb55dc909bb64eae88d67ce63d0ea55c7f4",
    "existing-ops-native-evidence-source.js": "04632ac4b6c0c25e141938d3ff68a7c3eda079056f6e82a35ebfede5f35050de",
    "existing-ops-native-evidence-envelopes.js": "44abae0d93238048356f5573765320b92ad54e481ba78f5925a3c558a8b86013",
    "../../../../scripts/ci/implementation-snapshot.mjs": "3bd83218b5db7125a0af7c92bf916bb4bde5cc159905acd8746c263bac3e2511"
  },
  {
    "existing-ops-source.js": "1cf2ae6448fb9ec58c84a679d0b2c9016965c2d0edf4921553044e88f20e9b62",
    "existing-ops-workspace-source.js": "13572f4ef0c99c0804c579f31b6c29887a36eeb99e5bcf361b6d2c6dc13a7c18",
    "existing-ops-build-source.js": "210f644726dbf3d0049b7c90ced280fc8fcf65d04e1ae30c2775c2234ed0331a",
    "existing-ops-build-envelopes.js": "e68813c0304ade2b9f11c4c93ec731e1cb77414aca17d488d8f203c93559888f",
    "existing-ops-runtime-source.js": "0502b6667a7675c94ae8af8e6c74ffea1cbd464d9f8d20671d0eb770c54958ec",
    "existing-ops-us-compose-source.js": "0e7594aec56b98f42dd65073050ce68d2a31fcc9add81c8111a47831644be45b",
    "existing-ops-stage-source.js": "d4723568dfdf6e2c842e47de84eb21f10f9262bfdaf28d05159cbdf02bc53148",
    "existing-ops-stage-envelopes.js": "1fda2fc1f3bf3ef7684930e46ac8dc0364bd1af1f8f27e97c7eb197fe23a6d8f",
    "existing-ops-stage-modes.js": "cccab22f5265503733294f12aeb141e8153c39c77d2b4d90fed458b50e601620",
    "existing-ops-provenance-envelope.js": "ade6df8d35b187ce0495ebd163fa0489379f37114fe2111b4677a4b622933a95",
    "existing-ops-provenance-core-envelope.js": "c3e8769e7f053fc63d52074235b521df5134e65c31d34f151bb6a9400fa4ab93",
    "existing-ops-provenance-entry-envelopes.js": "126a93b9db9856fe06894a394ecb9e0afd099860b9fb54e8927c56c8b96a15bb",
    "existing-ops-provenance-local-envelopes.js": "ef359ef987229815f3d258ff78535fb55dc909bb64eae88d67ce63d0ea55c7f4",
    "existing-ops-native-evidence-source.js": "04632ac4b6c0c25e141938d3ff68a7c3eda079056f6e82a35ebfede5f35050de",
    "existing-ops-native-evidence-envelopes.js": "44abae0d93238048356f5573765320b92ad54e481ba78f5925a3c558a8b86013",
    "../../../../scripts/ci/implementation-snapshot.mjs": "3bd83218b5db7125a0af7c92bf916bb4bde5cc159905acd8746c263bac3e2511"
  }
];
const COMMANDER_CI_COHORT={...COHORTS[4],
 'existing-ops-stage-source.js':'ef6a2191f1db8b939e21e2b5c62a8de4bd01f225f713c5c88175194cb938623a'};
const SKILL_RETIREMENT_CI_COHORT={...COMMANDER_CI_COHORT,
 'existing-ops-stage-source.js':'079b4f1785a462bb77d3a12493b24f1352cda40b260a1775a7a8a61289f531f5'};
const PLANNER_RETIREMENT_CI_COHORT={...SKILL_RETIREMENT_CI_COHORT,
 'existing-ops-stage-source.js':'c2bcb8e1a941ed95a4ad527fabbe33b2d63752c20c8eb5696918e5f4fe58899c'};
const COMMANDER_AUDIT_CI_COHORT={...PLANNER_RETIREMENT_CI_COHORT,
 'existing-ops-stage-source.js':'ddb44a3487e8f63c5feeededf008b82c192e6d50c48a103218263015074f4da2'};
const SCRIPT_CLEANUP_CI_COHORT={...COMMANDER_AUDIT_CI_COHORT,
 'existing-ops-stage-source.js':'ebc1bfd56b0d5989e63089c07bd6c8ceac4fdadf266ea879092ba6e91fe6e81f'};
export const CI_READER_PROFILES=['existing-ops-script-cleanup-profile.json','existing-ops-resource-retirement-profile.json','existing-ops-business-smoke-retirement-profile.json','existing-ops-fixed-checks-profile.json','existing-ops-foundation-release-profile.json','existing-ops-closeout-profile.json','existing-ops-checker-repair-profile.json','existing-ops-dormant-boundaries-profile.json','existing-ops-ci-business-guards-profile.json'];
const SCRIPT_CLEANUP_PROFILE_COHORT={...SCRIPT_CLEANUP_CI_COHORT,
 'existing-ops-script-cleanup-profile.json':'fc9b4df6a9c128f5186571e9a89f3a45c818171544730f88b1c5d5977247a98f'};
const RESOURCE_RETIREMENT_CI_COHORT={...SCRIPT_CLEANUP_PROFILE_COHORT,
 'existing-ops-stage-source.js':'5240eb393b4662046cd8c828757f098e90aee629d4c0de76bb505144f003fcf0',
 'existing-ops-resource-retirement-profile.json':'0189fe174fa8ee2b734e4a05b42f296f83d7ebb36acd162813db266bce9252f3'};
const WORKFLOW_REGISTRATION_CI_COHORT={...RESOURCE_RETIREMENT_CI_COHORT,
 'existing-ops-stage-source.js':'94944261869358c2c4d43b6f3249185f35c98285bcde5e2642c882f970d115ad'};
const BUSINESS_SMOKE_RETIREMENT_CI_COHORT={...WORKFLOW_REGISTRATION_CI_COHORT,
 'existing-ops-stage-source.js':'c284c66242416671c69336a5b4e29a295942757fc26aa50f5443030ff2465e94',
 'existing-ops-stage-modes.js':'fe9b633afc1cc4bd128dd4b92a37bad0adebbfbf7fcc144ce09c7664fa965620',
 'existing-ops-business-smoke-retirement-profile.json':'18e8a6aff7886a7875468d923010ef1936fb100b497abc17f9e09c05b83218bd'};
const FIXED_CHECKS_CI_COHORT={...BUSINESS_SMOKE_RETIREMENT_CI_COHORT,
 'existing-ops-stage-source.js':'5a772db4a4457f3a5d71fd0de1300074adc1aae9088ddd75330c7bc7fc5fe97f',
 'existing-ops-stage-modes.js':'b31aba92f87e76ccb139064c483c66adcd244b56582bad485478d8ef49bcf3df',
 'existing-ops-fixed-checks-profile.json':'9cca439f60bccb91b84726e4a59d4f9b1f58782bab25fd135a68974262000aa2'};
const FOUNDATION_RELEASE_CI_COHORT={...BUSINESS_SMOKE_RETIREMENT_CI_COHORT,
 'existing-ops-stage-source.js':'5fdae1a4a7ba88bebef553a41857c3e331f94f6cbef4b66dc540b11acb1e6961',
 'existing-ops-stage-modes.js':'5f49ccddfce66416fc62a84c160c843767ce6f19653dd22bb95e76e248d69642',
 'existing-ops-foundation-release-profile.json':'1ff02f908373ff61365f413433f2ed1c61450e4c3ab813920631db38da862b57'};
const FOUNDATION_FIXED_CHECKS_CI_COHORT={...FIXED_CHECKS_CI_COHORT,
 'existing-ops-stage-source.js':'07e48bf0cf6fddba764249029ef01dac7d090e53e2badee8b1c943a91018e0e0',
 'existing-ops-stage-modes.js':'992eae2093ef2d02bb269514f25b5c2ef742149da2bfa9f38b7c24cd0a61908e',
 'existing-ops-foundation-release-profile.json':'1ff02f908373ff61365f413433f2ed1c61450e4c3ab813920631db38da862b57'};
const CLOSEOUT_CI_COHORT={...FOUNDATION_FIXED_CHECKS_CI_COHORT,...{"existing-ops-source.js":"a10378cc36a263c8fc2c6d8add40c9f947dd48da4a3a56d7ede5b3b771d2d273","existing-ops-runtime-source.js":"8b5ce06592aeddfc4ebf638b4cbeb0c47f40c770991be69ce84e95f62ccb4335","existing-ops-stage-source.js":"91249ea348dc8d8c92bbf709f801e26c671ff4f8591044cedd23fb5bc45bce8b","existing-ops-stage-modes.js":"43686d7b49de79c7144d0d7d8dba5db312854758525f8ca33ef4b9950c990f3a","existing-ops-closeout-profile.json":"7ccb681d2e3aa696bee74e109e028fb55b42b6ac29419d20d7e82fb908297c19"}};
const DORMANT_BOUNDARIES_CI_COHORT={...CLOSEOUT_CI_COHORT,...{"existing-ops-stage-source.js":"d527200b1389a0c15cdff3ef85f154684b9e180bf52cff1a0f1cb3fc2affacde","existing-ops-stage-modes.js":"6cd29efe526ef54f2360fe68f20082a25ed80ae50205ffb04a1bca459cfc1dbd","existing-ops-dormant-boundaries-profile.json":"c4e0d5cdda063ac3425146327b38562af8361f694b720e77066f91176a4dfd2a"}};
const CHECKER_REPAIR_CI_COHORT={...DORMANT_BOUNDARIES_CI_COHORT,
 'existing-ops-stage-source.js':'32ee96f1dab2cc6f245701cfb95c1e842834c35da29bf51cde2412256da5c265',
 'existing-ops-stage-modes.js':'ca7a8944d8df4d388927410dbbd5c61519808ff68996e602d1ab5f30645c7595',
 'existing-ops-checker-repair-profile.json':'b9e11b26b52fc0f189542585581af7aa4d259ada5859bb88b8e7659c1905a776'};
// 本次已审来源模块仅新增数据/哈希helper；旧组固定身份保留。
const BUILD_DEDUP_CI_COHORT={...CHECKER_REPAIR_CI_COHORT,
 'existing-ops-stage-source.js':'6dd78a47fd6afb45e9a94ebd1641ba1d16ba17407badf218fd495a5992696926',
 'existing-ops-stage-modes.js':'63f43278158654ffb8f22b1d44b9e02b0d51d20f7a75f1dce22461a1604f5925',
 'existing-ops-ci-build-dedup-source.js':'afd9031305c2ca4adda4605851cc51f519831dc03901e1c49444916ccc3255d4'};
// 默认CI预览清退只改变这三个已审消费者；历史完整组保持独立。
const PREVIEW_RETIREMENT_CI_COHORT={...BUILD_DEDUP_CI_COHORT,
 'existing-ops-stage-source.js':'14869739a77975ba176c1e141eda79efbad10b9df51ebb771372b8e667c865b5',
 'existing-ops-stage-modes.js':'d700b70fd7d21e91c3d18b28b16bf9372455908b653d9bc0d181291005c5477c',
 'existing-ops-ci-build-dedup-source.js':'16bcaccb5ca70816da7668eb1daec26cbb115ac0084c636b1855ecb539cf8add'};
// 唯一main自动发布控制组；授权静态只读关系，不声明真实部署执行。
const MAIN_AUTO_DEPLOY_CI_COHORT={...PREVIEW_RETIREMENT_CI_COHORT,
 'existing-ops-stage-source.js':'b380c14e87c34072f26bdd8d2fa2421b9a4fb71f16358746f70de293beee489d',
 'existing-ops-stage-modes.js':'cf4e0fd23c57d96accbf9bbce5379a6a5cd9aa5ce54f1621d37227e3af719452',
 'existing-ops-ci-build-dedup-source.js':'43b2c598bd899b1906296728e9c46b24229743b551aa0599ef1599fab4e5f5de'};
// 相同workflow下新增精确挂载修复整组，已合并MAIN完整AST不覆盖。
const BIND_MOUNT_CI_COHORT={...MAIN_AUTO_DEPLOY_CI_COHORT,
 'existing-ops-stage-source.js':'cd0a120216039506fca69264499f7363bea3c1aa12362a51e351898527b3b0e1',
 'existing-ops-stage-modes.js':'c80320cb64104e6516cd9b1d2c47b99bfe4e9938eb3574b32a31f39d5aeb3338',
 'existing-ops-ci-build-dedup-source.js':'db96c415f4806094e6def39bbacc80b21664f1b661cd79f6d1ce961b11cf7d47'};
// Builder版本只新增完整已审组，不覆盖已发布的MAIN/BIND消费者身份。
const CANDIDATE_BUILDER_CI_COHORT={...BIND_MOUNT_CI_COHORT,
 'existing-ops-stage-source.js':'fdaee89fd9e8ba082e2a4d1a636a501c9a596128a54692d42bb0890e1dadafd4',
 'existing-ops-stage-modes.js':'a0bdaf3d70f6a0792edbc88d036ff93f1157667265d0f10ab26e72a1e6906b9a',
 'existing-ops-ci-build-dedup-source.js':'e816c6993ac0d83f2e991994eb09a99d7010e4d470c71800bb8555fb4d008fa9'};
// Runtime幂等恢复另成完整已审组，e5已发布Builder的完整AST继续独立。
const RUNTIME_IDEMPOTENCE_CI_COHORT={...CANDIDATE_BUILDER_CI_COHORT,
 'existing-ops-stage-source.js':'1c62ddc337712382d05d9e97c185651ba50f8a2d88722e085541342f5d6e3e07',
 'existing-ops-stage-modes.js':'76d7d1757cfa7d9c49fc16e1865eb39381e951ef3e041d2885df8b334d49b43b',
 'existing-ops-ci-build-dedup-source.js':'320c809e89c6a530bc5ac6f5ff99dbfc9bdebe602b9fe2051fe765717e5bacf0'};
// 本轮只读新组含实际KR快照caller变更；旧组与旧caller完整身份保留。
const NIGHTLY_STATUS_CI_COHORT={...RUNTIME_IDEMPOTENCE_CI_COHORT,
 'existing-ops-source.js':'7a8424348e0342107a2e29e1a6f41dea2a6fb013debbe474411804404b50f5ac',
 'existing-ops-runtime-source.js':'5f71d0049e8c1d585877d67763777a8a66cfe3fbc46f354cf9b31ba03d8d1a40',
 'existing-ops-stage-source.js':'b367afd9c48e6cb9367f2891424768acddf5fb8138a62a2dc6b04881eaeeac9e',
 'existing-ops-stage-modes.js':'24ba81faf9f071b910d5748bd8356a0bbee083b1ea0ae0d467dcc8532c75cdb7',
 'existing-ops-ci-build-dedup-source.js':'f2150ec4a829a6c770ef1ca2355058aa4a73beff5d79567d9e06ced127193f71',
 '../../../../scripts/ci/implementation-snapshot.mjs':'ab7c86c889005fa73bef240a2f8f585f290f6dee8c264f59a46539f04cf8096d'};
// F2专属部署采集器已卸载，现役F3只读闭包不再包含它。
delete NIGHTLY_STATUS_CI_COHORT['existing-ops-us-compose-source.js'];
// Pilot收集器只新增已独审完整AST组合；旧Nightly组合继续独立核验。
const PILOT_HOST_CI_COHORT={...NIGHTLY_STATUS_CI_COHORT,
 'existing-ops-stage-source.js':'7b3b296f616b2cb299d929465ef0587a8be5295a1bbc3597d940a507819d1296',
 'existing-ops-stage-modes.js':'d51295a34cafd58c12f7f3e84b63edabc498294fe1238a335566633da28e7377'};
const PG_LAYERING_CI_COHORT={...PILOT_HOST_CI_COHORT,
 'existing-ops-stage-source.js':'b449348c6d3d4ef8919642a8f2f9e5f79f3dcffd66a77d1b21dd914a08803679',
 'existing-ops-stage-modes.js':'535a3a35f867b1dfc2e9a7ba43c6ea2c8ae258863672921f03b153c6788bff0f'};
const PERSISTENT_DRAIN_CLIENT_CI_COHORT={...PG_LAYERING_CI_COHORT,
 'existing-ops-stage-modes.js':'e435c80015bbac74f1377491844ce99dfaf5975fb7f42a995ca29e3c39d26790'};
const CANDIDATE_CACHE_CI_COHORT={...PERSISTENT_DRAIN_CLIENT_CI_COHORT,
 'existing-ops-stage-modes.js':'0eebbbc9be023b6bd8c78ef143ee5e7d179b4ae95970698e7d25228f7385ce70'};
const DEPLOY_RECOVERY_CI_COHORT={...CANDIDATE_CACHE_CI_COHORT,
 'existing-ops-stage-modes.js':'eefdcfa927daf19cba1574968215a8145421ac1877fa26d0a3372046683c25a0'};
const NATIVE_AGENT_CI_COHORT={...DEPLOY_RECOVERY_CI_COHORT,
 'existing-ops-stage-modes.js':'23f782c6f3083efa69d57dca9e9e1ba2243578cfaec4508205b11b2920464362'};
const NATIVE_COMPLETION_CI_COHORT={...NATIVE_AGENT_CI_COHORT,
 'existing-ops-stage-modes.js':'09a052f1fc2f32ffc2d89311b72f7164c38a0ed7eec8688671f0e0515135e36c'};
// 现役业务门禁只读控制新增独立组，历史Native Completion身份保留。
const CI_BUSINESS_GUARDS_COHORT={...NATIVE_COMPLETION_CI_COHORT,
 'existing-ops-stage-modes.js':'dec1e339af7590d8ea9a83cde160a896b31dd1c45e720e299d92379d3d2a42df',
 'existing-ops-ci-business-guards-profile.json':'9f99a1761cadeb0cff8fdf839ddf7db3e5f2e812c1d6c71560c7e98450faa96c'};
const currentMemberCount=Object.keys(CI_BUSINESS_GUARDS_COHORT).length;
export const ciVersionGuardCohorts=()=>[...COHORTS,COMMANDER_CI_COHORT,SKILL_RETIREMENT_CI_COHORT,PLANNER_RETIREMENT_CI_COHORT,COMMANDER_AUDIT_CI_COHORT,SCRIPT_CLEANUP_CI_COHORT,SCRIPT_CLEANUP_PROFILE_COHORT,RESOURCE_RETIREMENT_CI_COHORT,WORKFLOW_REGISTRATION_CI_COHORT,BUSINESS_SMOKE_RETIREMENT_CI_COHORT,FIXED_CHECKS_CI_COHORT,FOUNDATION_RELEASE_CI_COHORT,FOUNDATION_FIXED_CHECKS_CI_COHORT,CLOSEOUT_CI_COHORT,DORMANT_BOUNDARIES_CI_COHORT,CHECKER_REPAIR_CI_COHORT,BUILD_DEDUP_CI_COHORT,PREVIEW_RETIREMENT_CI_COHORT,MAIN_AUTO_DEPLOY_CI_COHORT,BIND_MOUNT_CI_COHORT,CANDIDATE_BUILDER_CI_COHORT,RUNTIME_IDEMPOTENCE_CI_COHORT,NIGHTLY_STATUS_CI_COHORT,PILOT_HOST_CI_COHORT,PG_LAYERING_CI_COHORT,PERSISTENT_DRAIN_CLIENT_CI_COHORT,CANDIDATE_CACHE_CI_COHORT,DEPLOY_RECOVERY_CI_COHORT,NATIVE_AGENT_CI_COHORT,NATIVE_COMPLETION_CI_COHORT,CI_BUSINESS_GUARDS_COHORT];
export function registerCiRetirementGuardTests({root,base,scan}){
 describe('当前来源完整闭包及执行防复活',()=>{
  it('业务门禁新闭包和e7f历史完整组独立认可，新增JSON与旧stage混配仍拒绝',()=>{
   const current=base(),previous=new Map(Object.keys(NATIVE_COMPLETION_CI_COHORT).map(name=>{const file=path.join(root,name);return [file,execFileSync('git',['--no-replace-objects','show','e7f68785cfd16a5f29943d0f92e62956dd950542:'+path.relative(path.resolve(root,'../../../..'),file)],{cwd:root,encoding:'utf8',maxBuffer:1024*1024})];}));
   for(const source of [current,previous])expect(scan(source)).toEqual([]);
   const stage=path.join(root,'existing-ops-stage-modes.js'),profile=path.join(root,'existing-ops-ci-business-guards-profile.json');
   const oldStage=new Map(current);oldStage.set(stage,previous.get(stage));expect(scan(oldStage).some(hit=>hit.rule==='E1')).toBe(true);
   const newStage=new Map(previous);newStage.set(stage,current.get(stage));expect(scan(newStage).some(hit=>hit.rule==='E1')).toBe(true);
   const newProfile=new Map(previous);newProfile.set(profile,current.get(profile));expect(scan(newProfile).some(hit=>hit.rule==='E1')).toBe(true);
  });
  it('Pilot双源收集器新旧完整只读组通过，双成员混配与执行拒绝',()=>{
   const current=base(),previous=new Map(Object.keys(NIGHTLY_STATUS_CI_COHORT).map(name=>{const file=path.join(root,name);return [file,execFileSync('git',['--no-replace-objects','show','0431a8d3242783f1d94221cb5471ac40dda7fbd6:'+path.relative(path.resolve(root,'../../../..'),file)],{cwd:root,encoding:'utf8',maxBuffer:1024*1024})];}));
   for(const source of [current,previous])expect(scan(source)).toEqual([]);
   for(const name of ['existing-ops-stage-source.js','existing-ops-stage-modes.js']){
    const file=path.join(root,name),mixed=new Map(current);mixed.set(file,previous.get(file));expect(scan(mixed).some(hit=>hit.rule==='E1')).toBe(true);
    const reverse=new Map(previous);reverse.set(file,current.get(file));expect(scan(reverse).some(hit=>hit.rule==='E1')).toBe(true);
    const executed=new Map(current);executed.set(file,executed.get(file)+'\neval(candidate);');expect(scan(executed).some(hit=>hit.rule==='E1')).toBe(true);
   }
  });
  it('Nightly活性与status新完整组保留13d Runtime，四成员混配与执行拒绝',()=>{
   const helper=path.join(root,'existing-ops-ci-build-dedup-source.js'),current=base();expect(current.get(helper)).toContain('NIGHTLY_STATUS_INPUTS');
   const previous=new Map(Object.keys(RUNTIME_IDEMPOTENCE_CI_COHORT).map(name=>{const file=path.join(root,name);return [file,execFileSync('git',['--no-replace-objects','show','13d576c6a6223ff305e4734b37d46600e02fe48b:'+path.relative(path.resolve(root,'../../../..'),file)],{cwd:root,encoding:'utf8',maxBuffer:1024*1024})];}));
   for(const source of [current,previous])expect(scan(source)).toEqual([]);
   for(const name of ['existing-ops-stage-source.js','existing-ops-stage-modes.js','existing-ops-ci-build-dedup-source.js','../../../../scripts/ci/implementation-snapshot.mjs']){
    const file=path.join(root,name),mixed=new Map(current);mixed.set(file,previous.get(file));expect(scan(mixed).some(hit=>hit.rule==='E1')).toBe(true);
    const reverse=new Map(previous);reverse.set(file,current.get(file));expect(scan(reverse).some(hit=>hit.rule==='E1')).toBe(true);
   }
   const executed=new Map(current);executed.set(helper,executed.get(helper)+'\neval(NIGHTLY_STATUS_INPUTS);');expect(scan(executed).some(hit=>hit.rule==='E1')).toBe(true);
  });

  it('Runtime幂等完整只读组保留e5旧Builder，混配与执行仍拒绝',()=>{
   const helper=path.join(root,'existing-ops-ci-build-dedup-source.js'),current=base();expect(current.get(helper)).toContain('RUNTIME_IDEMPOTENCE_INPUTS');
   const previous=new Map(Object.keys(CANDIDATE_BUILDER_CI_COHORT).map(name=>{const file=path.join(root,name);return [file,execFileSync('git',['--no-replace-objects','show','e5e8202bf0ee76d7826fdec5474dfe506a86f537:'+path.relative(path.resolve(root,'../../../..'),file)],{cwd:root,encoding:'utf8',maxBuffer:1024*1024})];}));
   for(const source of [current,previous])expect(scan(source)).toEqual([]);
   for(const name of ['existing-ops-stage-source.js','existing-ops-stage-modes.js','existing-ops-ci-build-dedup-source.js']){
    const file=path.join(root,name),mixed=new Map(current);mixed.set(file,previous.get(file));expect(scan(mixed).some(hit=>hit.rule==='E1')).toBe(true);
    const reverse=new Map(previous);reverse.set(file,current.get(file));expect(scan(reverse).some(hit=>hit.rule==='E1')).toBe(true);
   }
   const executed=new Map(current);executed.set(helper,executed.get(helper)+'\neval(RUNTIME_IDEMPOTENCE_INPUTS);');expect(scan(executed).some(hit=>hit.rule==='E1')).toBe(true);
  });

  it('Builder能力完整组保留f10 BIND历史，只读三成员混配及执行仍拒绝',()=>{
   const helper=path.join(root,'existing-ops-ci-build-dedup-source.js'),current=base();expect(current.get(helper)).toContain('CANDIDATE_BUILDER_INPUTS');
   const previous=new Map(Object.keys(BIND_MOUNT_CI_COHORT).map(name=>{const file=path.join(root,name);return [file,execFileSync('git',['--no-replace-objects','show','f10e1da6b32c03febe0ac6080715e56615af0175:'+path.relative(path.resolve(root,'../../../..'),file)],{cwd:root,encoding:'utf8',maxBuffer:1024*1024})];}));
   for(const source of [current,previous])expect(scan(source)).toEqual([]);
   for(const name of ['existing-ops-stage-source.js','existing-ops-stage-modes.js','existing-ops-ci-build-dedup-source.js']){
    const file=path.join(root,name),mixed=new Map(current);mixed.set(file,previous.get(file));expect(scan(mixed).some(hit=>hit.rule==='E1')).toBe(true);
    const reverse=new Map(previous);reverse.set(file,current.get(file));expect(scan(reverse).some(hit=>hit.rule==='E1')).toBe(true);
   }
   const executed=new Map(current);executed.set(helper,executed.get(helper)+'\neval(CANDIDATE_BUILDER_INPUTS);');expect(scan(executed).some(hit=>hit.rule==='E1')).toBe(true);
  });

  it('挂载修复与原85 MAIN完整只读组分别有效，三成员混配与执行拒绝',()=>{
   const helper=path.join(root,'existing-ops-ci-build-dedup-source.js'),current=base();expect(current.get(helper)).toContain('BIND_MOUNT_INPUTS');
   const previous=new Map(Object.keys(MAIN_AUTO_DEPLOY_CI_COHORT).map(name=>{const file=path.join(root,name);return [file,execFileSync('git',['--no-replace-objects','show','85f24b00af99063cf27919cdcf79675d6d33e6a3:'+path.relative(path.resolve(root,'../../../..'),file)],{cwd:root,encoding:'utf8',maxBuffer:1024*1024})];}));
   for(const source of [current,previous])expect(scan(source)).toEqual([]);
   for(const name of ['existing-ops-stage-source.js','existing-ops-stage-modes.js','existing-ops-ci-build-dedup-source.js']){
    const file=path.join(root,name),mixed=new Map(current);mixed.set(file,previous.get(file));expect(scan(mixed).some(hit=>hit.rule==='E1')).toBe(true);
    const reverse=new Map(previous);reverse.set(file,current.get(file));expect(scan(reverse).some(hit=>hit.rule==='E1')).toBe(true);
   }
   const executed=new Map(current);executed.set(helper,executed.get(helper)+'\neval(BIND_MOUNT_INPUTS);');expect(scan(executed).some(hit=>hit.rule==='E1')).toBe(true);
  });

  it('main自动发布完整只读组与原Preview清退组独立，旧新成员混配及执行拒绝',()=>{
   const helper=path.join(root,'existing-ops-ci-build-dedup-source.js'),current=base();
   expect(current.get(helper)).toContain('MAIN_AUTO_DEPLOY_INPUTS');
   const previous=new Map(Object.keys(PREVIEW_RETIREMENT_CI_COHORT).map(name=>{const file=path.join(root,name);return [file,execFileSync('git',['--no-replace-objects','show','5a70db6350f9372e01f7098d2abd49a05990bf64:'+path.relative(path.resolve(root,'../../../..'),file)],{cwd:root,encoding:'utf8',maxBuffer:1024*1024})];}));
   for(const sources of [current,previous])expect(scan(sources)).toEqual([]);
   for(const name of ['existing-ops-stage-source.js','existing-ops-stage-modes.js','existing-ops-ci-build-dedup-source.js']){
    const file=path.join(root,name),mixed=new Map(current);mixed.set(file,previous.get(file));expect(scan(mixed).some(hit=>hit.rule==='E1')).toBe(true);
    const reverse=new Map(previous);reverse.set(file,current.get(file));expect(scan(reverse).some(hit=>hit.rule==='E1')).toBe(true);
    const missing=new Map(current);missing.delete(file);expect(scan(missing).some(hit=>hit.rule==='E1')).toBe(true);
   }
   const changed=new Map(current);changed.set(helper,changed.get(helper)+'\neval(MAIN_AUTO_DEPLOY_INPUTS);');expect(scan(changed).some(hit=>hit.rule==='E1')).toBe(true);
  });

  it('Preview清退完整只读组与原共享构建组均有效，任一新旧成员混配和执行仍拒绝',()=>{
   const helper=path.join(root,'existing-ops-ci-build-dedup-source.js'),current=base();
   expect(current.get(helper)).toContain('PREVIEW_RETIREMENT_INPUTS');
   const previous=new Map(Object.keys(BUILD_DEDUP_CI_COHORT).map(name=>{const file=path.join(root,name);return [file,execFileSync('git',['--no-replace-objects','show','ff56a157a53bdcc6ff9a612b8d03ca6be741feef:'+path.relative(path.resolve(root,'../../../..'),file)],{cwd:root,encoding:'utf8',maxBuffer:1024*1024})];}));
   for(const sources of [current,previous])expect(scan(sources)).toEqual([]);
   for(const name of ['existing-ops-stage-source.js','existing-ops-stage-modes.js','existing-ops-ci-build-dedup-source.js']){
    const file=path.join(root,name),mixed=new Map(current);mixed.set(file,previous.get(file));expect(scan(mixed).some(hit=>hit.rule==='E1')).toBe(true);
    const reverse=new Map(previous);reverse.set(file,current.get(file));expect(scan(reverse).some(hit=>hit.rule==='E1')).toBe(true);
    const missing=new Map(current);missing.delete(file);expect(scan(missing).some(hit=>hit.rule==='E1')).toBe(true);
   }
   const changed=new Map(current);changed.set(helper,changed.get(helper)+'\neval(PREVIEW_RETIREMENT_INPUTS);');expect(scan(changed).some(hit=>hit.rule==='E1')).toBe(true);
  });

  it('共享构建现役完整只读闭包及原checker组保持兼容，依赖缺失或执行滥用仍拒绝',()=>{
   const helper=path.join(root,'existing-ops-ci-build-dedup-source.js'),current=base();
   current.set(helper,readFileSync(helper,'utf8'));
   const previous=new Map(Object.keys(CHECKER_REPAIR_CI_COHORT).map(name=>{const file=path.join(root,name);return [file,execFileSync('git',['--no-replace-objects','show','a4395e4685c15a12c4abdb7679f3b96492e1839f:'+path.relative(path.resolve(root,'../../../..'),file)],{cwd:root,encoding:'utf8',maxBuffer:1024*1024})];}));
   for(const source of [current,previous])for(const kind of ['build','stage','native-evidence'])expect(scan(source,path.join(root,'existing-ops-'+kind+'-envelopes.js'))).toEqual([]);
   for(const name of ['existing-ops-stage-source.js','existing-ops-stage-modes.js']){
    const file=path.join(root,name),mixed=new Map(current);mixed.set(file,previous.get(file));expect(scan(mixed).some(hit=>hit.rule==='E1')).toBe(true);
    const reverse=new Map(previous);reverse.set(file,current.get(file));expect(scan(reverse).some(hit=>hit.rule==='E1')).toBe(true);
   }
   const runtime=path.join(root,'native-consumer-runtime.js'),withRuntime=new Map(current);
   withRuntime.set(runtime,readFileSync(runtime,'utf8'));expect(scan(withRuntime)).toEqual([]);
   for(const suffix of ['\nexport const unknownFingerprint=true;','\neval(files);']){
    const changed=new Map(withRuntime);changed.set(runtime,changed.get(runtime)+suffix);expect(scan(changed).some(hit=>hit.rule==='E1')).toBe(true);
   }
   const missing=new Map(current);missing.delete(helper);expect(scan(missing).some(hit=>hit.rule==='E1')).toBe(true);
   for(const suffix of ['\nexport const unknownConsumer=true;','\neval(CI_BUILD_DEDUP_INPUTS);','\nspawn("claude",["-p"]);']){
    const changed=new Map(current);changed.set(helper,changed.get(helper)+suffix);expect(scan(changed).some(hit=>hit.rule==='E1')).toBe(true);
   }
   const external=new Map(current);external.set(path.join(root,'unknown-build-reader.js'),"import {CI_BUILD_DEDUP_INPUTS} from './existing-ops-ci-build-dedup-source.js'; eval(CI_BUILD_DEDUP_INPUTS);");
   expect(scan(external).some(hit=>hit.rule==='E1')).toBe(true);
  });

  it('Commander审计CI完整闭包只读通过，CI或测试选择摘要漂移仍拒绝',()=>{
   const current=base(),member=path.join(root,'existing-ops-stage-source.js');
   expect(current.size).toBe(currentMemberCount);expect(scan(current)).toEqual([]);
   for(const digest of ['014b5b54984ff322b0783c6070113199673efd53bb900ea9934d038de3cd5e5d','cf3307a3508e5feb473951fb645197d74a714c2c8decc44ec6bfe690982b17b5']){
    const changed=base(),source=changed.get(member);expect(source).toContain(digest);
    changed.set(member,source.replace(digest,'f'.repeat(64)));
    expect(scan(changed).some(hit=>hit.rule==='E1')).toBe(true);
   }
  });
  it('Workflow注册CI完整只读闭包通过，新CI摘要漂移拒绝',()=>{
   const current=base(),file=path.join(root,'existing-ops-stage-source.js'),digest='1ac9c420d1ff0a6a681d486dd117c7c935b0c55f0e14f4ba98e2e730be68204a';
   expect(scan(current)).toEqual([]);expect(current.get(file)).toContain(digest);
   current.set(file,current.get(file).replace(digest,'f'.repeat(64)));
   expect(scan(current).some(hit=>hit.rule==='E1')).toBe(true);
  });
  it('Commander CI登记只替换已审stage成员，未知登记不能继承只读资格',()=>{
   const member='existing-ops-stage-source.js';
   expect(Object.keys(COMMANDER_CI_COHORT)).toEqual(Object.keys(COHORTS[4]));
   expect(Object.keys(COMMANDER_CI_COHORT).filter(name=>COMMANDER_CI_COHORT[name]!==COHORTS[4][name])).toEqual([member]);
   const current=base(),file=path.join(root,member);expect(scan(current)).toEqual([]);
   const original=current.get(file),changed=original.replace('d20caae43b3156bde1b07d141c3bd54b888da847e9c78e3b21e1440fd848e59a','f'.repeat(64));
   expect(changed).not.toBe(original);current.set(file,changed);
   expect(scan(current).some(hit=>hit.rule==='E1')).toBe(true);
  });
  it('当前main与候选完整组只取得只读数据资格',()=>{
   const previous=new Map([...base().keys(),path.join(root,'existing-ops-us-compose-source.js')].filter(file=>!file.endsWith('.json')&&!file.endsWith('/existing-ops-ci-build-dedup-source.js')).map(file=>[file,execFileSync('git',['--no-replace-objects','show','d06de84e9f7d2d489a151e0b13b38f81651dd3fa:'+path.relative(path.resolve(root,'../../../..'),file)],{cwd:root,encoding:'utf8',maxBuffer:1024*1024})]));
   for(const sources of [previous,base()])for(const kind of ['build','stage','native-evidence'])expect(scan(sources,path.join(root,'existing-ops-'+kind+'-envelopes.js'))).toEqual([]);
  });
  it.each([...Array(currentMemberCount).keys()].flatMap(index=>['missing','drift'].map(kind=>[index,kind])))('当前完整成员第%s项%s拒绝',(index,kind)=>{
   const current=base();expect(current.size).toBe(currentMemberCount);const file=[...current.keys()][index];
   if(kind==='missing')current.delete(file);else current.set(file,current.get(file)+(file.endsWith('.json')?'\n':'\nexport const unknownMember=true;\n'));
   const target=path.join(root,'existing-ops-'+(file.endsWith('stage-envelopes.js')?'build':'stage')+'-envelopes.js');
   expect(scan(current,target).some(hit=>hit.rule==='E1')).toBe(true);
  });
  it.each(['source','runtime-source','stage-source','workspace-source'])('旧历史单成员不能混入当前闭包：%s',name=>{
   const current=base(),file=path.join(root,'existing-ops-'+name+'.js');
   current.set(file,execFileSync('git',['--no-replace-objects','show','88be2549bed2a8d8a3b5a6324bf5ea6267dda0da:packages/brain/src/lib/'+path.basename(file)],{cwd:root,encoding:'utf8',maxBuffer:1024*1024}));
   expect(scan(current).some(hit=>hit.rule==='E1')).toBe(true);
  });
  it('旧script-cleanup完整Git封组仍通过，新旧stage或profile混配拒绝',()=>{
   const current=base(),stage=path.join(root,'existing-ops-stage-source.js'),profile=path.join(root,'existing-ops-resource-retirement-profile.json');
   const previous=new Map(Object.keys(SCRIPT_CLEANUP_PROFILE_COHORT).map(name=>{const file=path.join(root,name);return [file,execFileSync('git',['--no-replace-objects','show','91d37b2c3aab471aeaf88df25eec6dda9cb306d3:'+path.relative(path.resolve(root,'../../../..'),file)],{cwd:root,encoding:'utf8',maxBuffer:1024*1024})];}));
   expect(scan(previous)).toEqual([]);
   const mixed=base();mixed.set(stage,previous.get(stage));expect(scan(mixed).some(hit=>hit.rule==='E1')).toBe(true);
   const missing=base();missing.delete(profile);expect(scan(missing).some(hit=>hit.rule==='E1')).toBe(true);
  });
  it('checker返工与旧closeout完整封组各自通过，新旧源码混配拒绝',()=>{
   const previous=new Map(Object.keys(CLOSEOUT_CI_COHORT).map(name=>{const file=path.join(root,name);return [file,execFileSync('git',['--no-replace-objects','show','3e827180e50e5c73e999ca744a2689488f75814b:'+path.relative(path.resolve(root,'../../../..'),file)],{cwd:root,encoding:'utf8',maxBuffer:1024*1024})];}));
   expect(scan(previous)).toEqual([]);expect(scan(base())).toEqual([]);
   for(const name of ['existing-ops-stage-source.js','existing-ops-stage-modes.js']){
    const file=path.join(root,name),mixed=base();mixed.set(file,previous.get(file));expect(scan(mixed).some(hit=>hit.rule==='E1')).toBe(true);
    const reverse=new Map(previous);reverse.set(file,base().get(file));expect(scan(reverse).some(hit=>hit.rule==='E1')).toBe(true);
   }
  });
  it('主分支dormant完整封组保留，不能与repair当前组混配',()=>{
   const previous=new Map(Object.keys(DORMANT_BOUNDARIES_CI_COHORT).map(name=>{const file=path.join(root,name);return [file,execFileSync('git',['--no-replace-objects','show','2aa96ff033440d2e70816a05151aa135e792cb4f:'+path.relative(path.resolve(root,'../../../..'),file)],{cwd:root,encoding:'utf8',maxBuffer:1024*1024})];}));
   expect(scan(previous)).toEqual([]);
   for(const name of ['existing-ops-stage-source.js','existing-ops-stage-modes.js']){const file=path.join(root,name),mixed=base();mixed.set(file,previous.get(file));expect(scan(mixed).some(hit=>hit.rule==='E1')).toBe(true);}
  });
  it.each(CI_READER_PROFILES)('只读profile精确字节篡改、缺失与非JSON内容拒绝：%s',name=>{
   const file=path.join(root,name),original=base().get(file);
   for(const text of [original+'\n',JSON.stringify({...JSON.parse(original),unknown:'f'.repeat(64)}),'{}',original+'\nspawn("claude",["-p"]);']){
    const changed=base();changed.set(file,text);expect(scan(changed).some(hit=>hit.rule==='E1')).toBe(true);
   }
   const missing=base();missing.delete(file);expect(scan(missing).some(hit=>hit.rule==='E1')).toBe(true);
  });
  it('未知外部caller不能取得只读资格',()=>{
   const current=base();current.set(path.join(root,'unknown-reader.js'),"import {ENVELOPES} from './existing-ops-build-envelopes.js';eval(ENVELOPES.spawnParameters);");
   expect(scan(current).some(hit=>hit.rule==='E1')).toBe(true);
  });
 });
}
