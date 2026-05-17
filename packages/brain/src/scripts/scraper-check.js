/**
 * scraper-check.js
 *
 * 数据采集通路可用性验证脚本。
 *
 * 验证以下4平台的采集链路是否就绪：
 *   - 微博 (weibo)：CDP 端口 19227 @ 100.97.242.124
 *   - 小红书 (xiaohongshu)：CDP 端口 19224 @ 100.97.242.124
 *   - 抖音 (douyin)：CDP 端口 19222 @ 100.97.242.124
 *   - 公众号 (wechat)：CDP 端口 19230 @ 100.97.242.124
 *
 * 验证方式（降级策略）：
 *   1. 检查 content_analytics 表中各平台最近7天的数据条数（有数据 = 采集链路历史可用）
 *   2. 检查 content_master 表中各平台总数据量
 *   3. 报告结果
 *
 * 运行方式：
 *   node packages/brain/src/scripts/scraper-check.js
 *
 * 无 DB 离线模式（传入 --dry-run）：
 *   node packages/brain/src/scripts/scraper-check.js --dry-run
 */

// ─── 平台配置 ─────────────────────────────────────────────────────────────────

export const PLATFORM_CONFIG = [
  { id: 'weibo', name: '微博', cdpPort: 19227, scraper: 'scraper-weibo-v3.js' },
  { id: 'xiaohongshu', name: '小红书', cdpPort: 19224, scraper: 'scraper-xiaohongshu-v3.js' },
  { id: 'douyin', name: '抖音', cdpPort: 19222, scraper: 'scraper-douyin-v3.js' },
  { id: 'wechat', name: '公众号', cdpPort: 19230, scraper: 'scraper-wechat-v3.js' },
];

const CN_MAC_MINI_HOST = '100.97.242.124';

// ─── 数据库检查 ───────────────────────────────────────────────────────────────

/**
 * 查询各平台在 content_analytics 中最近7天的数据条数。
 *
 * @param {import('pg').Pool} pool
 * @returns {Promise<Record<string, { recentCount: number, totalCount: number, lastCollectedAt: Date|null }>>}
 */
export async function queryPlatformDataStats(pool) {
  const { rows } = await pool.query(`
    SELECT
      platform,
      COUNT(*) FILTER (WHERE collected_at > NOW() - INTERVAL '7 days') AS recent_count,
      COUNT(*) AS total_count,
      MAX(collected_at) AS last_collected_at
    FROM content_analytics
    WHERE platform = ANY($1)
    GROUP BY platform
  `, [PLATFORM_CONFIG.map((p) => p.id)]);

  const result = {};
  for (const p of PLATFORM_CONFIG) {
    const row = rows.find((r) => r.platform === p.id);
    result[p.id] = {
      recentCount: parseInt(row?.recent_count ?? 0, 10),
      totalCount: parseInt(row?.total_count ?? 0, 10),
      lastCollectedAt: row?.last_collected_at ?? null,
    };
  }
  return result;
}

/**
 * 判断平台状态。
 *
 * @param {{ recentCount: number, totalCount: number }} stats
 * @returns {'ok' | 'stale' | 'empty'}
 */
export function evaluatePlatformStatus(stats) {
  if (stats.recentCount > 0) return 'ok';
  if (stats.totalCount > 0) return 'stale';
  return 'empty';
}

// ─── 报告输出 ─────────────────────────────────────────────────────────────────

function formatLastCollect(date) {
  if (!date) return '从未';
  const d = new Date(date);
  return d.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
}

function statusIcon(status) {
  return { ok: '✅', stale: '⚠️', empty: '❌' }[status] ?? '❓';
}

export function printReport(platformStats) {
  console.log('\n========================================');
  console.log('  数据采集通路可用性报告');
  console.log(`  CN Mac mini: ${CN_MAC_MINI_HOST}`);
  console.log('========================================\n');

  let allOk = true;
  let staleCount = 0;

  for (const p of PLATFORM_CONFIG) {
    const stats = platformStats[p.id] ?? { recentCount: 0, totalCount: 0, lastCollectedAt: null };
    const status = evaluatePlatformStatus(stats);
    const icon = statusIcon(status);

    if (status !== 'ok') allOk = false;
    if (status === 'stale') staleCount++;

    const lastCollect = formatLastCollect(stats.lastCollectedAt);
    console.log(`${icon} ${p.name.padEnd(4)}（${p.id}）`);
    console.log(`   CDP端口: ${CN_MAC_MINI_HOST}:${p.cdpPort} | 采集器: ${p.scraper}`);
    console.log(`   近7天: ${stats.recentCount} 条 | 历史总量: ${stats.totalCount} 条 | 最近采集: ${lastCollect}`);
    console.log();
  }

  console.log('----------------------------------------');
  if (allOk) {
    console.log('✅ 全部4平台近7天均有数据，采集链路正常');
  } else if (staleCount > 0) {
    console.log('⚠️  部分平台数据超过7天未更新，建议手动触发采集');
    console.log('   → 触发方式: N8N > data-collection workflow > Execute Workflow');
  } else {
    console.log('❌ 部分平台无历史数据，需检查采集器是否初始化');
    console.log(`   → 检查 CN Mac mini (${CN_MAC_MINI_HOST}) 的 CDP 端口是否开启`);
  }
  console.log('========================================\n');

  return { allOk, platforms: platformStats };
}

// ─── 离线 Demo 模式 ──────────────────────────────────────────────────────────

function runDryRun() {
  console.log('\n[DRY-RUN 模式] 使用模拟数据\n');

  const mockStats = {
    weibo: { recentCount: 45, totalCount: 151, lastCollectedAt: new Date(Date.now() - 2 * 3600000) },
    xiaohongshu: { recentCount: 32, totalCount: 80, lastCollectedAt: new Date(Date.now() - 5 * 3600000) },
    douyin: { recentCount: 58, totalCount: 120, lastCollectedAt: new Date(Date.now() - 1 * 3600000) },
    wechat: { recentCount: 0, totalCount: 20, lastCollectedAt: new Date(Date.now() - 10 * 86400000) },
  };

  printReport(mockStats);
  return mockStats;
}

// ─── 主函数 ──────────────────────────────────────────────────────────────────

async function main() {
  const isDryRun = process.argv.includes('--dry-run');

  if (isDryRun) {
    runDryRun();
    return;
  }

  const { default: pg } = await import('pg');
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/cecelia',
  });

  try {
    const stats = await queryPlatformDataStats(pool);
    printReport(stats);
  } catch (err) {
    console.error('❌ 数据库连接失败:', err.message);
    console.error('   提示: 使用 --dry-run 在无数据库环境下验证脚本可用性');
    process.exit(1);
  } finally {
    await pool.end();
  }
}

const isMain = process.argv[1]?.endsWith('scraper-check.js');
if (isMain) {
  main();
}
