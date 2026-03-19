/**
 * 种子脚本：为 zenithjoy 3 个 KR 各创建 3 个 Initiative（共 9 个）
 *
 * 幂等：按 name + kr_id 唯一键检查，已存在则跳过
 *
 * 用途：OKR 拆解冻结自救方案（Plan B）
 * 相关 PR：https://github.com/your-org/cecelia/pulls
 *
 * 运行方式：node packages/brain/scripts/seed-zenithjoy-initiatives.mjs
 */

import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  user: process.env.DB_USER || 'cecelia',
  database: process.env.DB_NAME || 'cecelia',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
});

// zenithjoy KR IDs
const KR_IDS = {
  KR1_PUBLISH: 'd947e4c7-815e-454c-a8fb-0aa79d8024fb',   // KR1: 发布自动化
  KR2_COLLECT: '3e3f713f-8ecb-429d-abc1-8018d308c7b5',   // KR2: 数据采集
  KR3_CONTENT: 'fedab43c-a8b8-428c-bcc1-6aad6e6210fc',  // KR3: 内容生成
};

// 9 个 Initiative 定义
const INITIATIVES = [
  // KR1: 发布自动化 — 8平台发布率从30%提升至100%
  {
    name: '短视频平台发布（抖音/快手/小红书）',
    kr_id: KR_IDS.KR1_PUBLISH,
    description: '实现抖音、快手、小红书 3 个短视频平台的全自动发布流水线。' +
      '覆盖视频上传、标题/话题设置、定时发布、发布状态回调。目标：发布成功率 ≥ 98%。',
    decomposition_mode: 'known',
    execution_mode: 'simple',
  },
  {
    name: '图文平台发布（知乎/公众号/头条）',
    kr_id: KR_IDS.KR1_PUBLISH,
    description: '实现知乎、微信公众号、今日头条 3 个图文平台的全自动发布。' +
      '覆盖富文本格式适配、图片上传、发布确认、错误重试。目标：发布成功率 ≥ 98%。',
    decomposition_mode: 'known',
    execution_mode: 'simple',
  },
  {
    name: '其他平台发布（微博/视频号）',
    kr_id: KR_IDS.KR1_PUBLISH,
    description: '实现微博、微信视频号 2 个平台的全自动发布。' +
      '覆盖内容格式转换、平台账号授权保活、发布结果验证。目标：发布成功率 ≥ 98%。',
    decomposition_mode: 'known',
    execution_mode: 'simple',
  },

  // KR2: 数据采集 — 8平台日常数据采集从0%提升至100%
  {
    name: '播放/点赞数据采集（全8平台）',
    kr_id: KR_IDS.KR2_COLLECT,
    description: '为 8 个平台（抖音/快手/小红书/知乎/公众号/头条/微博/视频号）建立播放量、点赞数、评论数、转发数的日常采集管道。' +
      '每 6 小时采集一次，数据写入 TimescaleDB。',
    decomposition_mode: 'known',
    execution_mode: 'simple',
  },
  {
    name: '粉丝数据采集（全8平台）',
    kr_id: KR_IDS.KR2_COLLECT,
    description: '为 8 个平台建立粉丝数、新增粉丝、取关数的每日采集管道。' +
      '跟踪粉丝增长曲线，识别异常波动，数据写入 TimescaleDB 并触发飞书日报推送。',
    decomposition_mode: 'known',
    execution_mode: 'simple',
  },
  {
    name: '数据入库+验证（关系映射、数据完整性）',
    kr_id: KR_IDS.KR2_COLLECT,
    description: '建立采集数据的校验、去重、补偿机制：平台内容 ID ↔ Cecelia 内容 ID 关系映射、' +
      '缺失数据补采、数据完整性验证报告。目标：数据缺失率 < 1%。',
    decomposition_mode: 'known',
    execution_mode: 'simple',
  },

  // KR3: 内容生成 — AI内容生产自动化从20%提升至100%
  {
    name: '选题+文案自动化（AI 驱动）',
    kr_id: KR_IDS.KR3_CONTENT,
    description: 'AI 驱动的内容选题系统：基于热点话题分析 + 账号画像，自动生成内容选题建议、' +
      '标题备选列表、正文草稿。每日输出 ≥ 10 个可用选题，人工介入时间 = 0。',
    decomposition_mode: 'known',
    execution_mode: 'simple',
  },
  {
    name: '素材组装+格式化（多媒体）',
    kr_id: KR_IDS.KR3_CONTENT,
    description: '自动化素材处理流水线：NAS 素材库读取 → 视频剪辑/封面生成 → 多平台格式转换（竖屏/横屏/图文）。' +
      '目标：单条内容组装时间 < 5 分钟，无人工介入。',
    decomposition_mode: 'known',
    execution_mode: 'simple',
  },
  {
    name: '发布流程集成（端到端）',
    kr_id: KR_IDS.KR3_CONTENT,
    description: '将内容生成与发布平台全流程打通：内容生成→审核→多平台同步发布的端到端自动化流水线。' +
      '支持定时发布、A/B 测试分发、发布结果回传 Brain。',
    decomposition_mode: 'known',
    execution_mode: 'simple',
  },
];

