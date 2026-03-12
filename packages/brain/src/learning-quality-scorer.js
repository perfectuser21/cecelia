/**
 * Learning Quality Scorer
 *
 * 基于内容特征对 Learning 进行质量评分。
 * 纯函数模块，无 IO 操作，可在 learning 写入时同步调用。
 *
 * 评分规则（从 100 分起扣）：
 *   - 内容长度 < 20 字：-60
 *   - 内容长度 20-49 字：-20
 *   - 含空壳词（test/ok/pass/done/completed 等）：-30
 *   - 无根因标记（根因/root_cause/because/导致 等）：-20
 *   - 无改进点标记（改进/修复/solution/建议 等）：-15
 *   - 含模板套话（TODO/placeholder/示例 等）：-15
 *
 * source_type 分类：
 *   - empty_shell: score < 40
 *   - minimal:     score 40-59
 *   - standard:    score 60-79
 *   - rich:        score >= 80
 */

// 空壳词：单独出现在短文本中代表无实质内容
const SHELL_WORDS_PATTERN = /\b(test|ok|pass|done|completed|success|succeed|passed|works|fixed|lgtm)\b/gi;

// 根因标记：说明了"为什么"
const ROOT_CAUSE_PATTERN = /(根因|root.?cause|根本原因|原因是|why |because|导致|caused.?by|由于|来自于|trigger)/i;

// 改进点标记：说明了"怎么改"
const IMPROVEMENT_PATTERN = /(改进|优化|修复|solution|fix |解决方案|建议|recommendation|should |需要|must |下次|action|措施)/i;

// 模板套话：纯格式占位符
const TEMPLATE_PATTERN = /(TODO|FIXME|placeholder|模板|template|示例|example here|xxx|待填写)/i;

/**
 * 对 learning 内容进行质量评分
 *
 * @param {string} content - learning 的 content 字段（或 title+content 拼接）
 * @returns {{ score: number, source_type: string }}
 *   score: 0-100，整数
 *   source_type: 'empty_shell' | 'minimal' | 'standard' | 'rich'
 */
export function scoreLearning(content) {
  if (!content || typeof content !== 'string') {
    return { score: 0, source_type: 'empty_shell' };
  }

  const text = content.trim();
  let score = 100;

  // 规则 1：内容长度
  if (text.length < 20) {
    score -= 60;
  } else if (text.length < 50) {
    score -= 20;
  }

  // 规则 2：含空壳词（仅在短文本中有杀伤力，长文本可能只是提及）
  const shellMatches = (text.match(SHELL_WORDS_PATTERN) || []).length;
  if (shellMatches > 0 && text.length < 120) {
    score -= 30;
  }

  // 规则 3：无根因标记
  if (!ROOT_CAUSE_PATTERN.test(text)) {
    score -= 20;
  }

  // 规则 4：无改进点标记
  if (!IMPROVEMENT_PATTERN.test(text)) {
    score -= 15;
  }

  // 规则 5：含模板套话
  if (TEMPLATE_PATTERN.test(text)) {
    score -= 15;
  }

  const finalScore = Math.max(0, Math.min(100, score));

  let source_type;
  if (finalScore < 40) {
    source_type = 'empty_shell';
  } else if (finalScore < 60) {
    source_type = 'minimal';
  } else if (finalScore < 80) {
    source_type = 'standard';
  } else {
    source_type = 'rich';
  }

  return { score: finalScore, source_type };
}
