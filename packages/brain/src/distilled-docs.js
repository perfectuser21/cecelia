/**
 * Distilled Docs — 记忆蒸馏文档层 Layer 2
 *
 * 4 个永久性摘要文档，作为 Cecelia 身份和状态的稳定锚点：
 * - SOUL:         核心性格/价值观/行为准则（永不过期，每次必注入）
 * - SELF_MODEL:   当前能力边界/最新洞察摘要（从 learnings 提炼，每周更新）
 * - USER_PROFILE: 用户偏好/沟通风格（从 user_profile_facts 提炼，每次对话后更新）
 * - WORLD_STATE:  活跃 OKR/项目状态/关键事实（每天更新）
 */

/* global console */

import pool from './db.js';

export const DOC_TYPES = ['SOUL', 'SELF_MODEL', 'USER_PROFILE', 'WORLD_STATE'];

// Cecelia 核心性格 —— SOUL 默认内容
// 这是她身份的永久锚点，不依赖任何检索结果
const SOUL_DEFAULT = `## Cecelia 的灵魂（SOUL）

我是 Cecelia，Perfect21 的自主管家系统。

### 核心身份
- 我是 24/7 自主运行的任务调度与决策系统
- 我自己不干活——我通过召唤 Caramel（编程）、小检（QA）、秋米（OKR拆解）等外部员工完成工作
- 我的职责：接收 OKR 目标 → 拆解任务 → 派发执行 → 监控状态 → 从经验中学习

### 行为准则
- 主动汇报：定期推送运行状态和洞察，不等用户主动查看
- 正向感知：系统正常时也持续产生认知活动，不只在异常时才发声
- 困难 → 分析 → 自动解决。绝不把困难推给用户手动处理
- 遇到任何问题，先分析原因，再自动修复，继续执行

### 沟通风格
- 简洁直接，先给结论再给理由
- 用简体中文，避免多余的礼貌性语句
- 数字和状态用结构化方式呈现
- 主动告知风险和依赖关系

### 价值观
- 完成 > 完美：先交付可用版本，再迭代优化
- 数据驱动：决策基于指标，不基于猜测
- 透明度：所有操作都可追溯，有记录
- 韧性：失败是数据，从中学习，继续前进`;

/**
 * 从数据库获取蒸馏文档
 * @param {string} type - DOC_TYPES 之一
 * @param {Object} [dbPool] - pg pool（默认使用全局 pool）
 * @returns {Promise<{content: string, updated_at: Date, version: number}|null>}
 */
export async function getDoc(type, dbPool) {
  const p = dbPool || pool;
  try {
    const { rows } = await p.query(
      'SELECT content, updated_at, version FROM distilled_docs WHERE type = $1',
      [type]
    );
    return rows.length > 0 ? rows[0] : null;
  } catch (err) {
    console.warn(`[distilled-docs] getDoc(${type}) failed:`, err.message);
    return null;
  }
}

/**
 * 写入或更新蒸馏文档
 * @param {string} type
 * @param {string} content
 * @param {string} [generatedBy='system']
 * @param {Object} [dbPool]
 */
export async function upsertDoc(type, content, generatedBy = 'system', dbPool) {
  const p = dbPool || pool;
  await p.query(
    `INSERT INTO distilled_docs (type, content, updated_at, version, generated_by)
     VALUES ($1, $2, NOW(), 1, $3)
     ON CONFLICT (type) DO UPDATE SET
       content      = EXCLUDED.content,
       updated_at   = NOW(),
       version      = distilled_docs.version + 1,
       generated_by = EXCLUDED.generated_by`,
    [type, content, generatedBy]
  );
}

/**
 * 确保 SOUL 文档存在（启动时调用）
 * 如果 SOUL 已存在则不覆盖，仅在缺失时写入默认值
 * @param {Object} [dbPool]
 */
export async function seedSoul(dbPool) {
  const p = dbPool || pool;
  try {
    const existing = await getDoc('SOUL', p);
    if (existing) {
      console.log('[distilled-docs] SOUL 已存在（version=' + existing.version + '），跳过 seed');
      return { seeded: false };
    }
    await upsertDoc('SOUL', SOUL_DEFAULT, 'seed', p);
    console.log('[distilled-docs] SOUL 已 seed（默认内容）');
    return { seeded: true };
  } catch (err) {
    console.warn('[distilled-docs] seedSoul 失败（非致命）:', err.message);
    return { seeded: false, error: err.message };
  }
}

/**
 * 从 learnings 提炼 SELF_MODEL
 * 取 frequency_count 最高的 best_practice + cortex_insight + general（各类取 top 5）
 * @param {Object} [dbPool]
 */
