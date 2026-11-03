/** 旧Grok/Codex relay新启动均退役，保留历史额度输出识别。 */
import {describe,it,expect,vi} from 'vitest';
import {spawnSkillRelaySession,detectQuotaWall} from '../../../packages/brain/src/harness-skill-relay.js';
describe('旧provider relay不生成凭据卷、容器或tmux',()=>{
 it.each([{executor:'grok'},{executor:'grok',mode:'headed'},{executor:'codex'},{executor:'claude'},{}])('payload %j零执行副作用',async payload=>{
  const effect=vi.fn();const result=await spawnSkillRelaySession({id:'old',payload:{orchestrator:'skill-relay',...payload}},{env:{GROK_RELAY_HOME:'',CODEX_RELAY_HOME:'/unused'},pool:{query:effect},spawnFn:effect,sshSpawnFn:effect,loadSkill:effect,ensureWt:effect,execFn:effect});
  expect(result).toMatchObject({ok:false,error:'kernel_runtime_retired'});expect(effect).not.toHaveBeenCalled();
 });
});
describe('[BEHAVIOR-5] detectQuotaWall — 全 6 个 pattern 覆盖', () => {
  it('detectQuotaWall 是导出的函数', () => {
    expect(typeof detectQuotaWall).toBe('function');
  });

  it('"out of credits" → true', () => {
    expect(detectQuotaWall('Error: out of credits')).toBe(true);
  });

  it('"rate limit" → true', () => {
    expect(detectQuotaWall('rate limit exceeded')).toBe(true);
  });

  it('"429" → true', () => {
    expect(detectQuotaWall('HTTP 429 Too Many Requests')).toBe(true);
  });

  it('"quota exceeded" → true', () => {
    expect(detectQuotaWall('quota exceeded for account')).toBe(true);
  });

  it('"quota reached" → true', () => {
    expect(detectQuotaWall('Your quota reached the limit')).toBe(true);
  });

  it('"usage limit" → true', () => {
    expect(detectQuotaWall('usage limit reached')).toBe(true);
  });

  it('正常输出 → false', () => {
    expect(detectQuotaWall('task completed successfully')).toBe(false);
    expect(detectQuotaWall('')).toBe(false);
    expect(detectQuotaWall('some normal error')).toBe(false);
  });

  it('大小写不敏感', () => {
    expect(detectQuotaWall('OUT OF CREDITS')).toBe(true);
    expect(detectQuotaWall('Rate Limit Exceeded')).toBe(true);
  });
});

