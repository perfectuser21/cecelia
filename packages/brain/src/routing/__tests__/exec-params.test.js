/**
 * 正文【执行参数】块解析（任务 0d4215f2，决策 56328560）。
 * 只认固定字段名，解析不出就报错——不回落到任何正则猜测。
 */
import { describe, it, expect } from 'vitest';
import { parseExecParams, MODEL_ALIASES } from '../exec-params.js';

const env = {
  modelAllowlist: [
    'openai/gpt-5.6-terra', 'openai/gpt-6-sol', 'anthropic/claude-sonnet-5',
    'anthropic/claude-opus-5', 'xai/grok-4.7', 'xai/grok-4.20-multi-agent',
  ],
};
const block = (lines, end = true) => `【执行参数】\n${lines.join('\n')}\n${end ? '【执行参数结束】\n' : '\n'}正文目标：在朋友圈点赞`;

describe('parseExecParams', () => {
  it('没有参数块 → present=false，全部为 null，无错误', () => {
    const r = parseExecParams('任务目标\n请点赞', env);
    expect(r).toMatchObject({ present: false, agent: null, model: null, timeoutSec: null, acceptance: null, device: null, thinking: null, errors: [] });
  });

  it('回归：正文只有模板里的「调用Agent：…」而没有参数块 → 不产生任何模型', () => {
    const body = '任务目标\n调用Agent： 调用抖音平台数据采集 Agent \n执行要求';
    const r = parseExecParams(body, env);
    expect(r.model).toBeNull();
    expect(r.agent).toBeNull();
    expect(r.errors).toEqual([]);
  });

  it('完整参数块逐项取值', () => {
    const r = parseExecParams(block([
      '执行Agent：media', '模型：claude', '超时：20分钟', '验收：动态下出现本机昵称，附截图', '设备：小龙虾', '思考强度：high',
    ]), env);
    expect(r).toMatchObject({
      present: true, agent: 'media', model: 'anthropic/claude-sonnet-5', modelRaw: 'claude',
      timeoutSec: 1200, acceptance: '动态下出现本机昵称，附截图', device: '小龙虾', thinking: 'high', errors: [],
    });
  });

  it('全角与半角冒号都认；字段名大小写与空格不敏感', () => {
    const r = parseExecParams(block(['执行 agent: dev', 'Model : codex']), env);
    expect(r.agent).toBe('dev');
    expect(r.model).toBe('openai/gpt-5.6-terra');
  });

  it('缺结束标记 → 读到第一个空行为止', () => {
    const r = parseExecParams(block(['执行Agent：media', '模型：sol'], false), env);
    expect(r.agent).toBe('media');
    expect(r.model).toBe('openai/gpt-6-sol');
  });

  it('旧简称仍兼容：claude→Sonnet 系列、codex→Terra 系列（都取清单内最新）', () => {
    expect(MODEL_ALIASES).toMatchObject({ claude: 'sonnet', codex: 'terra' });
    expect(parseExecParams(block(['模型：claude']), env).model).toBe('anthropic/claude-sonnet-5');
    expect(parseExecParams(block(['模型：codex']), env).model).toBe('openai/gpt-5.6-terra');
  });

  // 主理人 09-29（决策 49d17c60）：只写系列名，系统自动取清单里该系列的最新版本；
  // 新版本进了允许清单就自动成为默认，不用改任务写法。
  const fam = {
    modelAllowlist: [
      'openai/gpt-5.6-sol', 'openai/gpt-6-sol', 'openai/gpt-5.6-terra', 'openai/gpt-5.6-luna', 'openai/gpt-6-astra', 'openai/gpt-5.5',
      'anthropic/claude-opus-4-8', 'anthropic/claude-opus-5', 'anthropic/claude-sonnet-4-6', 'anthropic/claude-sonnet-5',
      'anthropic/claude-fable-5', 'anthropic/claude-fable-5-1', 'anthropic/claude-haiku-4-5', 'anthropic/claude-haiku-4-5-20251001',
      'xai/grok-4.3', 'xai/grok-4.7', 'xai/grok-4.6', 'xai/grok-4.20-reasoning', 'xai/grok-build-0.1',
    ],
  };
  const m = (v, e = fam) => parseExecParams(block([`模型：${v}`]), e);

  it('系列名 → 清单内该系列最新版本（大小写不敏感）', () => {
    expect(m('Sol').model).toBe('openai/gpt-6-sol');
    expect(m('terra').model).toBe('openai/gpt-5.6-terra');
    expect(m('Luna').model).toBe('openai/gpt-5.6-luna');
    expect(m('astra').model).toBe('openai/gpt-6-astra');
    expect(m('Opus').model).toBe('anthropic/claude-opus-5');
    expect(m('sonnet').model).toBe('anthropic/claude-sonnet-5');
    expect(m('Fable').model).toBe('anthropic/claude-fable-5-1');
    expect(m('haiku').model).toBe('anthropic/claude-haiku-4-5');
    expect(m('Grok').model).toBe('xai/grok-4.7');
  });

  it('新版本进了清单 → 系列名自动跟到新版本（Opus 5 → 5.1，Sol 6 → 6.1）', () => {
    const next = { modelAllowlist: [...fam.modelAllowlist, 'anthropic/claude-opus-5-1', 'openai/gpt-6.1-sol'] };
    expect(m('opus', next).model).toBe('anthropic/claude-opus-5-1');
    expect(m('sol', next).model).toBe('openai/gpt-6.1-sol');
  });

  it('带后缀/日期的变体不算系列最新（grok-4.20-reasoning、haiku 日期快照不会被系列名选中）', () => {
    expect(m('grok').model).toBe('xai/grok-4.7');
    expect(m('haiku').model).toBe('anthropic/claude-haiku-4-5');
  });

  it('具体型号：全名、显示名（带空格/点号）都认', () => {
    expect(m('GPT-6 Sol').model).toBe('openai/gpt-6-sol');
    expect(m('gpt-6-sol').model).toBe('openai/gpt-6-sol');
    expect(m('openai/gpt-6-sol').model).toBe('openai/gpt-6-sol');
    expect(m('Claude Opus 4.8').model).toBe('anthropic/claude-opus-4-8');
    expect(m('Opus 4.8').model).toBe('anthropic/claude-opus-4-8');
    expect(m('Grok 4.6').model).toBe('xai/grok-4.6');
    expect(m('GPT-5.5').model).toBe('openai/gpt-5.5');
  });

  it('系列在清单里一个都没有 → unknown_model（不猜）', () => {
    const r = m('opus', { modelAllowlist: ['openai/gpt-6-sol'] });
    expect(r.model).toBeNull();
    expect(r.errors).toContain('unknown_model');
  });

  it('允许清单里的全名与短名精确命中', () => {
    expect(parseExecParams(block(['模型：xai/grok-4.7']), env).model).toBe('xai/grok-4.7');
    expect(parseExecParams(block(['模型：claude-opus-5']), env).model).toBe('anthropic/claude-opus-5');
  });

  it('非精确的词不做后缀猜测 → unknown_model', () => {
    for (const bad of ['agent', 'gpt', 'multi-agent']) {
      const r = parseExecParams(block([`模型：${bad}`]), env);
      expect(r.model).toBeNull();
      expect(r.errors).toContain('unknown_model');
    }
  });

  it('超时单位：分钟 / 秒 / m / s / 纯数字（默认分钟）', () => {
    const t = (v) => parseExecParams(block([`超时：${v}`]), env).timeoutSec;
    expect(t('30分钟')).toBe(1800);
    expect(t('90秒')).toBe(90);
    expect(t('90s')).toBe(90);
    expect(t('15m')).toBe(900);
    expect(t('45')).toBe(2700);
  });

  it('超时越界（<1 分钟或 >180 分钟）或写不成数字 → bad_timeout', () => {
    for (const v of ['500分钟', '10秒', '很久']) {
      const r = parseExecParams(block([`超时：${v}`]), env);
      expect(r.timeoutSec).toBeNull();
      expect(r.errors).toContain('bad_timeout');
    }
  });

  it('思考强度只认白名单 → 否则 bad_thinking', () => {
    expect(parseExecParams(block(['思考强度：Medium']), env).thinking).toBe('medium');
    expect(parseExecParams(block(['思考强度：超强']), env).errors).toContain('bad_thinking');
  });

  it('执行Agent 只允许安全字符，否则 bad_agent', () => {
    const r = parseExecParams(block(['执行Agent：media; rm -rf /']), env);
    expect(r.agent).toBeNull();
    expect(r.errors).toContain('bad_agent');
  });
});

