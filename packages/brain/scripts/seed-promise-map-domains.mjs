/**
 * MJ5 承诺地图打样域种子脚本
 * 刀1验收：两域账本 API 可查，与 V4 骨干规格对齐
 *
 * 打样域：
 *   1. Line04 智能客服（GP-B/C/D/E/F + 家③七底座件 + GP-B 四步完整格子）
 *   2. 首次成功路径（公司级，五步承诺 + 家②件引用）
 *
 * 用法: node packages/brain/scripts/seed-promise-map-domains.mjs [--dry-run]
 */

import 'dotenv/config';
import pg from 'pg';
import { DB_DEFAULTS } from '../src/db-config.js';

const DRY_RUN = process.argv.includes('--dry-run');
const { Pool } = pg;
const pool = new Pool(DB_DEFAULTS);

function log(msg) { console.log(`[seed] ${msg}`); }

async function upsertJourney(client, fields) {
  const { rows } = await client.query(
    `INSERT INTO journeys
       (name, journey_type, description, maturity, status, home, trigger, endpoint, notion_synced_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NULL)
     ON CONFLICT (name) DO UPDATE SET
       home=EXCLUDED.home, trigger=EXCLUDED.trigger, endpoint=EXCLUDED.endpoint,
       maturity=EXCLUDED.maturity, updated_at=NOW()
     RETURNING id, name`,
    [
      fields.name, fields.journey_type, fields.description || null,
      fields.maturity || 'thin', fields.status || 'active',
      fields.home, fields.trigger || null, fields.endpoint || null,
    ]
  );
  return rows[0];
}

async function upsertStep(client, journeyId, s) {
  const { rows } = await client.query(
    `INSERT INTO journey_steps
       (journey_id, name, step_number, description, status, promise, backbone_version, notion_synced_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,NULL)
     ON CONFLICT (journey_id, step_number) DO UPDATE SET
       name=EXCLUDED.name, promise=EXCLUDED.promise,
       backbone_version=EXCLUDED.backbone_version, updated_at=NOW()
     RETURNING id, name, promise`,
    [journeyId, s.name, s.step_number, s.description || null, s.status || 'planned',
     s.promise || null, s.backbone_version || '1.0']
  );
  return rows[0];
}

async function upsertFeature(client, fields) {
  const { rows } = await client.query(
    `INSERT INTO journey_features
       (name, journey_id, kind, thickness, status, softness, notion_synced_at)
     VALUES ($1,$2,$3,$4,$5,$6,NULL)
     ON CONFLICT (name) DO UPDATE SET
       journey_id=EXCLUDED.journey_id, softness=EXCLUDED.softness,
       thickness=EXCLUDED.thickness, updated_at=NOW()
     RETURNING id, name, softness`,
    [fields.name, fields.journey_id || null, fields.kind || 'feature',
     fields.thickness || 'thin', fields.status || 'planned', fields.softness || null]
  );
  return rows[0];
}

async function upsertCell(client, fields) {
  const { rows } = await client.query(
    `INSERT INTO journey_step_links
       (journey_id, step_id, step_order, status, feature_id,
        cell_kind, cell_status, assertion_ref, na_reason, notion_synced_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NULL)
     ON CONFLICT (journey_id, step_id) DO UPDATE SET
       feature_id=EXCLUDED.feature_id, cell_kind=EXCLUDED.cell_kind,
       cell_status=EXCLUDED.cell_status, assertion_ref=EXCLUDED.assertion_ref,
       na_reason=EXCLUDED.na_reason
     RETURNING id, cell_status, assertion_ref`,
    [fields.journey_id, fields.step_id, fields.step_order, fields.status || 'planned',
     fields.feature_id || null, fields.cell_kind || null, fields.cell_status || 'gray',
     fields.assertion_ref || null, fields.na_reason || null]
  );
  return rows[0];
}

// ─── 1. Line04 智能客服打样域 ─────────────────────────────────────────────────

