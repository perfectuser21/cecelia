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
export const CI_READER_PROFILES=['existing-ops-script-cleanup-profile.json','existing-ops-resource-retirement-profile.json','existing-ops-business-smoke-retirement-profile.json','existing-ops-fixed-checks-profile.json','existing-ops-foundation-release-profile.json','existing-ops-closeout-profile.json','existing-ops-checker-repair-profile.json','existing-ops-dormant-boundaries-profile.json'];
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
const currentMemberCount=Object.keys(CHECKER_REPAIR_CI_COHORT).length;
export const ciVersionGuardCohorts=()=>[...COHORTS,COMMANDER_CI_COHORT,SKILL_RETIREMENT_CI_COHORT,PLANNER_RETIREMENT_CI_COHORT,COMMANDER_AUDIT_CI_COHORT,SCRIPT_CLEANUP_CI_COHORT,SCRIPT_CLEANUP_PROFILE_COHORT,RESOURCE_RETIREMENT_CI_COHORT,WORKFLOW_REGISTRATION_CI_COHORT,BUSINESS_SMOKE_RETIREMENT_CI_COHORT,FIXED_CHECKS_CI_COHORT,FOUNDATION_RELEASE_CI_COHORT,FOUNDATION_FIXED_CHECKS_CI_COHORT,CLOSEOUT_CI_COHORT,DORMANT_BOUNDARIES_CI_COHORT,CHECKER_REPAIR_CI_COHORT];
export function registerCiRetirementGuardTests({root,base,scan}){
 describe('当前来源完整闭包及执行防复活',()=>{
  it('共享构建现役完整只读闭包及原checker组保持兼容，依赖缺失或执行滥用仍拒绝',()=>{
   const helper=path.join(root,'existing-ops-ci-build-dedup-source.js'),current=base();
   current.set(helper,readFileSync(helper,'utf8'));
   const previous=new Map(Object.keys(CHECKER_REPAIR_CI_COHORT).map(name=>{const file=path.join(root,name);return [file,execFileSync('git',['--no-replace-objects','show','a4395e4685c15a12c4abdb7679f3b96492e1839f:'+path.relative(path.resolve(root,'../../../..'),file)],{cwd:root,encoding:'utf8',maxBuffer:1024*1024})];}));
   for(const source of [current,previous])for(const kind of ['build','stage','native-evidence'])expect(scan(source,path.join(root,'existing-ops-'+kind+'-envelopes.js'))).toEqual([]);
   for(const name of ['existing-ops-stage-source.js','existing-ops-stage-modes.js']){
    const file=path.join(root,name),mixed=new Map(current);mixed.set(file,previous.get(file));expect(scan(mixed).some(hit=>hit.rule==='E1')).toBe(true);
    const reverse=new Map(previous);reverse.set(file,current.get(file));expect(scan(reverse).some(hit=>hit.rule==='E1')).toBe(true);
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
   const previous=new Map([...base().keys()].filter(file=>!file.endsWith('.json')).map(file=>[file,execFileSync('git',['--no-replace-objects','show','d06de84e9f7d2d489a151e0b13b38f81651dd3fa:'+path.relative(path.resolve(root,'../../../..'),file)],{cwd:root,encoding:'utf8',maxBuffer:1024*1024})]));
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
   const previous=new Map([...current.keys()].filter(file=>file!==profile&&!file.endsWith('/existing-ops-business-smoke-retirement-profile.json')&&!file.endsWith('/existing-ops-fixed-checks-profile.json')&&!file.endsWith('/existing-ops-foundation-release-profile.json')&&!file.endsWith('/existing-ops-closeout-profile.json')&&!file.endsWith('/existing-ops-checker-repair-profile.json')&&!file.endsWith('/existing-ops-dormant-boundaries-profile.json')).map(file=>[file,execFileSync('git',['--no-replace-objects','show','91d37b2c3aab471aeaf88df25eec6dda9cb306d3:'+path.relative(path.resolve(root,'../../../..'),file)],{cwd:root,encoding:'utf8',maxBuffer:1024*1024})]));
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
