/**
 * 测试夹具：phone_registry 行（DB 形状，snake_case）。只给单测用——生产映射是台账数据
 * （迁移 490 种子 + PUT /api/brain/phone-registry），代码里不写任何一台手机（决策 432172f7）。
 */
export const REGISTRY_ROWS = Object.freeze([
  {
    serial: 'ANGYVB4311010223', nickname: '小彩', aliases: ['三号机', '小龙虾'], host: 'xian-m1', profile: 'xiaolongxia', model: 'MAA-AN00',
    douyin_accounts: [{ id: '90915521618', nickname: 'Ai办公室', current: true }, { id: null, nickname: '秦军餐饮', current: false }], enabled: true,
  },
  {
    serial: 'e6c7ef34', nickname: '小白', aliases: ['二号机'], host: 'xian-m1', profile: 'yueshengyun-work', model: 'RMX3478',
    douyin_accounts: [{ id: '37358506855', nickname: 'Ai效率笔记', current: true }], enabled: true,
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
    douyin_accounts: [], enabled: false,
  },
]);
