import { describe, it, expect } from 'vitest';
import { SPEC_FILE, INTENT_FILE, specErrors, specIds, qaScenarios, uncoveredSection, judgmentPoints, untrackedDeferrals } from '../lib/spec-check.mjs';

const TASK = 't-1';
const fm = (upstream, step = 'spec') => `---\ntask_id: ${TASK}\nstep: ${step}\nupstream: ${JSON.stringify(upstream)}\n---\n`;
const FULL = ['01-intent.md#I-1', '01-intent.md#I-2'];
const qa = (id, { covers = 'I-1', pre = '测试库有一条 queued 任务', steps = '用户 POST /api/brain/tasks 再 GET 该任务', expect = '返回 200 且 status 为 queued' } = {}) =>
  [`### ${id}`, covers !== null ? `对应: ${covers}` : null, pre !== null ? `前提: ${pre}` : null,
    steps !== null ? `操作: ${steps}` : null, expect !== null ? `期望: ${expect}` : null].filter((l) => l !== null).join('\n');
const UNCOVERED_OK = '## 未覆盖真实链路\n\n无：只改本仓库内的纯函数，没有外部调用方与第三方\n';
const QA_OK = `## QA 场景\n\n${qa('Q-1')}\n\n${qa('Q-2', { covers: 'I-2' })}\n\n${UNCOVERED_OK}`;