async function seedLine04(client) {
  log('─── Line04 智能客服 ───');

  // Line04 主旅程
  const line04Journey = await upsertJourney(client, {
    name: 'Line04 智能客服',
    journey_type: 'user_facing',
    description: 'WeChat RPA 驱动的 AI 智能客服全流程（16步）',
    home: 'biz',
    trigger: '客户扫码绑定个人微信号',
    endpoint: '浮窗切换显示客户画像面板',
    maturity: 'thin',
  });
  log(`  Journey: ${line04Journey.name} (${line04Journey.id})`);

  // 家③ 七个底座件（工厂件，home=factory 挂在独立 factory journey 下）
  const factoryJourney = await upsertJourney(client, {
    name: 'Line04 底座（家③）',
    journey_type: 'autonomous',
    description: 'Line04 底层基础设施件集合（工厂家）',
    home: 'factory',
    trigger: '任何 Line04 功能初始化',
    endpoint: '七底座件全部 green',
    maturity: 'thin',
  });
  log(`  Factory Journey: ${factoryJourney.name} (${factoryJourney.id})`);

  const BASE_FEATURES = [
    { name: '微信 RPA 引擎',       kind: 'feature', softness: 'hard', thickness: 'thin' },
    { name: '登录态管理',           kind: 'feature', softness: 'hard', thickness: 'thin' },
    { name: 'CRM 联系人档案',       kind: 'feature', softness: 'hard', thickness: 'thin' },
    { name: '租户隔离框架',         kind: 'feature', softness: 'hard', thickness: 'thin' },
    { name: 'AI 回复生成内核',      kind: 'feature', softness: 'soft', thickness: 'thin' },
    { name: '浮窗渲染组件',         kind: 'feature', softness: 'hard', thickness: 'thin' },
    { name: '事件总线（events.jsonl）', kind: 'feature', softness: 'hard', thickness: 'thin' },
  ];

  const featureMap = {};
  for (const f of BASE_FEATURES) {
    const row = await upsertFeature(client, { ...f, journey_id: factoryJourney.id });
    featureMap[f.name] = row.id;
    log(`    底座件: ${row.name} (softness=${row.softness})`);
  }

  // 家② 绑定安装件
  const preJourney = await upsertJourney(client, {
    name: 'Line04 绑定安装（家②）',
    journey_type: 'user_facing',
    description: 'Line04 商家侧安装绑定前置路径（绑定家）',
    home: 'pre',
    trigger: '商家决定接入 AI 客服',
    endpoint: '客户端安装完成，登录态有效',
    maturity: 'thin',
  });
  const installFeature = await upsertFeature(client, {
    name: '客户端安装与注册',
    kind: 'feature', softness: 'hard', thickness: 'thin',
    journey_id: preJourney.id,
  });
  featureMap['客户端安装与注册'] = installFeature.id;
  log(`  Pre Journey: ${preJourney.name} (${preJourney.id})`);

  // GP-B：第一次AI回复价值闭环（Line04 最核心路径）
  const gpbJourney = await upsertJourney(client, {
    name: 'GP-B Line04 第一次AI回复闭环',
    journey_type: 'user_facing',
    description: 'GP-B：从消息触发到AI回复成功发出全流程（四步承诺）',
    home: 'biz',
    trigger: '联系人向绑定微信号发来消息',
    endpoint: '气泡可见/DB auto_sent 确认',
    maturity: 'thin',
  });

  const GPB_STEPS = [
    {
      step_number: 1, name: 'S1 消息接收与路由',
      promise: '消息到达后台，判断是否接管（白名单命中）',
      description: 'RPA 捕获消息事件，should_reply 决策',
      backbone_version: '1.0',
    },
    {
      step_number: 2, name: 'S2 记忆拉取与上下文组装',
      promise: '联系人历史对话记忆按租户隔离取出，注入 prompt',
      description: '调 /api/wechat/memory/context，租户隔离保证',
      backbone_version: '1.0',
    },
    {
      step_number: 3, name: 'S3 AI草稿生成',
      promise: '生成含 status 字段的回复草稿，人工/AI 分流决策完成',
      description: 'POST /api/wechat/draft-generate，返回 status',
      backbone_version: '1.0',
    },
    {
      step_number: 4, name: 'S4 回复发出与气泡确认',
      promise: 'AI 回复真实发出，气泡回执后 DB status=auto_sent',
      description: 'cs/outbound + receipt POST → DB 翻 auto_sent',
      backbone_version: '1.0',
    },
  ];

  const stepMap = {};
  for (const s of GPB_STEPS) {
    const row = await upsertStep(client, gpbJourney.id, s);
    stepMap[`S${s.step_number}`] = row.id;
    log(`    GP-B Step: ${row.name} | 承诺: ${row.promise}`);
  }

  // GP-B 四步完整格子（含底座件引用 + assertion_ref）
  const CELLS = [
    // S1: 微信RPA引擎(hard) + 事件总线(hard)
    { step: 'S1', step_order: 1, feature: '微信 RPA 引擎',
      cell_kind: '底座引用', cell_status: 'green',
      assertion_ref: 'tests/golden-path-4-smoke.sh:263-278' },
    { step: 'S1', step_order: 2, feature: '事件总线（events.jsonl）',
      cell_kind: '底座引用', cell_status: 'pending',
      assertion_ref: 'tests/golden-path-4-smoke.sh:378-405' },
    // S2: CRM联系人档案(hard) + 租户隔离框架(hard)
    { step: 'S2', step_order: 1, feature: 'CRM 联系人档案',
      cell_kind: '底座引用', cell_status: 'green',
      assertion_ref: 'tests/routes/crm-friend-scan-trigger.test.ts' },
    { step: 'S2', step_order: 2, feature: '租户隔离框架',
      cell_kind: '底座引用', cell_status: 'green',
      assertion_ref: 'tests/integration/p4-line04-cs-memory/tenant-memory.integration.test.ts' },
    // S3: AI回复生成内核(soft)
    { step: 'S3', step_order: 1, feature: 'AI 回复生成内核',
      cell_kind: '底座引用', cell_status: 'pending',
      assertion_ref: 'tests/ws3/draft-generate.test.ts' },
    // S4: 微信RPA引擎(hard) + 浮窗渲染(hard)
    { step: 'S4', step_order: 1, feature: '微信 RPA 引擎',
      cell_kind: '底座引用', cell_status: 'red',
      assertion_ref: 'manual: xian-rog 真机气泡确认' },
    { step: 'S4', step_order: 2, feature: '浮窗渲染组件',
      cell_kind: '底座引用', cell_status: 'pending',
      assertion_ref: 'tests/golden-path-4-smoke.sh:378-405' },
  ];

  for (const c of CELLS) {
    const cell = await upsertCell(client, {
      journey_id: gpbJourney.id,
      step_id: stepMap[c.step],
      step_order: c.step_order,
      feature_id: featureMap[c.feature],
      cell_kind: c.cell_kind,
      cell_status: c.cell_status,
      assertion_ref: c.assertion_ref,
    });
    log(`    格子 ${c.step}×${c.feature}: ${cell.cell_status} | ${cell.assertion_ref}`);
  }

  // GP-C/D/E/F（框架性，内容 thin=名称+承诺）
  const EXTRA_GPS = [
    { name: 'GP-C Line04 CRM 档案管理', trigger: '商家对联系人进行分级', endpoint: '联系人 A1-A5 状态可查' },
    { name: 'GP-D Line04 接管模式配置', trigger: '商家设置白名单/接管规则', endpoint: 'config GET回读一致' },
    { name: 'GP-E Line04 多客服负载均衡', trigger: '多 Agent 并行处理不同会话', endpoint: '无消息串话/重复发送' },
    { name: 'GP-F Line04 数据洞察报表', trigger: '主理人查看AI客服运营数据', endpoint: 'dashboard 指标可读' },
  ];
  for (const gp of EXTRA_GPS) {
    const row = await upsertJourney(client, {
      ...gp, journey_type: 'user_facing', home: 'biz', maturity: 'thin',
    });
    log(`  GP: ${row.name} (${row.id})`);
  }

  return { line04Journey, factoryJourney, featureMap, stepMap, gpbJourney };
}

