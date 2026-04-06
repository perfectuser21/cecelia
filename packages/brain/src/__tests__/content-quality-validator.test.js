import { describe, it, expect } from 'vitest';
import {
  countWords,
  checkKeywords,
  checkToneViolations,
  validateContentQuality,
  validateAllVariants,
} from '../content-quality-validator.js';

describe('countWords', () => {
  it('统计纯中文字符数', () => {
    expect(countWords('一人公司真的很棒')).toBe(8);
  });

  it('统计中英混合', () => {
    // 3中文 + 2英文词
    expect(countWords('使用 AI 工具')).toBe(5);
  });

  it('空字符串返回 0', () => {
    expect(countWords('')).toBe(0);
    expect(countWords(null)).toBe(0);
  });
});

describe('checkKeywords', () => {
  it('命中所有关键词', () => {
    const { found, missing } = checkKeywords('这是AI一人公司的内容', ['AI', '一人公司']);
    expect(found).toContain('AI');
    expect(found).toContain('一人公司');
    expect(missing).toHaveLength(0);
  });

  it('缺失关键词时放入 missing', () => {
    const { found, missing } = checkKeywords('这是普通内容', ['AI', '一人公司']);
    expect(found).toHaveLength(0);
    expect(missing).toContain('AI');
    expect(missing).toContain('一人公司');
  });

  it('大小写不敏感', () => {
    const { found } = checkKeywords('使用 ai 工具提效', ['AI']);
    expect(found).toContain('AI');
  });
});

describe('checkToneViolations', () => {
  it('检测到过于正式的表述', () => {
    const violations = checkToneViolations('您好，尊敬的用户，感谢您的支持。');
    expect(violations).toContain('您好');
    expect(violations).toContain('尊敬的');
  });

  it('正常口语化内容无违规', () => {
    const violations = checkToneViolations('我用了30天AI一人公司工具，真的省了好多时间！');
    expect(violations).toHaveLength(0);
  });
});

describe('validateContentQuality', () => {
  const typeConfig = {
    copy_rules: {
      keywords_required: ['AI', '一人公司'],
      min_word_count: { short_copy: 100, long_form: 500 },
    },
  };

  it('字数不足时返回 blocking issue', () => {
    const shortContent = 'AI一人公司'; // 远少于100字
    const { passed, issues } = validateContentQuality(shortContent, typeConfig, 'short_copy');
    expect(passed).toBe(false);
    expect(issues.some((i) => i.rule === 'min_word_count' && i.severity === 'blocking')).toBe(true);
  });

  it('关键词缺失时返回 blocking issue', () => {
    // 足够字数但没有关键词
    const noKeywordContent = '这是一篇关于效率提升的内容，帮助创业者节省时间提高工作效率。'.repeat(5);
    const { passed, issues } = validateContentQuality(noKeywordContent, typeConfig, 'short_copy');
    expect(passed).toBe(false);
    expect(issues.some((i) => i.rule === 'required_keywords')).toBe(true);
  });

  it('语气违规时返回 warning issue（不阻断）', () => {
    const formalContent = ('尊敬的用户您好，这是一篇关于AI一人公司效率提升的文章，帮助一人公司创业者节省时间。').repeat(5);
    const { passed, issues } = validateContentQuality(formalContent, typeConfig, 'short_copy');
    const toneIssue = issues.find((i) => i.rule === 'tone_check');
    expect(toneIssue).toBeDefined();
    expect(toneIssue.severity).toBe('warning');
    // warning 不阻断通过（字数和关键词都满足）
    expect(passed).toBe(true);
  });

  it('全部满足时通过', () => {
    // 150+ 字，含 AI + 一人公司，无违规语气
    const goodContent = [
      '作为一个一人公司主理人，我每天都在探索用AI提升效率的方法。',
      '最近发现了几个特别好用的AI工具，彻底改变了我的工作方式。',
      '第一个是用AI自动处理客服回复，节省了我每天2小时。',
      '第二个是AI内容生成工具，帮我每周产出5篇高质量文章。',
      '一人公司最大的优势就是灵活，AI让这种灵活性倍增。',
      '如果你也在经营一人公司，强烈建议试试这些工具，真的太香了！',
    ].join('\n');
    const { passed, issues } = validateContentQuality(goodContent, typeConfig, 'short_copy');
    const blockingIssues = issues.filter((i) => i.severity === 'blocking');
    expect(blockingIssues).toHaveLength(0);
    expect(passed).toBe(true);
  });
});

describe('validateAllVariants', () => {
  it('批量验证多变体，任一失败则整体失败', () => {
    const typeConfig = {
      copy_rules: {
        keywords_required: ['AI'],
        min_word_count: { short_copy: 50, long_form: 500 },
      },
    };
    const goodShort = 'AI一人公司内容'.repeat(10);
    const badLong = 'AI短内容'; // long_form 要求 500 字
    const { passed, results } = validateAllVariants(
      { short_copy: goodShort, long_form: badLong },
      typeConfig
    );
    expect(passed).toBe(false);
    expect(results.short_copy.passed).toBe(true);
    expect(results.long_form.passed).toBe(false);
  });
});