describe('lib/spec-check', () => {
  it('常量', () => {
    expect(SPEC_FILE).toBe('02-spec.md');
    expect(INTENT_FILE).toBe('01-intent.md');
  });

  it('合法 02（含覆盖全部 I-n 的 QA 场景）-> 无错误', () => {
    expect(specErrors(`${fm(FULL)}# spec\n\n### S-1 说明\n内容\n\n${QA_OK}`, TASK, ['I-1', 'I-2'])).toEqual([]);
  });

  it('upstream 未覆盖 + 无 S-n -> not_covered 与 spec_ids_missing', () => {
    const errors = specErrors(`${fm(FULL.slice(0, 1))}# spec\n\n#### 规格 1\n\n${QA_OK}`, TASK, ['I-1', 'I-2']);
    expect(errors).toEqual(['not_covered:I-2', 'spec_ids_missing']);
  });

  it('step 不对 -> step_mismatch', () => {
    expect(specErrors(`${fm(FULL, 'build')}### S-1\n\n${QA_OK}`, TASK, ['I-1', 'I-2'])).toEqual(['step_mismatch']);
  });

  it('没有任何 QA 场景 -> qa_missing', () => {
    expect(specErrors(`${fm(FULL)}### S-1\n`, TASK, ['I-1', 'I-2'])).toEqual(['qa_missing']);
  });

  it('有 I-n 没被任何 Q-n 覆盖 -> qa_not_covered:I-n', () => {
    expect(specErrors(`${fm(FULL)}### S-1\n\n## QA 场景\n\n${qa('Q-1')}\n`, TASK, ['I-1', 'I-2'])).toEqual(['qa_not_covered:I-2']);
  });

  it('Q-n 缺 对应/操作/期望、对应未知 I-n -> 逐条报错；前提可省略', () => {
    const text = `${fm(FULL)}### S-1\n\n## QA 场景\n\n${qa('Q-1', { covers: null })}\n\n${qa('Q-2', { steps: null, pre: null })}\n\n${qa('Q-3', { expect: null })}\n\n${qa('Q-4', { covers: 'I-1, I-9' })}\n\n${qa('Q-5', { covers: 'I-2' })}\n`;
    expect(specErrors(text, TASK, ['I-1', 'I-2'])).toEqual(['Q-1:covers_missing', 'Q-2:steps_missing', 'Q-3:expect_missing', 'Q-4:covers_unknown:I-9']);
  });

  it('qaScenarios 解析字段（可加粗、全角冒号、多行操作）', () => {
    const text = `${fm(FULL)}### S-1\n\n## QA 场景\n\n### Q-1 正常提交\n**对应**：I-1、I-2\n前提: 无\n操作: 1. 打开页面\n2. 点提交\n期望: 页面出现「已提交」\n`;
    expect(qaScenarios(text)).toEqual([
      { id: 'Q-1', covers: ['I-1', 'I-2'], pre: '无', steps: '1. 打开页面\n2. 点提交', expect: '页面出现「已提交」' },
    ]);
  });

  it('specIds 按顺序返回正文 S-n，忽略其他锚点（含 Q-n）与 frontmatter', () => {
    expect(specIds(`${fm(FULL)}### S-2 b\n### I-9\n### S-1\n### Q-1\n### S-10：c\n`)).toEqual(['S-2', 'S-1', 'S-10']);
  });

  it('specIds 无 frontmatter 时扫全文', () => {
    expect(specIds('### S-1\n### R-1\n')).toEqual(['S-1']);
  });

  // 审计 #10（旧 proposer 规则C + controller 2.5.0）：没真验的链路必须显式登记，可写「无：理由」
  describe('## 未覆盖真实链路', () => {
    const body = (section) => `${fm(FULL)}# spec\n\n### S-1 说明\n内容\n\n## QA 场景\n\n${qa('Q-1')}\n\n${qa('Q-2', { covers: 'I-2' })}\n${section}`;
    it('缺这一段 → uncovered_section_missing；有段没内容 → uncovered_section_empty', () => {
      expect(specErrors(body(''), TASK, ['I-1', 'I-2'])).toEqual(['uncovered_section_missing']);
      expect(specErrors(body('\n## 未覆盖真实链路\n\n'), TASK, ['I-1', 'I-2'])).toEqual(['uncovered_section_empty']);
    });
    it('写「无：理由」或逐条列出 → 合格；uncoveredSection 原样取出段落正文', () => {
      expect(specErrors(body(`\n${UNCOVERED_OK}`), TASK, ['I-1', 'I-2'])).toEqual([]);
      const listed = '\n## 未覆盖真实链路\n\n- 飞书推送：预览环境无飞书凭据，QA 只验到落库\n- OpenAI 调用：用 mock\n';
      expect(specErrors(body(listed), TASK, ['I-1', 'I-2'])).toEqual([]);
      expect(uncoveredSection(body(listed))).toBe('- 飞书推送：预览环境无飞书凭据，QA 只验到落库\n- OpenAI 调用：用 mock');
    });
  });

  // 审计 #13/#14（旧 proposer 9.6 判定点登记表 + reviewer 9.4 写库）：可选段，写了就要五要素齐全
  describe('## 判定点', () => {
    const body = (section) => `${fm(FULL)}# spec\n\n### S-1 说明\n内容\n\n${QA_OK}\n${section}`;
    const row = '- 部署成功判定｜候选: 看 HTTP 200、看 git_sha｜所选: 看 git_sha｜依据: 200 只说明活着｜误判后果: 旧版本被当新版本验收';
    it('五要素齐全 → 解析成条目；缺要素 → judgment_invalid:<序号>', () => {
      expect(specErrors(body(`## 判定点\n\n${row}\n`), TASK, ['I-1', 'I-2'])).toEqual([]);
      expect(judgmentPoints(body(`## 判定点\n\n${row}\n`))).toEqual([{
        name: '部署成功判定', candidates: '看 HTTP 200、看 git_sha', chosen: '看 git_sha', basis: '200 只说明活着', consequence: '旧版本被当新版本验收',
      }]);
      expect(specErrors(body('## 判定点\n\n- 只有名字｜所选: x\n'), TASK, ['I-1', 'I-2'])).toEqual(['judgment_invalid:1']);
    });
    it('没有这一段、或写「无：理由」→ 没有判定点', () => {
      expect(judgmentPoints(body(''))).toEqual([]);
      expect(judgmentPoints(body('## 判定点\n\n无：纯内部计算\n'))).toEqual([]);
      expect(specErrors(body('## 判定点\n\n无：纯内部计算\n'), TASK, ['I-1', 'I-2'])).toEqual([]);
    });
  });

  // 审计 #16（旧 reviewer 9.7）：「留给后续」不能只是一句话，必须带 Brain 任务 ID
  describe('untrackedDeferrals', () => {
    it('驳回理由是「后续再做/以后/另开/下一期」却没带任务 ID → 列出；带了 UUID 或 8 位 ID → 不列；采纳不管', () => {
      const resp = [
        '### R-1\n处理: 驳回\n说明: 这个后续再做',
        '### R-2\n处理: 驳回\n说明: 另开任务 3f2c40c2 处理',
        '### R-3\n处理: 驳回\n说明: 下一期做，见 568afae1-6824-4030-9d62-f910a333057f',
        '### R-4\n处理: 采纳\n说明: 以后也会保留',
        '### R-5\n处理: 驳回\n说明: 代码 activities/x.mjs:12 已处理这个场景',
      ].join('\n\n');
      expect(untrackedDeferrals(resp)).toEqual(['R-1']);
    });
  });
});
