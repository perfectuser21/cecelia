/** Render Brain-owned facts only. Human fields are text, never structural Markdown. */
function plain(value, fallback = '待补充') {
  if (value === null || value === undefined || String(value).trim() === '') return fallback;
  return String(value).replace(/BRAIN-CRM-/g, 'BRAIN CRM ')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/[\\`*_{}[\]()#!|~]/g, '\\$&').replace(/[\r\n]+/g, ' ');
}
export function renderCustomerDossier(customer) {
  const m = customer.manual_fields ?? {};
  const profile = customer.profile_managed === true && customer.profile_markdown?.trim()
    ? customer.profile_markdown : '画像待生成：当前证据不足，尚未形成经过核验的综合画像。';
  return [
    '## 客户介绍',
    `**客户：**${plain(customer.display_name)}`,
    plain(m.introduction ?? m.summary, '客户背景待补充；不依据昵称推断公司、职务或购买情况。'),
    `- **身份与角色：**${plain(m.role)}`,
    `- **行业与业务：**${plain(m.industry)}`,
    '## 当前画像',
    `- **当前阶段：**${plain(m.stage)}`,
    `- **客户状态：**${plain(m.customer_status)}`,
    `- **核心需求：**${plain(m.requirement)}`,
    `- **当前顾虑：**${plain(m.concern)}`,
    `- **预算：**${plain(m.budget)}`,
    `- **身份核验：**${plain(m.identity_verification, '待核验')}`,
    profile,
    '## 下一步跟进',
    `- **下一步动作：**${plain(m.next_action, '核验联系人身份与最新沟通进展，再确认需求和跟进安排。')}`,
    `- **跟进时间：**${plain(m.next_followup)}`,
    `- **最近沟通：**${plain(m.last_contacted_at)}`,
    '## 人工笔记',
    plain(m.notes, '尚无人工备注。可在客户属性「人工备注」填写；正文中自行补充的内容保留。'),
    '## 报告与沟通依据',
    '客户进展报告共用一个报告库，按日报、周报、月报切换视图；聊天原文逐条关联客户。页面内嵌入口按已配置的客户关系显示。记录为空表示尚无已归档数据，不代表没有发生过沟通。',
    '## 档案来源',
    `本页已登记 Brain 客户主档。来源账号：${plain(m.source_account_label)}。身份核验与消息采集分别确认，不以页面排版或昵称代替核验。`,
    'Notion 人工字段由 Brain 接收后投影；AI 画像由客服分析流程通过 Brain 画像接口维护。画像待生成时保留明确空缺，不自动推断。',
    '## 人工正文与历史资料',
    '以下保留原有正文与资料。历史阶段判断不作为当前画像；当前信息以上方档案和已关联的沟通依据为准。',
  ].join('\n');
}
