# Task Card: fix(brain): 修复 copywriting 素材截断导致 copy-review 死循环

## 问题
`_buildCopywritingPrompt` 将每条 research finding 截断到 **200 字符**。
NotebookLM 实际产出内容约 3028 字符，截断发生在句子中间（如 `"以下为您深度拆解五个以"极致的行业跟"`），
LLM 收到不完整素材后拒绝生成内容，回复"请提供完整素材"。

copy-review 检查到内容质量极低（quality_score < 6），返回 `review_passed: false`，
pipeline 重试 3 次后触发 `MAX_REVIEW_RETRY` 终止。

## 根因
`packages/brain/src/content-pipeline-executors.js` L223:
```js
const findingsSummary = top.map((f, i) => `${i + 1}. ${f.title}: ${(f.content || '').substring(0, 200)}`).join('\n');
```
200 字符 < 大多数 finding 内容长度，造成截断。

## 修复
将截断限制从 200 提升到 **1500** 字符：
- finding 通常 7 条以内，每条 1500 字符 ≈ 10500 字符 ≈ ~3500 tokens，在 4096 maxTokens 内安全
- 足够传递完整的 case 内容，LLM 可正常生成内容

## 文件
- `packages/brain/src/content-pipeline-executors.js` L223

## DoD
- [x] L223 截断从 200 → 1500
- [x] 修改后 `_buildCopywritingPrompt` 能正确传递 finding 完整摘要
- [x] 单元测试验证内容不被截断
