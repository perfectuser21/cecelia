/**
 * credential-freshness.test.js — 凭据保鲜守卫
 *
 * ── 为什么存在（2026-09-16/17 一夜实证）─────────────────────────────────
 * 凭据到期在这套系统里完全无人看守，一晚上撞出三条：
 *   · Tailscale API key 过期 18 天没人知道，直到 CI 红了才挖出来
 *   · 1Password 里的备用 GitHub PAT：元数据什么都没写，实际早就 401
 *   · 99 个凭据条目里只有 1 个写了到期日
 *
 * 关键结论：**读元数据只能抓到"老实写了到期日"的那一个**。今晚那把 PAT 谁都没说它
 * 过期，它就是不能用了——所以真相只能靠"定期真去用一次"拿到。元数据用来提前预警，
 * 活性探测用来确认当下能不能用，两者缺一不可。
 *
 * 自动续期的边界（Tailscale 设计限制，不是偷懒）：
 *   · auth key（让机器加入网络）→ 可以用 API token 自动续
 *   · API token 自己 → 不能用旧 token 生成新 token，只能人去后台点
 * 所以守卫的目标不是"全自动"，而是把主理人要管的从"随时可能爆的一堆"收敛到
 * "90 天一次、且提前 14 天有预告的一件"。
 */
import { describe, it, expect } from 'vitest';
import {
  daysUntil,
  classifyExpiry,
  buildProbePlan,
  summarizeProbeResults,
  shouldRotateAuthKey,
  EXPIRY_WARN_DAYS,
  AUTH_KEY_ROTATE_DAYS,
} from '../credential-freshness.js';

describe('daysUntil — 到期天数', () => {
  const now = Date.parse('2026-09-17T00:00:00Z');
  it('未来日期返回正数', () => {
    expect(daysUntil('2026-12-16', now)).toBe(90);
  });
  it('已过期返回负数', () => {
    expect(daysUntil('2026-08-29', now)).toBe(-19);
  });
  it('无法解析返回 null，不能当成 0（0 会被误判成"今天到期"）', () => {
    expect(daysUntil(null, now)).toBeNull();
    expect(daysUntil('不是日期', now)).toBeNull();
  });
});

describe('classifyExpiry — 分档', () => {
  it('已过期 → expired', () => {
    expect(classifyExpiry(-1)).toBe('expired');
  });
  it('剩余天数在预警窗内 → warn', () => {
    expect(classifyExpiry(EXPIRY_WARN_DAYS)).toBe('warn');
    expect(classifyExpiry(0)).toBe('warn');
  });
  it('还早 → ok', () => {
    expect(classifyExpiry(EXPIRY_WARN_DAYS + 1)).toBe('ok');
  });
  it('没有到期信息 → unknown（不是 ok —— 今晚那把 PAT 就是"没写"却已失效）', () => {
    expect(classifyExpiry(null)).toBe('unknown');
  });
});

describe('buildProbePlan — 该探哪些凭据', () => {
  it('覆盖今晚实际出事的三类', () => {
    const names = buildProbePlan().map((p) => p.name);
    expect(names).toContain('tailscale_api');
    expect(names).toContain('github_pat');
    expect(names).toContain('feishu_app');
  });

  it('每项都必须给出 probe 函数——没有探测手段的条目不许进计划', () => {
    for (const p of buildProbePlan()) {
      expect(typeof p.probe).toBe('function');
      expect(p.name).toBeTruthy();
    }
  });
});

describe('summarizeProbeResults — 结果归并', () => {
  it('全部通过 → healthy，无告警', () => {
    const s = summarizeProbeResults([
      { name: 'a', ok: true }, { name: 'b', ok: true },
    ]);
    expect(s.status).toBe('healthy');
    expect(s.failed).toEqual([]);
  });

  it('任一失活 → degraded 并点名', () => {
    const s = summarizeProbeResults([
      { name: 'tailscale_api', ok: false, detail: 'HTTP 401' },
      { name: 'github_pat', ok: true },
    ]);
    expect(s.status).toBe('degraded');
    expect(s.failed).toEqual(['tailscale_api']);
  });

  it('探测本身出错（网络问题）算失活，不能当成通过——宁可误报也不能漏报', () => {
    const s = summarizeProbeResults([{ name: 'x', ok: false, detail: 'ECONNRESET' }]);
    expect(s.status).toBe('degraded');
  });

  it('汇总带可读摘要，告警里要能直接看懂', () => {
    const s = summarizeProbeResults([{ name: 'tailscale_api', ok: false, detail: 'HTTP 401' }]);
    expect(s.summary).toContain('tailscale_api');
    expect(s.summary).toContain('401');
  });
});

describe('shouldRotateAuthKey — 何时自动续 auth key', () => {
  it('剩余天数进入续期窗 → 该续', () => {
    expect(shouldRotateAuthKey(AUTH_KEY_ROTATE_DAYS)).toBe(true);
    expect(shouldRotateAuthKey(0)).toBe(true);
  });
  it('已过期也要续（晚续总比不续好）', () => {
    expect(shouldRotateAuthKey(-5)).toBe(true);
  });
  it('还早 → 不动', () => {
    expect(shouldRotateAuthKey(AUTH_KEY_ROTATE_DAYS + 1)).toBe(false);
  });
  it('不知道到期日 → 不自动续（避免每轮都重发新 key 把旧 key 冲掉）', () => {
    expect(shouldRotateAuthKey(null)).toBe(false);
  });
});