async function seedInitiatives() {
  console.log('🌱 zenithjoy Initiative 种子脚本启动...');
  console.log(`  目标：创建 ${INITIATIVES.length} 个 Initiative\n`);

  let created = 0;
  let skipped = 0;

  for (const initiative of INITIATIVES) {
    // 幂等检查：按 name + kr_id 查重
    const existing = await pool.query(
      `SELECT id FROM projects WHERE name = $1 AND kr_id = $2 AND type = 'initiative'`,
      [initiative.name, initiative.kr_id]
    );

    if (existing.rows.length > 0) {
      console.log(`  ⏭️  跳过（已存在）: ${initiative.name}`);
      skipped++;
      continue;
    }

    // 插入新 Initiative
    const result = await pool.query(
      `INSERT INTO projects (name, kr_id, description, type, status, decomposition_mode, execution_mode)
       VALUES ($1, $2, $3, 'initiative', 'pending', $4, $5)
       RETURNING id`,
      [
        initiative.name,
        initiative.kr_id,
        initiative.description,
        initiative.decomposition_mode,
        initiative.execution_mode,
      ]
    );

    const newId = result.rows[0].id;
    console.log(`  ✅ 创建: ${initiative.name}`);
    console.log(`     ID: ${newId}`);
    console.log(`     KR: ${initiative.kr_id}`);
    created++;
  }

  console.log(`\n📊 结果：创建 ${created} 个，跳过 ${skipped} 个（已存在）`);

  // 验证最终状态
  const countResult = await pool.query(`
    SELECT kr_id, COUNT(*) as cnt
    FROM projects
    WHERE type = 'initiative'
      AND kr_id IN ($1, $2, $3)
    GROUP BY kr_id
    ORDER BY kr_id
  `, [KR_IDS.KR1_PUBLISH, KR_IDS.KR2_COLLECT, KR_IDS.KR3_CONTENT]);

  const totalResult = await pool.query(`
    SELECT COUNT(*) as total
    FROM projects
    WHERE type = 'initiative'
      AND kr_id IN ($1, $2, $3)
  `, [KR_IDS.KR1_PUBLISH, KR_IDS.KR2_COLLECT, KR_IDS.KR3_CONTENT]);

  const total = parseInt(totalResult.rows[0].total, 10);

  console.log('\n📋 各 KR Initiative 数量：');
  for (const row of countResult.rows) {
    const krName = Object.entries(KR_IDS).find(([, v]) => v === row.kr_id)?.[0] || row.kr_id;
    console.log(`  ${krName}: ${row.cnt} 个`);
  }
  console.log(`\n  合计：${total} 个 Initiative`);

  if (total < 9) {
    console.error(`\n❌ 验证失败：期望 ≥ 9，实际 ${total}`);
    process.exit(1);
  }

  console.log('\n✅ 种子脚本完成！zenithjoy 派发冻结已解除。');
  console.log('   下次 Tick 将自动激活 Initiative 并派发 Task。');
}

seedInitiatives()
  .catch(err => {
    console.error('❌ 种子脚本失败:', err.message);
    process.exit(1);
  })
  .finally(() => pool.end());
