// F1「工厂 · 开发闭环」步骤 1 —— 边：手机结晶工具链的跨平台与确定性探针
//
// 这套工具链（explore/distill/replay/lib/crystal-verify）此前只存在于 xian-m4 本地，
// 不在任何 git repo：改动无守卫、无 CI、无回滚。2026-09-06 已因此付过代价——
// 蒸馏器无条件覆盖 registry 坐标，把已 promote 的 search_account 的 search_entry
// 从 (946,75) 改成 (537,77)，当场弄坏生产序列。
//
// 本文件为收编入 repo 时补的三条守卫：
//
// ① 跨平台临时目录：TMP 硬编码 '/tmp/ab'，Windows 上不存在该路径。
// ② 截图缩放的静默失败：screenshot() 里 `sips -Z 760 ... >/dev/null 2>&1` 把失败吞了，
//    然后照样返回缩略图路径——但在没有 sips 的机器上那个文件根本没被创建。
//    调用方拿到一个幽灵路径，后续读取才炸，且炸得离现场很远。
//    因此 scaleDown 的契约是「永远返回一个真实存在的文件路径」：缩放不成就退回原图。
// ③ registry 合并覆盖：见上述 09-06 事故。
//
// 另加确定性探针：postcondition 判定能被系统状态确定性回答时（前台 activity 是什么），
// 不该烧 LLM 视觉判定。这不违反「判定层不蒸馏」——activity 是系统状态读取，
// 不是把语义判断硬编码成脆弱规则。

import { describe, it, expect, vi } from 'vitest';
import { tmpdir } from 'node:os';
import { resolveTmpRoot, scaleDown } from '../../../packages/quality/phone-crystal/platform.mjs';
import { activityMatches, evaluatePostcondition } from '../../../packages/quality/phone-crystal/postcondition.mjs';
import { mergeLocators } from '../../../packages/quality/phone-crystal/locators.mjs';

describe('F1 step1 · 工具链临时目录跨平台', () => {
  it('不硬编码 /tmp，落在本机 os.tmpdir() 下', () => {
    const root = resolveTmpRoot({});
    expect(root.startsWith(tmpdir())).toBe(true);
  });

  it('尊重 AB_TMP 覆盖，便于 CI 与并行跑隔离', () => {
    expect(resolveTmpRoot({ AB_TMP: '/custom/ab' })).toBe('/custom/ab');
  });
});

describe('F1 step1 · 截图缩放永远返回真实存在的路径', () => {
  const RAW = '/x/raw.png';
  const OUT = '/x/raw-s.png';

  it('缩放器可用且真产出文件 → 返回缩略图', () => {
    const run = vi.fn(() => undefined);
    const exists = vi.fn((p) => p === OUT || p === RAW);
    expect(scaleDown(RAW, OUT, { run, exists })).toBe(OUT);
  });

  it('第一个缩放器不存在 → 自动退到下一个，仍返回缩略图', () => {
    const run = vi.fn((cmd) => {
      if (cmd.startsWith('sips')) throw new Error('command not found: sips');
    });
    const exists = vi.fn((p) => p === OUT || p === RAW);
    expect(scaleDown(RAW, OUT, { run, exists })).toBe(OUT);
    // 试过 sips 后必须真的试了第二个，而不是直接放弃
    expect(run.mock.calls.length).toBeGreaterThan(1);
  });

  it('全部缩放器都不可用 → 退回原图，而不是返回不存在的缩略图', () => {
    const run = vi.fn(() => { throw new Error('command not found'); });
    const exists = vi.fn((p) => p === RAW);
    expect(scaleDown(RAW, OUT, { run, exists })).toBe(RAW);
  });

  // 这条是 09-07 收编时发现的真实静默失败形态：
  // sips 在有些环境下退出码为 0 但没写出文件（权限/格式），旧代码会返回幽灵路径。
  it('命令自称成功但文件没落地 → 仍退回原图', () => {
    const run = vi.fn(() => undefined);
    const exists = vi.fn((p) => p === RAW);
    expect(scaleDown(RAW, OUT, { run, exists })).toBe(RAW);
  });
});

describe('F1 step1 · postcondition 确定性探针分派', () => {
  const FOCUS = 'com.ss.android.ugc.aweme/com.ss.android.ugc.aweme.shortvideo.ui.VideoRecordNewActivity';

  it('前台 activity 命中期望 → 判定通过', () => {
    expect(activityMatches(FOCUS, 'VideoRecordNewActivity')).toBe(true);
  });

  it('停在首页没进发布页 → 判定不通过', () => {
    expect(activityMatches('com.ss.android.ugc.aweme/com.ss.android.ugc.aweme.splash.SplashActivity',
      'VideoRecordNewActivity')).toBe(false);
  });

  it('读不到前台（adb 抽风）→ 判不通过，不当成成功', async () => {
    const vision = vi.fn();
    const r = await evaluatePostcondition(
      { type: 'foreground_activity', value: 'VideoRecordNewActivity' },
      {}, { currentFocus: () => '', vision });
    expect(r.ok).toBe(false);
    expect(vision).not.toHaveBeenCalled();
  });

  it('activity 类型判定不烧一次 LLM', async () => {
    const vision = vi.fn();
    const r = await evaluatePostcondition(
      { type: 'foreground_activity', value: 'VideoRecordNewActivity' },
      {}, { currentFocus: () => FOCUS, vision });
    expect(r.ok).toBe(true);
    expect(vision).not.toHaveBeenCalled();
  });

  it('vision 类型仍走原来的视觉判定，不被这次改动改掉', async () => {
    const vision = vi.fn(async () => ({ ok: true, why: '看到了用户标签页' }));
    const r = await evaluatePostcondition(
      { type: 'vision', describe: '搜索 {target} 完成了吗？' },
      { target: 'langzi63485' }, { currentFocus: () => FOCUS, vision });
    expect(r.ok).toBe(true);
    expect(vision).toHaveBeenCalledTimes(1);
    // {target} 必须被替换，否则判定器看到的是占位符
    expect(vision.mock.calls[0][0]).toContain('langzi63485');
  });
});

describe('F1 step1 · registry 合并默认不覆盖已学坐标', () => {
  const existing = { search_entry: { x: 946, y: 75 }, tab_users: { x: 200, y: 300 } };

  it('已有 role 坐标不同 → 保留已有并告警（09-06 事故的守卫）', () => {
    const { merged, warnings } = mergeLocators(existing, { search_entry: { x: 537, y: 77 } });
    expect(merged.search_entry).toEqual({ x: 946, y: 75 });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('search_entry');
  });

  it('显式 --overwrite 才真覆盖', () => {
    const { merged } = mergeLocators(existing, { search_entry: { x: 537, y: 77 } }, { overwrite: true });
    expect(merged.search_entry).toEqual({ x: 537, y: 77 });
  });

  it('新 role 正常写入，不受保护影响', () => {
    const { merged, warnings } = mergeLocators(existing, { publish_button: { x: 500, y: 953 } });
    expect(merged.publish_button).toEqual({ x: 500, y: 953 });
    expect(merged.search_entry).toEqual({ x: 946, y: 75 });
    expect(warnings).toHaveLength(0);
  });

  it('坐标完全相同 → 不告警（重复学到同一个位置不是冲突）', () => {
    const { warnings } = mergeLocators(existing, { search_entry: { x: 946, y: 75 } });
    expect(warnings).toHaveLength(0);
  });
});
