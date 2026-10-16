import * as isolationModule from '../existing-ops-stage-envelopes.js';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {describe,it,expect} from 'vitest';
import {parse} from 'acorn';
import {STAGE_ENVELOPES} from '../existing-ops-stage-envelopes.js';
import {stageSourceVersion} from '../existing-ops-stage-source.js';
// 独立固定Git原字节，旧1d811、新020d；候选源码只作数据。
const EXPECTED_SHA256={
  "legacy": {
    "intent": "bfa64347abfe164b7a4b79748a459471ecd072743a8eb75d46decc09384963d5",
    "spec": "864f3007da1452f2a81aa1fd7fb3251762aef6da15e23212e21e30695b7f95d1",
    "spec-review": "1155612a69df2fb34a0388d0d50cabc6682dfdf270079d46660daf95e2591c1e",
    "verify": "bec31f017428e2976fa4ed3afc3a11db156bcc61d6b5c6660ab4f88a1770d39f",
    "evaluate": "3058b93533022fb8828cf6276f9efb2a1fe7d1a598b6502009c88ebfad6e07e0"
  },
  "recorded": {
    "intent": "f08bfef9a2abfcecf32bce283e8e0a2dceb9b4b865f524a08207cad292f213ac",
    "spec": "9a0f4fe05d2d15da09ea2eeca969efcb01a9437234b9836df9dc54600e4667fa",
    "spec-review": "b3a4bbc3b55c88fd91ba9a2d0c927006f237ea84a4d6c6ed9ee5ae0cbab88452",
    "verify": "9342cfb897dc578b95d73f143aeb2c0febde5e1e78c019f5a60e911e2dcd0976",
    "evaluate": "4f446c4888ff5567bd12a2e80c472b1d85bdce19617e207336efa049614c83af"
  },
  "tests": {
    "intent": "fdce0c556732a1a63ab2af9ca379d04013b4b68667ef573dc31f4234ef013078",
    "spec": "cb65e2df9f694a54ecef4fd586f9ca97be22a06eb2d7bd341116407b8b03a40d",
    "spec-review": "21ed0cc2ca32187b7240ccd74804ad2fe6e94a2e6a658135bb498a455529fdf7",
    "verify": "c48aa56f29e9275176fc212a1ed6a1e5114dad5d66476d55ee85139e2336b589",
    "evaluate": "847aae6578af36d8443e17d1ed477b8c8acef18f799fa590d9756a4e9e43e88a"
  },
  "mode": {
    "lib/repo-profile.mjs": "2f3a9ba03c136db0322693e75401bab1cc924977080691ef740447a4e65a1960",
    "runner/lib/repos.mjs": "6a30662a1cc1d852ddba041aac2d01809f73d5ced269a50b69f570260b31aa27",
    "repos.json": "2d1b952124b9283373c81f5120e0d8d9561460736c6cbd653dea967adea38331"
  }
};
const fixed=checkedFixture(STAGE_ENVELOPES);
const ast=text=>parse(text,{ecmaVersion:'latest',sourceType:'module'});
describe('已审阶段封套原始合同',()=>{
 it('全部18原始源码字段先核独立固定Git字节身份，再用于行为证明',()=>expect(checkedFixture(STAGE_ENVELOPES)).toEqual(fixed));
 for(const version of ['legacy','recorded']){
  it(`${version}准确AST能被实际版本证明接受`,()=>expect(stageSourceVersion(fixed[version],ast)).toBe(version));
  for(const stage of Object.keys(fixed[version]))it(`${version}/${stage}缺失或新增退出均不再是该已审合同`,()=>{
   const missing={...fixed[version]};delete missing[stage];expect(stageSourceVersion(missing,ast)).toBeNull();
   const changed={...fixed[version],[stage]:fixed[version][stage]+'\nthrow Error("unreviewed");'};expect(stageSourceVersion(changed,ast)).toBeNull();
  });
 }
});

// 独立固定Git原始字符串身份，不从运行时生产数据生成expected。

function checkedFixture(value){
 assert.deepEqual(Object.keys(value).sort(),Object.keys(EXPECTED_SHA256).sort());
 for(const [group,items] of Object.entries(EXPECTED_SHA256)){
  assert.deepEqual(Object.keys(value[group]).sort(),Object.keys(items).sort());
  for(const [name,digest] of Object.entries(items)){
   assert.equal(typeof value[group][name],'string');
   assert.equal(createHash('sha256').update(value[group][name]).digest('hex'),digest,group+'/'+name);
  }
 }
 return structuredClone(value);
}
describe('紧凑夹具必须先核全字段原字节身份',()=>{
 for(const [group,items] of Object.entries(EXPECTED_SHA256))for(const name of Object.keys(items))it(group+'/'+name+' 任一字节改变都拒绝',()=>{const value=structuredClone(STAGE_ENVELOPES);value[group][name]+='\n';expect(()=>checkedFixture(value)).toThrow();});
 for(const change of [v=>{delete v.legacy.intent;},v=>{v.legacy.extra='x';},v=>{delete v.tests;},v=>{v.extra={};},v=>{v.legacy.intent=7;}])it('缺字段/额外键/非字符串均拒绝',()=>{const value=structuredClone(STAGE_ENVELOPES);change(value);expect(()=>checkedFixture(value)).toThrow();});
});

// 已独审 ad15a43a5e886ce30ba05b4dc640f340dcbb6af5 原始源码；字节合同独立于被测导出。
const ISOLATION_EXPECTED={"evaluate":"5241c7998e7be2c5bf24d883c0863d1a9077c4f59db099e4ae7e4896a3a87597"};
it('isolation新封套全部字段精确冻结且旧导出不被覆盖',()=>{
 const value=isolationModule.ISOLATION_STAGE_ENVELOPES;
 expect(Object.keys(value??{}).sort()).toEqual(Object.keys(ISOLATION_EXPECTED).sort());
 for(const [key,digest] of Object.entries(ISOLATION_EXPECTED)){expect(typeof value[key]).toBe('string');expect(createHash('sha256').update(value[key]).digest('hex')).toBe(digest);}
});
