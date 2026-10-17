// 冻结Git原件字节合同：该模块是完整AST对照数据，不执行数据中的任何源码。
import {createHash} from 'node:crypto';
import {parse} from 'acorn';
import {describe,it,expect} from 'vitest';
import {NATIVE_EVIDENCE_ENVELOPES as reviewed} from '../existing-ops-native-evidence-envelopes.js';

// 独立期望来自7da3d486及fd845665的Git原件，不在测试时从被测常量计算。
const expected = {
  "support.test": "92dc8a61c7b10d90b7ec20ec927582372664b4e75a3316fe384a2e3029470593",
  "support.helper": "d8128c8217cd98d4fc4ce320a36cea6c29ac8cf650174fa71b52aa374c9dbf64",
  "support.activity": "164f666ec75345a0dd43d920773d357970d4d0dcd0e8e52c902c007badeb1900",
  "support.cli": "496b778c63eb3028e6e2bcb1bd8025076351974336163fd91378de2774fce505",
  "support.protocol": "998e2ae6491458db1e898f9ac1006b9670f36f28297dc3f2a5056a5fbfc1a71c",
  "support.activityProvenance": "d201d064827739213a62c6dd982cabfc60a93582460e9652d714a170395d3e10",
  "support.recordProvenance": "a73569201e143cd237751262d7e2ec1167f3e10928db200e5f36df0161f2cece",
  "support.recordStore": "760ce6cbf47e6f08af57d111addf409904c547f9f30841b85ebea6f19cd61852",
  "support.recordRecords": "dbc4a039d0c80e0a0294fa72c044915ce1fbe10146bae5a2a89c7711b98b48c1",
  "support.provenancePath": "f69582f1b0995e3de2b45a5bd243f1814e5005d32e78e7f71bd904222386a6d6",
  "support.qaIsolation": "be421ad8261b7e21bb5b343bfc642daf660f352785c9a319e706193b4940b3c7",
  "support.sourceProvenance": "14362dd387277aa336b2654e2a2b95037757358caaec814e2a3837d08a3b2f7e",
  "support.sourceMergeProof": "6d275f8bc9f16634d922d81e8b0521b318e60ea9616372ec9ff8b5d5cd2245e6",
  "support.recordInputs": "c39e2f3f1fda4d6d83ec4846bf3d0236178031bfdb23247a634aaca598623af4",
  "support.recordQa": "29e3bb4180f435ca2211b0b7c0a42f55735370159ec752f213add93f2209a1d8",
  "support.nativeEvidence": "522339a9bc3f97e82177004efdf04cfb057d77d6941f1518067eb38c1fe17534",
  "support.qaReport": "73dbc417e01a9e0b1a6b819f2d960fd252dc11e8b82e90282efdebd2f7ae9960",
  "support.evidence": "3d55ace3a1956174b58a4886b0d6df4c4d6d6ff122afd003bacebbf8e85c8bb3",
  "support.transcript": "ac3f722aba83a66d8d785b747412101f9a45b5e9e76251138195ba67140f80af",
  "entries.intent": "f08bfef9a2abfcecf32bce283e8e0a2dceb9b4b865f524a08207cad292f213ac",
  "entries.spec": "9a0f4fe05d2d15da09ea2eeca969efcb01a9437234b9836df9dc54600e4667fa",
  "entries.spec-review": "b3a4bbc3b55c88fd91ba9a2d0c927006f237ea84a4d6c6ed9ee5ae0cbab88452",
  "entries.verify": "9342cfb897dc578b95d73f143aeb2c0febde5e1e78c019f5a60e911e2dcd0976",
  "entries.evaluate": "5b3767f964a9ab91f24051abd01fe29ff1582449964a1886fde6d607a9a7c6b2",
  "tests.intent": "fdce0c556732a1a63ab2af9ca379d04013b4b68667ef573dc31f4234ef013078",
  "tests.spec": "cb65e2df9f694a54ecef4fd586f9ca97be22a06eb2d7bd341116407b8b03a40d",
  "tests.spec-review": "21ed0cc2ca32187b7240ccd74804ad2fe6e94a2e6a658135bb498a455529fdf7",
  "tests.verify": "c48aa56f29e9275176fc212a1ed6a1e5114dad5d66476d55ee85139e2336b589",
  "tests.evaluate": "29a33f35b08eb5f9308edc4d03b8b70f3f6ba7462da44728b01020064a9c463d",
  "legacyCli": "ea21b864d51ba7e70eb7e104e59a8decd84cdf846000f6337b4e76bef3c7a7dd"
};
const texts = () => Object.fromEntries(Object.entries(expected).map(([name]) => [name, name.split('.').reduce((value,key) => value[key],reviewed)]));

describe('native evidence已审完整源码封套数据', () => {
  it('只导出已审版本的完整support、entries、tests和legacy CLI，不增删隐式封套', () => {
    expect(Object.keys(reviewed).sort()).toEqual(['entries','legacyCli','revision','support','tests']);
    expect(reviewed.revision).toBe('7da3d486c7385fe7baea72903cbb9c56ceedcd4f');
    const actual = Object.entries(reviewed).flatMap(([key,value]) => key === 'revision' ? [] : typeof value === 'string' ? [key] : Object.keys(value).map(name => key + '.' + name));
    expect(actual.sort()).toEqual(Object.keys(expected).sort());
    expect(actual).toHaveLength(30);
  });
  it.each(Object.keys(expected))('%s逐字节匹配独立冻结Git原件', name => {
    const text = texts()[name];
    expect(typeof text).toBe('string');
    expect(createHash('sha256').update(text).digest('hex')).toBe(expected[name]);
  });
  it('所有对照值均能完整静态解析成模块程序，不依赖执行候选源码', () => {
    for(const [name,text] of Object.entries(texts())) {
      const ast = parse(text,{ecmaVersion:'latest',sourceType:'module'});
      expect(ast.type,name).toBe('Program');
      expect(ast.body.length,name).toBeGreaterThan(0);
    }
  });
});
