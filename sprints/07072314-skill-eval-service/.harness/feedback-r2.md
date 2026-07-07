# GAN 第 2 轮 Reviewer Feedback（7.5/10，REVISION）

## P0 必须修复
1. fr-upload-flow.test.js L81: makeZipWithoutSkillMd → makeZipWithNoSkillMd（函数名不匹配，运行时崩溃 TypeError）
2. invariant-04-hard-validation.test.js: 补加压缩比 > 100:1 → HTTP 400 测试 case（import makeHighCompressionRatioZip），标题改"六件套"

## P1 建议
3. invariant-02-backpressure.test.js L68/78: before/after 列名（SQL 保留字）改为 cnt_before/cnt_after，防止 pg 版本兼容导致断言假绿
