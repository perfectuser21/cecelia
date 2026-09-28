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

  it('别名表覆盖 claude / codex / terra / sol / grok', () => {
    expect(MODEL_ALIASES).toMatchObject({
      claude: 'anthropic/claude-sonnet-5', codex: 'openai/gpt-5.6-terra', terra: 'openai/gpt-5.6-terra',
      sol: 'openai/gpt-6-sol', grok: 'xai/grok-4.7',
    });
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
