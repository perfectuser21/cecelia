import { describe, it, expect } from 'vitest';
import { parseNotionPhone, planPhoneChanges } from '../phone-registry-content.js';
const rich = s => ({ rich_text: [{ plain_text: s }] });
const page = (over = {}) => ({ id: 'notion-one', properties: {
  '类型': { select: { name: '安卓手机' } }, '序列号': rich('SER1'),
  '名称': { title: [{ plain_text: '小测（一号机）' }] }, '归属': { select: { name: '研发' } },
  '账号': rich('抖音：测试号(123456)【当前】；副号：副号（Ai+） ｜ 微信：微信昵称(wxid_abc)'),
  '备注': rich('研发机 · 技术名 malicious-new-profile'),
  '绑定Worker': rich('未知Worker'), '在线状态': { select: { name: '离线' } },
  '电量': { number: 0 }, ...over,
} });
const row = { serial: 'SER1', nickname: '旧名', aliases: ['保留别名'], owner: '旧归属', role: '生产',
  host: 'xian-m1', profile: 'real-profile', model: 'REAL', enabled: true,
  douyin_accounts: [{ id: 'secondary-id', nickname: '副号（Ai+）', current: false }], wechat: null };
describe('设备清单人写字段入口', () => {
  it('拆昵称、别名、当前/副号及微信；不接受镜子或备注里的技术路由', () => {
    const parsed = parseNotionPhone(page(), row);
    expect(parsed.fields).toMatchObject({ nickname: '小测', aliases: ['保留别名', '一号机'], owner: '研发', role: '研发',
      douyin_accounts: [{ id: '123456', nickname: '测试号', current: true }, { id: 'secondary-id', nickname: '副号（Ai+）', current: false }],
      wechat: { id: 'wxid_abc', nickname: '微信昵称' } });
    for (const key of ['host','profile','model','enabled','电量','在线状态']) expect(parsed.fields).not.toHaveProperty(key);
  });
  it('微信未登录明确清空；抖音唯一标记识别当前', () => {
    expect(parseNotionPhone(page({ '账号': rich('抖音：唯一号(alpha_123)【唯一】 ｜ 微信：未登录（登录页 任意）') }), row).fields)
      .toMatchObject({ douyin_accounts: [{ id: 'alpha_123', nickname: '唯一号', current: true }], wechat: null });
  });
  it('明确清空账号与归属，不把缺失列当清空', () => {
    expect(parseNotionPhone(page({ '账号': rich(''), '归属': { select: null } }), row).fields)
      .toMatchObject({ douyin_accounts: [], wechat: null, owner: null });
    const p = page(); delete p.properties['账号']; delete p.properties['归属'];
    const fields = parseNotionPhone(p, row).fields;
    expect(fields).not.toHaveProperty('douyin_accounts'); expect(fields).not.toHaveProperty('owner');
  });
  it('不明账号语法和TSV换行注入拒绝整行', () => {
    expect(() => parseNotionPhone(page({ '账号': rich('未知：随便猜') }), row)).toThrow(/账号/);
    expect(() => parseNotionPhone(page({ '名称': { title: [{ plain_text: '小测\tOTHER' }] } }), row)).toThrow();
  });
  it('非手机记录不参加同步', () => expect(parseNotionPhone(page({ '类型': { select: { name: 'Mac' } } }), row)).toBeNull());
});
describe('逐字段人写内容基线', () => {
  it('首次无基线回灌并保留被覆盖值，未动技术元数据', () => {
    const out = planPhoneChanges([page()], [row]);
    expect(out.changes).toHaveLength(1); expect(out.changes[0].before.nickname).toBe('旧名');
    expect(out.changes[0].fields.nickname).toBe('小测'); expect(out.changes[0].fields).not.toHaveProperty('profile');
    expect(out.baselines.SER1).toBeTruthy();
  });
  it('Notion内容未改而DB改过，镜子心跳变化不覆盖DB', () => {
    const first = planPhoneChanges([page()], [row]);
    const edited = { ...row, ...first.changes[0].fields, nickname: 'DB后改', owner: 'DB后归属' };
    const p = page(); p.last_edited_time = '2030-01-01'; p.properties['电量'].number = 90;
    const out = planPhoneChanges([p], [edited], first.baselines);
    expect(out.changes).toEqual([]);
  });
  it('Notion只改归属时，不覆盖DB后来改的昵称', () => {
    const first = planPhoneChanges([page()], [row]);
    const edited = { ...row, ...first.changes[0].fields, nickname: 'DB后改' };
    const p = page({ '归属': { select: { name: '新归属' } } });
    const out = planPhoneChanges([p], [edited], first.baselines);
    expect(out.changes[0].fields).toEqual({ owner: '新归属' });
  });
  it('重复序列号的全部记录与未知序列号隔离，不按顺序取赢家', () => {
    const p2 = { ...page(), id: 'notion-two' }; const p3 = page({ '序列号': rich('UNKNOWN') });
    const out = planPhoneChanges([page(),p2,p3], [row]);
    expect(out.changes).toEqual([]); expect(out.invalid).toHaveLength(3);
  });
});
