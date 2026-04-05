# Learning: copy-review 重试达上限导致 pipeline 终止

**分支**: cp-04050557-bc706110-ae4a-463a-9f70-5ad7c9  
**日期**: 2026-04-05  
**类型**: P0 修复

---

### 根本原因

`_executeLLMPath` 函数用 `|| text` fallback 接受任意 LLM 输出作为文案：

```js
// 旧代码 — 问题所在
const socialCopy = socialMatch?.[1]?.trim() || text;  // LLM 输出澄清问题时 text = "选项A: ..."
const articleCopy = articleMatch?.[1]?.trim() || text;
```

当调研素材不足时，LLM 生成澄清性"选项A/B"问题，而非按 `=== 社交媒体文案 ===` 格式输出实际内容。这段内容被写入文件后，copy-review 正确识别为"不是真正文案"并拒绝，触发无效重试循环直至达到上限（3次）终止 pipeline。

**触发条件**：
- 内容主题缺乏具体案例数据（如"行业跟进能力"类能力型话题）
- typeConfig 有 `generate_prompt` → 触发 LLM 路径
- LLM 倾向于请求更多信息而非强行生成

---

### 修复方案

1. **Prompt 层防线**：在 `_buildCopywritingPrompt` 末尾添加强制指令——禁止 LLM 输出澄清问题，要求用"据公开资料""行业通常"等词汇补充不确定内容

2. **输出校验层防线**：在 `_executeLLMPath` 中校验 LLM 输出的格式和最小长度；不达标时返回 `null` 触发静态模板 fallback（而非接受垃圾内容）

```js
// 新代码 — 格式校验
const socialCopy = socialMatch?.[1]?.trim();
const articleCopy = articleMatch?.[1]?.trim();
if (!socialCopy || socialCopy.length < 200 || !articleCopy || articleCopy.length < 500) {
  console.warn('[copywriting] LLM 输出不符格式要求，降级到静态模板');
  return null;
}
```

---

### 下次预防

- [ ] LLM 路径的输出必须做格式 + 最小长度双重校验，不允许 `|| raw_text` 型 fallback
- [ ] Prompt 指令需显式包含"数据不足时的处理方式"，防止 LLM 进入"请求澄清"模式
- [ ] 新增 executor 函数时，参考 `_executeLLMPath` 的校验模式
