/** 仅已知完整历史组与经独审的现役源码整组取得只读数据资格。 */
import {describe,it,expect} from 'vitest';
import path from 'node:path';
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
export const ciVersionGuardCohorts=()=>[...COHORTS,COMMANDER_CI_COHORT];
export function registerCiRetirementGuardTests({root,base,scan}){
 describe('当前来源完整闭包及执行防复活',()=>{
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
   const previous=new Map([...base().keys()].map(file=>[file,execFileSync('git',['--no-replace-objects','show','d06de84e9f7d2d489a151e0b13b38f81651dd3fa:'+path.relative(path.resolve(root,'../../../..'),file)],{cwd:root,encoding:'utf8',maxBuffer:1024*1024})]));
   for(const sources of [previous,base()])for(const kind of ['build','stage','native-evidence'])expect(scan(sources,path.join(root,'existing-ops-'+kind+'-envelopes.js'))).toEqual([]);
  });
  it.each([...Array(16).keys()].flatMap(index=>['missing','drift'].map(kind=>[index,kind])))('当前16成员第%s项%s拒绝',(index,kind)=>{
   const current=base();expect(current.size).toBe(16);const file=[...current.keys()][index];
   if(kind==='missing')current.delete(file);else current.set(file,current.get(file)+'\nexport const unknownMember=true;\n');
   const target=path.join(root,'existing-ops-'+(file.endsWith('stage-envelopes.js')?'build':'stage')+'-envelopes.js');
   expect(scan(current,target).some(hit=>hit.rule==='E1')).toBe(true);
  });
  it.each(['source','runtime-source','stage-source','workspace-source'])('旧历史单成员不能混入当前闭包：%s',name=>{
   const current=base(),file=path.join(root,'existing-ops-'+name+'.js');
   current.set(file,execFileSync('git',['--no-replace-objects','show','88be2549bed2a8d8a3b5a6324bf5ea6267dda0da:packages/brain/src/lib/'+path.basename(file)],{cwd:root,encoding:'utf8',maxBuffer:1024*1024}));
   expect(scan(current).some(hit=>hit.rule==='E1')).toBe(true);
  });
  it('未知外部caller不能取得只读资格',()=>{
   const current=base();current.set(path.join(root,'unknown-reader.js'),"import {ENVELOPES} from './existing-ops-build-envelopes.js';eval(ENVELOPES.spawnParameters);");
   expect(scan(current).some(hit=>hit.rule==='E1')).toBe(true);
  });
 });
}