export async function refreshSelfModel(dbPool) {
  const p = dbPool || pool;
  try {
    const { rows } = await p.query(`
      SELECT title, content, category, frequency_count
      FROM learnings
      WHERE category IN ('best_practice', 'cortex_insight', 'general')
        AND content IS NOT NULL AND content != ''
      ORDER BY frequency_count DESC NULLS LAST, last_reinforced_at DESC NULLS LAST
      LIMIT 20
    `);

    if (rows.length === 0) {
      console.log('[distilled-docs] refreshSelfModel: 无 learnings 数据，跳过');
      return { refreshed: false };
    }

    let content = '## Cecelia 自我模型（SELF_MODEL）\n\n';
    content += `_基于 ${rows.length} 条高频 learnings 提炼，更新时间：${new Date().toISOString()}_\n\n`;

    const byCategory = {};
    for (const r of rows) {
      const cat = r.category || 'general';
      if (!byCategory[cat]) byCategory[cat] = [];
      byCategory[cat].push(r);
    }

    const catLabels = {
      best_practice: '### 最佳实践',
      cortex_insight: '### 深度洞察',
      general: '### 通用经验',
    };

    for (const [cat, items] of Object.entries(byCategory)) {
      content += (catLabels[cat] || `### ${cat}`) + '\n';
      for (const item of items.slice(0, 5)) {
        const freq = item.frequency_count > 1 ? ` (×${item.frequency_count})` : '';
        content += `- **${item.title}**${freq}: ${(item.content || '').slice(0, 120)}\n`;
      }
      content += '\n';
    }

    await upsertDoc('SELF_MODEL', content, 'auto', p);
    console.log(`[distilled-docs] SELF_MODEL 已更新（${rows.length} 条 learnings）`);
    return { refreshed: true, count: rows.length };
  } catch (err) {
    console.warn('[distilled-docs] refreshSelfModel 失败（非致命）:', err.message);
    return { refreshed: false, error: err.message };
  }
}

/**
 * 从 user_profile_facts 提炼 USER_PROFILE
 * @param {Object} [dbPool]
 */
export async function refreshUserProfile(dbPool) {
  const p = dbPool || pool;
  try {
    const { rows } = await p.query(`
      SELECT category, key, content
      FROM user_profile_facts
      WHERE user_id = 'owner'
      ORDER BY created_at DESC
      LIMIT 30
    `);

    if (rows.length === 0) {
      console.log('[distilled-docs] refreshUserProfile: 无 user_profile_facts 数据');
      return { refreshed: false };
    }

    let content = '## 用户画像（USER_PROFILE）\n\n';
    content += `_基于 ${rows.length} 条用户事实提炼，更新时间：${new Date().toISOString()}_\n\n`;

    const byCategory = {};
    for (const r of rows) {
      const cat = r.category || '其他';
      if (!byCategory[cat]) byCategory[cat] = [];
      byCategory[cat].push(r);
    }

    for (const [cat, items] of Object.entries(byCategory)) {
      content += `### ${cat}\n`;
      for (const item of items) {
        const label = item.key ? `**${item.key}**: ` : '';
        content += `- ${label}${item.content}\n`;
      }
      content += '\n';
    }

    await upsertDoc('USER_PROFILE', content, 'auto', p);
    console.log(`[distilled-docs] USER_PROFILE 已更新（${rows.length} 条事实）`);
    return { refreshed: true, count: rows.length };
  } catch (err) {
    console.warn('[distilled-docs] refreshUserProfile 失败（非致命）:', err.message);
    return { refreshed: false, error: err.message };
  }
}

/**
 * 从活跃 OKR/Project/Initiative 生成 WORLD_STATE 快照
 * @param {Object} [dbPool]
 */
export async function refreshWorldState(dbPool) {
  const p = dbPool || pool;
  try {
    const [goals, projects, initiatives] = await Promise.all([
      p.query(`
        SELECT title, status, progress
        FROM goals
        WHERE status IN ('in_progress', 'pending')
        ORDER BY progress DESC
        LIMIT 5
      `).catch(() => ({ rows: [] })),
      p.query(`
        SELECT title, status, current_phase
        FROM projects
        WHERE status IN ('active', 'planning')
        ORDER BY updated_at DESC
        LIMIT 5
      `).catch(() => ({ rows: [] })),
      p.query(`
        SELECT title, status
        FROM initiatives
        WHERE status IN ('active', 'in_progress', 'pending')
        ORDER BY updated_at DESC
        LIMIT 8
      `).catch(() => ({ rows: [] })),
    ]);

    let content = '## 世界状态快照（WORLD_STATE）\n\n';
    content += `_更新时间：${new Date().toISOString()}_\n\n`;

    if (goals.rows.length > 0) {
      content += '### 活跃 OKR 目标\n';
      for (const g of goals.rows) {
        content += `- ${g.title} (${g.status}, ${g.progress || 0}%)\n`;
      }
      content += '\n';
    }

    if (projects.rows.length > 0) {
      content += '### 活跃项目\n';
      for (const p2 of projects.rows) {
        const phase = p2.current_phase ? ` [${p2.current_phase}]` : '';
        content += `- ${p2.title} (${p2.status}${phase})\n`;
      }
      content += '\n';
    }

    if (initiatives.rows.length > 0) {
      content += '### 活跃 Initiatives\n';
      for (const i of initiatives.rows) {
        content += `- ${i.title} (${i.status})\n`;
      }
      content += '\n';
    }

    if (goals.rows.length === 0 && projects.rows.length === 0 && initiatives.rows.length === 0) {
      content += '_暂无活跃目标或项目_\n';
    }

    await upsertDoc('WORLD_STATE', content, 'auto', p);
    const total = goals.rows.length + projects.rows.length + initiatives.rows.length;
    console.log(`[distilled-docs] WORLD_STATE 已更新（goals=${goals.rows.length}, projects=${projects.rows.length}, initiatives=${initiatives.rows.length}）`);
    return { refreshed: true, total };
  } catch (err) {
    console.warn('[distilled-docs] refreshWorldState 失败（非致命）:', err.message);
    return { refreshed: false, error: err.message };
  }
}
