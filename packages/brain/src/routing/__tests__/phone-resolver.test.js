/**
 * phone-resolver：按手机台账（phone_registry）把任务正文里的手机描述解析成唯一一台手机。
 * 决策 432172f7（方案 C）：映射是台账数据，代码只查表 + 核验 + 查不到退回；本文件的行只是测试夹具，
 * 生产数据以迁移 489 种子 + PUT /api/brain/phone-registry 为准。
 *
 * 0929 事故：任务写「小黄手机」「小彩手机（型号 MAA-AN00）」，agent 查不到昵称，卡住或用错手机。
 */
import { describe, it, expect } from 'vitest';
import { resolvePhone, hasDeviceLine, currentAccountOf, unresolvedNote } from '../phone-resolver.js';

const ROWS = [
  {
    serial: 'ANGYVB4311010223', nickname: '小彩', aliases: ['三号机', '小龙虾'], host: 'xian-m1', profile: 'xiaolongxia', model: 'MAA-AN00',
    douyin_accounts: [{ id: '90915521618', nickname: 'Ai办公室', current: true }, { id: null, nickname: '秦军餐饮', current: false }], enabled: true,
  },
  {
    serial: 'e6c7ef34', nickname: '小白', aliases: ['二号机'], host: 'xian-m1', profile: 'yueshengyun-work', model: 'RMX3478',
    douyin_accounts: [{ id: '37358506855', nickname: 'Ai效率笔记', current: true }, { id: null, nickname: '大湖成长之路（Ai+）', current: false }], enabled: true,
  },
  {
    serial: 'ANGYVB4402004137', nickname: '小黄', aliases: ['一号机'], host: 'xian-m4', profile: 'legacy', model: 'MAA-AN00',
    douyin_accounts: [{ id: '44997267357', nickname: '人工智能小诺考评', current: true }], enabled: true,
  },
  {
    serial: 'ANGYVB4227006983', nickname: '小蓝', aliases: ['四号机', '金诺机'], host: 'xian-m4', profile: 'jinoshengyuan-work', model: 'MAA-AN00',
    douyin_accounts: [{ id: 'langzi63485', nickname: '躺赢AI学姐', current: true }], enabled: true,
  },
  {
    serial: 'DISABLED0001', nickname: '小紫', aliases: ['五号机'], host: 'xian-m4', profile: 'retired', model: 'OLD-1',
    douyin_accounts: [{ id: '11112222333', nickname: '停用号', current: true }], enabled: false,
  },
];

const uniq = (text) => {
  const r = resolvePhone(text, ROWS);
  expect(r.status, `「${text}」应唯一命中，实际 ${JSON.stringify(r)}`).toBe('unique');
  return r;
};

describe('resolvePhone 唯一命中（各匹配方式一例）', () => {
  it('序列号子串 → 定案', () => {
    const r = uniq('用 ANGYVB4402004137 发一条视频');
    expect(r.phone.serial).toBe('ANGYVB4402004137');
    expect(r.matchedBy).toBe('serial');
  });

  it('昵称 + 手机 → 定案，account 取该机 current 号', () => {
    const r = uniq('用小黄手机给最新视频点赞');
    expect(r.phone.serial).toBe('ANGYVB4402004137');
    expect(r.matchedBy).toBe('nickname');
    expect(r.account).toMatchObject({ id: '44997267357', nickname: '人工智能小诺考评' });
  });

  it('别名（X号机）→ 定案', () => {
    const r = uniq('在一号机上发作品');
    expect(r.phone.serial).toBe('ANGYVB4402004137');
    expect(r.matchedBy).toBe('alias');
  });

  it('别名 + 手机（小龙虾手机）→ 定案', () => {
    expect(uniq('用小龙虾手机发朋友圈').phone.serial).toBe('ANGYVB4311010223');
  });

  it('「设备：」行里单写昵称也算', () => {
    const r = uniq('设备：小黄\n给最新视频点赞');
    expect(r.phone.serial).toBe('ANGYVB4402004137');
    expect(r.matchedBy).toBe('nickname');
  });

  it('【执行参数】块的 设备：别名 也算', () => {
    expect(uniq('【执行参数】\n执行Agent：media\n设备：小龙虾\n【执行参数结束】\n发一条').phone.serial).toBe('ANGYVB4311010223');
  });

  it('技术名（profile）→ 定案', () => {
    const r = uniq('用 --profile jinoshengyuan-work 跑一遍巡检');
    expect(r.phone.serial).toBe('ANGYVB4227006983');
    expect(r.matchedBy).toBe('profile');
    expect(uniq('设备：legacy\n点赞').phone.serial).toBe('ANGYVB4402004137');
  });

  it('抖音号 id → 定案，account 是命中的那个号', () => {
    const r = uniq('抖音号 90915521618 发一条作品');
    expect(r.phone.serial).toBe('ANGYVB4311010223');
    expect(r.matchedBy).toBe('douyin_id');
    expect(r.account).toMatchObject({ id: '90915521618', nickname: 'Ai办公室' });
    expect(uniq('给 langzi63485 发私信回复').phone.serial).toBe('ANGYVB4227006983');
  });

  it('抖音昵称 → 定案，account 是命中的非当前号', () => {
    const r = uniq('用「秦军餐饮」这个号发一条探店视频');
    expect(r.phone.serial).toBe('ANGYVB4311010223');
    expect(r.matchedBy).toBe('douyin_nickname');
    expect(r.account).toMatchObject({ id: null, nickname: '秦军餐饮', current: false });
  });

  it('0929 事故原文：小彩手机（型号 MAA-AN00）→ 昵称定案，不被型号带偏', () => {
    const r = uniq('用小彩手机（型号 MAA-AN00）发一条抖音');
    expect(r.phone.serial).toBe('ANGYVB4311010223');
    expect(r.matchedBy).toBe('nickname');
  });
});