// ─── 2. 首次成功路径 ──────────────────────────────────────────────────────────

async function seedFirstSuccess(client, installFeatureId) {
  log('─── 首次成功路径 ───');

  const fsJourney = await upsertJourney(client, {
    name: '首次成功路径',
    journey_type: 'user_facing',
    description: '公司级：新商家从零到第一次通过 AI 客服产生价值',
    home: 'biz',
    trigger: '商家决定接入 ZenithJoy AI 客服体系',
    endpoint: '商家在 Dashboard 上看到第一条 AI 回复已送达',
    maturity: 'thin',
  });
  log(`  Journey: ${fsJourney.name} (${fsJourney.id})`);

  const FS_STEPS = [
    {
      step_number: 1, name: 'S1 开通账号',
      promise: '商家注册成功，账号状态 active，可登录管理台',
      backbone_version: '1.0',
    },
    {
      step_number: 2, name: 'S2 装好连上',
      promise: 'Agent 客户端安装完成，微信已登录，后台监听已启动',
      backbone_version: '1.0',
    },
    {
      step_number: 3, name: 'S3 绑定资产',
      promise: '微信号与租户绑定，CRM 初始化，接管模式配置完成',
      backbone_version: '1.0',
    },
    {
      step_number: 4, name: 'S4 第一次 AI 价值（按线参数化）',
      promise: '收到第一条客户消息后，AI 回复成功送达（Line04=气泡/DB auto_sent）',
      backbone_version: '1.0',
    },
    {
      step_number: 5, name: 'S5 会看 Dashboard',
      promise: '商家在 Dashboard 上能看到 AI 客服运营关键指标',
      backbone_version: '1.0',
    },
  ];

  const stepMap = {};
  for (const s of FS_STEPS) {
    const row = await upsertStep(client, fsJourney.id, s);
    stepMap[`S${s.step_number}`] = row.id;
    log(`  Step: ${row.name} | 承诺: ${row.promise}`);
  }

  // S2 引用 家② 安装件
  if (installFeatureId) {
    const cell = await upsertCell(client, {
      journey_id: fsJourney.id,
      step_id: stepMap['S2'],
      step_order: 1,
      feature_id: installFeatureId,
      cell_kind: '底座引用',
      cell_status: 'pending',
      assertion_ref: 'tests/golden-path-2-smoke.sh:Step1-2',
    });
    log(`  格子 S2×安装件: ${cell.cell_status}`);
  }

  return { fsJourney, stepMap };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const client = await pool.connect();
  try {
    if (DRY_RUN) {
      log('DRY RUN mode — no writes');
      return;
    }
    await client.query('BEGIN');

    const { featureMap } = await seedLine04(client);
    await seedFirstSuccess(client, featureMap['客户端安装与注册']);

    await client.query('COMMIT');
    log('✅ 两域种子数据写入完成');
    log('验收：curl localhost:5221/api/brain/journeys | python3 -c "import json,sys; [print(j[\"name\"],j[\"home\"]) for j in json.load(sys.stdin)]"');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[seed] ERROR:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
