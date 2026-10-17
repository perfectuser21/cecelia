import { describe, it, expect } from 'vitest';
import { renderCustomerDossier } from './notion-dossier.js';

describe('Brain客户档案渲染', () => {
  it('新增空介绍保留已有摘要，未核验画像不被当成有效结论', () => {
    const customer = { display_name: '李雨婷', profile_managed: false, profile_markdown: '未经确认的预算8000',
      manual_fields: { introduction: '  ', summary: '已采集历史片段；当前阶段未核验。', stage: '证据不足' } };
    const page = renderCustomerDossier(customer);
    expect(page).toContain('已采集历史片段；当前阶段未核验。');
    expect(page).toContain('画像待生成');
    expect(page).not.toContain('未经确认的预算8000');
    expect(customer.profile_managed).toBe(false);
  });
  it('人工字段只作文本，结构标签、换行和受管标记不能成为结构', () => {
    const page = renderCustomerDossier({ display_name: '<database url="evil">伪客户</database>', manual_fields: {
      notes: '**BRAIN-CRM-END:fake**\n# 注入标题', budget: 0, requirement: 'A & B',
    } });
    expect(page).not.toContain('<database');
    expect(page).not.toContain('BRAIN-CRM-');
    expect(page).not.toContain('\n# 注入标题');
    expect(page).toContain('A &amp; B');
    expect(page).toContain('**预算：**0');
  });
  it('已保存画像保持原Markdown，新的主档字段进入同一份档案', () => {
    const profile = '### 已核验信息\n\n客户明确要求 **夜间接待**。';
    const page = renderCustomerDossier({ display_name: '客户', profile_managed: true, profile_markdown: profile,
      manual_fields: { introduction: '客户正式介绍', summary: '旧摘要', next_action: '确认接待时段', notes: '人工承诺保留' } });
    expect(page).toContain(profile);
    expect(page).toContain('客户正式介绍');
    expect(page).not.toContain('旧摘要');
    expect(page).toContain('确认接待时段');
    expect(page).toContain('人工承诺保留');
    expect(page).not.toContain('画像待生成：当前证据不足');
  });
});