describe('resolvePhone 不定案', () => {
  it('只写型号（多台同型号）→ ambiguous，候选 3 台，不定案', () => {
    const r = resolvePhone('用型号 MAA-AN00 的手机点赞', ROWS);
    expect(r.status).toBe('ambiguous');
    expect(r.phone).toBeNull();
    expect(r.matchedBy).toBe('model');
    expect(r.candidates.map((c) => c.serial).sort()).toEqual(['ANGYVB4227006983', 'ANGYVB4311010223', 'ANGYVB4402004137']);
  });

  it('型号只对上一台也不定案（型号不是身份）', () => {
    const r = resolvePhone('RMX3478 那台手机', ROWS);
    expect(r.status).toBe('ambiguous');
    expect(r.phone).toBeNull();
    expect(r.candidates.map((c) => c.serial)).toEqual(['e6c7ef34']);
  });

  it('同一层命中两台 → ambiguous', () => {
    const r = resolvePhone('小黄手机和小白手机各发一条', ROWS);
    expect(r.status).toBe('ambiguous');
    expect(r.candidates.map((c) => c.nickname).sort()).toEqual(['小白', '小黄']);
  });

  it('手机与抖音号指向不同手机 → ambiguous（不许拿小黄去发小彩的号）', () => {
    const r = resolvePhone('用小黄手机发到 Ai办公室', ROWS);
    expect(r.status).toBe('ambiguous');
    expect(r.candidates.map((c) => c.serial).sort()).toEqual(['ANGYVB4311010223', 'ANGYVB4402004137']);
  });

  it('disabled 行不命中（昵称/序列号/抖音号都不算）', () => {
    for (const t of ['用小紫手机点赞', '用 DISABLED0001 点赞', '抖音号 11112222333 发作品', '五号机上跑']) {
      expect(resolvePhone(t, ROWS).status, t).toBe('none');
    }
  });

  it('「小黄」误命中防护：无关词、正文里裸写不算', () => {
    for (const t of ['骑小黄车去拍视频', '做一张小黄鸭表情包', '让小黄负责周报', '小白也能学会的剪辑教程', '重构 legacy 代码']) {
      expect(resolvePhone(t, ROWS).status, t).toBe('none');
    }
  });

  it('什么都没写 → none', () => {
    const r = resolvePhone('写一段周报', ROWS);
    expect(r).toMatchObject({ status: 'none', phone: null, candidates: [] });
  });

  it('rows 缺省/非数组不抛', () => {
    expect(resolvePhone('小黄手机', undefined).status).toBe('none');
    expect(resolvePhone(null, ROWS).status).toBe('none');
  });
});

describe('辅助函数', () => {
  it('hasDeviceLine：正文或执行参数里有「设备：xxx」行', () => {
    expect(hasDeviceLine('设备：小黄')).toBe(true);
    expect(hasDeviceLine('标题\n  设备: 一号机\n正文')).toBe(true);
    expect(hasDeviceLine('设备：')).toBe(false);
    expect(hasDeviceLine('这台设备很好用')).toBe(false);
  });

  it('currentAccountOf：取 current=true 的抖音号，没有返回 null', () => {
    expect(currentAccountOf(ROWS[0])).toMatchObject({ id: '90915521618', nickname: 'Ai办公室' });
    expect(currentAccountOf({ douyin_accounts: [] })).toBeNull();
  });

  it('unresolvedNote：昵称清单来自台账（enabled 行），不写死', () => {
    const note = unresolvedNote(ROWS);
    expect(note).toMatch(/^⚠️ 手机未确定：请在正文写明手机昵称（.+）或抖音账号$/);
    for (const n of ['小彩', '小白', '小黄', '小蓝']) expect(note).toContain(n);
    expect(note).not.toContain('小紫');
    expect(unresolvedNote([{ nickname: '甲', enabled: true }])).toBe('⚠️ 手机未确定：请在正文写明手机昵称（甲）或抖音账号');
  });
});
