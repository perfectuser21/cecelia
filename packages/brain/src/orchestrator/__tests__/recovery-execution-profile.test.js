import { afterEach, describe, expect, it, vi } from 'vitest';
import { executionProfileHash, rawExecutionProfile, validRecoveryExecutionTarget } from '../recovery-execution-profile.js';
import { matchesRecoveryRebase } from '../recovery-rebase.js';

afterEach(() => vi.unstubAllEnvs());
describe('恢复执行配置的原始规范化摘要', () => {
  it.each([[['a'.repeat(64)]],[{}],[123],[true],[false],[null]])
  ('profile摘要拒绝非字符串：%j', expected_profile_hash => {
    expect(validRecoveryExecutionTarget({expected_profile_hash,
      execution_target:{provider:'codex',account:'team2',machine:'xian-mac-m4'}})).toBe(false);
  });
  it.each(['https://example.com/model','http://host','ftp://host/model','ssh://host/model',
    'file:///Users/account/model','/Users/account/model','~/model','C:/Users/account/model',
    'openai/../model','openai/./model','openai//model','openai::model','openai/model/','../model'])
  ('模型标识拒绝URL、绝对路径、空段或遍历段：%s', model => {
    expect(validRecoveryExecutionTarget({expected_profile_hash:'a'.repeat(64),
      execution_target:{provider:'codex',account:'team2',machine:'xian-mac-m4',model}})).toBe(false);
  });
  it.each(['gpt-5.6-sol','claude-opus-4-6','openai/gpt-5.6-sol','openai:gpt-5.6-sol','vendor/family/model:latest'])
  ('保留普通模型与供应商限定标识：%s', model => {
    expect(validRecoveryExecutionTarget({expected_profile_hash:'a'.repeat(64),
      execution_target:{provider:'codex',account:'team2',machine:'xian-mac-m4',model}})).toBe(true);
  });
  it('只消费原始payload，环境Commander变化不会更改摘要', () => {
    const before = executionProfileHash({ branch:'cp-test',base_sha:'a'.repeat(40) });
    vi.stubEnv('KERNEL_COMMANDER_PROFILE_JSON', '{"primary":{"machine":"untrusted"}}');
    expect(executionProfileHash({ branch:'cp-other' })).toBe(before);
    expect(rawExecutionProfile({})).toEqual({});
    expect(executionProfileHash({ commander:null })).not.toBe(before);
  });
  it('键顺序无关，任何执行目标/全局选项变化都使摘要变化', () => {
    const original = { commander:{primary:{provider:'codex',account:'team2',machine:'xian-mac-m4'},fallbacks:[]},
      role_assignments:{generator:{provider:'codex',account:'team2'}},routing:{strict_affinity:true},
      executor:'codex',provider:'codex',executor_account:'team2',model:'auto' };
    const reordered = { ...original,commander:{fallbacks:[],primary:{machine:'xian-mac-m4',account:'team2',provider:'codex'}} };
    expect(executionProfileHash(reordered)).toBe(executionProfileHash(original));
    for (const key of Object.keys(original)) expect(executionProfileHash({...original,[key]:null}))
      .not.toBe(executionProfileHash(original));
  });
  it('幂等请求比较完整目标但不依赖对象键顺序', () => {
    const request = { expected_receipt_id:'old',expected_profile_hash:'a'.repeat(64),
      execution_target:{provider:'codex',account:'team2',machine:'xian-mac-m4'} };
    const stored = { ...request,predecessor_run_id:'failed',
      execution_target:{machine:'xian-mac-m4',account:'team2',provider:'codex'} };
    expect(matchesRecoveryRebase(stored,request,'failed')).toBe(true);
    expect(matchesRecoveryRebase(stored,{...request,execution_target:{...request.execution_target,account:'team3'}},'failed')).toBe(false);
    expect(matchesRecoveryRebase(stored,{...request,expected_profile_hash:'b'.repeat(64)},'failed')).toBe(false);
  });
  it('target严格拒绝路径、空格、URL、未知键和非法摘要', () => {
    const good = { expected_profile_hash:'a'.repeat(64),execution_target:{provider:'codex',account:'team2',machine:'xian-mac-m4'} };
    expect(validRecoveryExecutionTarget(good)).toBeTruthy();
    for (const bad of [ {...good,expected_profile_hash:null}, {...good,execution_target:null},
      {...good,execution_target:{...good.execution_target,account:'../team2'}},
      {...good,execution_target:{...good.execution_target,machine:'http://host'}},
      {...good,execution_target:{...good.execution_target,provider:' codex'}},
      {...good,execution_target:{...good.execution_target,home:'/secret'}} ]) {
      expect(validRecoveryExecutionTarget(bad)).toBeFalsy();
    }
  });
});