// 0929 生产实证（任务 319d933d）：Notion 中文模板块头写成行首「执行参数：」，
// 旧正则只认「【执行参数】」→ present=false，模型/超时/执行Agent/验收全被忽略（写 sol 实跑 terra）。
describe('parseExecParams — 行首「执行参数：」块头', () => {
  const notionBody = [
    '执行参数：',
    '执行Agent：media',
    '模型：sol',
    '超时：60分钟',
    '设备：小黄手机',
    '验收：成功截图并写入对应数据库',
    '',
    '具体任务：在小黄手机上发一条朋友圈并截图',
  ].join('\n');
  const famEnv = { modelAllowlist: ['openai/gpt-5.6-sol', 'openai/gpt-6-sol', 'openai/gpt-5.6-terra'] };

  it('Notion 模板原样正文 → 全部字段解析出来', () => {
    const r = parseExecParams(notionBody, famEnv);
    expect(r).toMatchObject({
      present: true, agent: 'media', model: 'openai/gpt-6-sol', modelRaw: 'sol',
      timeoutSec: 3600, device: '小黄手机', acceptance: '成功截图并写入对应数据库', errors: [],
    });
  });

  it('半角冒号、前后空白、块头前有其他正文行都认', () => {
    for (const head of ['执行参数:', '  执行参数 ： ', '\t执行参数:\t']) {
      const r = parseExecParams(`任务标题\n${head}\n执行Agent：media\n模型：sol\n\n正文`, famEnv);
      expect(r.present).toBe(true);
      expect(r.agent).toBe('media');
      expect(r.model).toBe('openai/gpt-6-sol');
    }
  });

  it('空行截断仍生效：空行之后的字段不算参数', () => {
    const r = parseExecParams('执行参数：\n执行Agent：media\n\n模型：sol\n超时：60分钟', famEnv);
    expect(r.present).toBe(true);
    expect(r.agent).toBe('media');
    expect(r.model).toBeNull();
    expect(r.timeoutSec).toBeNull();
  });

  it('【执行参数结束】也能作为这种块头的结束标记', () => {
    const r = parseExecParams('执行参数：\n执行Agent：media\n【执行参数结束】\n模型：sol', famEnv);
    expect(r.agent).toBe('media');
    expect(r.model).toBeNull();
  });

  it('行中出现「执行参数：」不误判为块头', () => {
    const r = parseExecParams('请参考下面的执行参数：\n执行Agent：media\n模型：sol', famEnv);
    expect(r.present).toBe(false);
    expect(r.agent).toBeNull();
    expect(r.model).toBeNull();
  });

  it('行首「执行参数：」后面还跟着其他文字 → 不当块头', () => {
    const r = parseExecParams('执行参数：见附件说明\n执行Agent：media', famEnv);
    expect(r.present).toBe(false);
    expect(r.agent).toBeNull();
  });

  it('回归：方括号写法行为不变', () => {
    const r = parseExecParams('【执行参数】\n执行Agent：media\n模型：sol\n超时：60分钟\n【执行参数结束】\n正文', famEnv);
    expect(r).toMatchObject({ present: true, agent: 'media', model: 'openai/gpt-6-sol', timeoutSec: 3600 });
  });
});
