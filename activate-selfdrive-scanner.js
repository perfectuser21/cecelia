/**
 * SelfDrive Scanner 识别规则修正任务激活器
 *
 * 功能：
 * 1. 将 queued 状态的 [SelfDrive] 任务转为 active
 * 2. 验证 Scanner 识别规则库的完整性
 * 3. 生成准确的能力地图，区分内嵌能力和孤立能力
 */

import pool from './packages/brain/src/db.js';
import { scanCapabilities } from './packages/brain/src/capability-scanner.js';

/**
 * 激活排队的 SelfDrive 任务
 */
async function activateQueuedSelfDriveTasks() {
  console.log('[Scanner Activator] 查询 queued 状态的 SelfDrive 任务...');

  try {
    // 查询 queued 状态的 SelfDrive 任务
    const result = await pool.query(
      `SELECT id, title FROM tasks
       WHERE status = 'queued'
         AND title LIKE '%[SelfDrive]%'
       ORDER BY queued_at DESC`
    );

    if (result.rows.length === 0) {
      console.log('[Scanner Activator] 没有找到 queued 状态的 SelfDrive 任务');
      return { activated: 0, tasks: [] };
    }

    console.log(`[Scanner Activator] 找到 ${result.rows.length} 个 queued 任务:`);
    result.rows.forEach(task => {
      console.log(`  - ${task.title} (${task.id})`);
    });

    // 将状态更新为 active
    const updateResult = await pool.query(
      `UPDATE tasks
       SET status = 'active', updated_at = NOW()
       WHERE status = 'queued'
         AND title LIKE '%[SelfDrive]%'
       RETURNING id, title`
    );

    console.log(`[Scanner Activator] ✅ 已激活 ${updateResult.rows.length} 个任务:`);
    updateResult.rows.forEach(task => {
      console.log(`  - ${task.title} (${task.id})`);
    });

    return {
      activated: updateResult.rows.length,
      tasks: updateResult.rows
    };

  } catch (error) {
    console.error('[Scanner Activator] 激活任务失败:', error.message);
    throw error;
  }
}

/**
 * 验证 Scanner 识别规则库完整性
 */
async function validateScannerRules() {
  console.log('[Scanner Activator] 验证 Scanner 识别规则库...');

  try {
    // 运行完整的能力扫描
    const scanResult = await scanCapabilities();

    const { capabilities, summary } = scanResult;

    console.log('[Scanner Activator] 扫描结果:');
    console.log(`  - 总能力数: ${summary.total}`);
    console.log(`  - 活跃: ${summary.active}`);
    console.log(`  - 休眠: ${summary.dormant}`);
    console.log(`  - 孤岛: ${summary.island}`);
    console.log(`  - 失败: ${summary.failing}`);

    // 验证内嵌能力识别
    const embeddedCapabilities = capabilities.filter(cap =>
      cap.evidence.some(ev => ev.includes('brain_embedded:true'))
    );

    console.log(`[Scanner Activator] ✅ 识别到 ${embeddedCapabilities.length} 个内嵌能力:`);
    embeddedCapabilities.forEach(cap => {
      console.log(`  - ${cap.name} (${cap.status})`);
    });

    // 验证孤岛能力识别
    const islandCapabilities = capabilities.filter(cap => cap.status === 'island');

    console.log(`[Scanner Activator] ✅ 识别到 ${islandCapabilities.length} 个孤岛能力:`);
    islandCapabilities.forEach(cap => {
      console.log(`  - ${cap.name} (stage=${cap.stage})`);
    });

    return {
      total: summary.total,
      embedded_capabilities: embeddedCapabilities,
      isolated_capabilities: islandCapabilities,
      summary
    };

  } catch (error) {
    console.error('[Scanner Activator] 验证规则库失败:', error.message);
    throw error;
  }
}

/**
 * 生成能力地图查询接口
 */
async function generateCapabilityMap() {
  console.log('[Scanner Activator] 生成能力地图...');

  try {
    const scanResult = await scanCapabilities();

    const capabilityMap = {
      timestamp: new Date().toISOString(),
      summary: scanResult.summary,
      embedded_capabilities: scanResult.capabilities
        .filter(cap => cap.evidence.some(ev => ev.includes('brain_embedded:true')))
        .map(cap => ({
          id: cap.id,
          name: cap.name,
          status: cap.status,
          evidence: cap.evidence
        })),
      isolated_capabilities: scanResult.capabilities
        .filter(cap => cap.status === 'island')
        .map(cap => ({
          id: cap.id,
          name: cap.name,
          stage: cap.stage,
          scope: cap.scope,
          status: cap.status
        })),
      all_capabilities: scanResult.capabilities.map(cap => ({
        id: cap.id,
        name: cap.name,
        status: cap.status,
        stage: cap.stage,
        last_activity: cap.last_activity,
        usage_30d: cap.usage_30d
      }))
    };

    console.log('[Scanner Activator] ✅ 能力地图生成完成');
    console.log(`  - 内嵌能力: ${capabilityMap.embedded_capabilities.length}`);
    console.log(`  - 孤立能力: ${capabilityMap.isolated_capabilities.length}`);
    console.log(`  - 总能力数: ${capabilityMap.all_capabilities.length}`);

    return capabilityMap;

  } catch (error) {
    console.error('[Scanner Activator] 生成能力地图失败:', error.message);
    throw error;
  }
}

/**
 * 主函数 - 执行完整的 Scanner 识别规则修正
 */
async function main() {
  console.log('[Scanner Activator] 开始执行 Scanner 识别规则修正...');

  try {
    // 1. 激活排队的 SelfDrive 任务
    const activationResult = await activateQueuedSelfDriveTasks();

    // 2. 验证 Scanner 识别规则库
    const validationResult = await validateScannerRules();

    // 3. 生成能力地图
    const capabilityMap = await generateCapabilityMap();

    console.log('\n[Scanner Activator] ✅ 任务完成摘要:');
    console.log(`  - 激活任务数: ${activationResult.activated}`);
    console.log(`  - 内嵌能力识别: ${validationResult.embedded_capabilities.length} 个`);
    console.log(`  - 孤岛能力识别: ${validationResult.isolated_capabilities.length} 个`);
    console.log(`  - 能力地图已生成`);

    return {
      success: true,
      activation: activationResult,
      validation: validationResult,
      capability_map: capabilityMap
    };

  } catch (error) {
    console.error('[Scanner Activator] 执行失败:', error.message);
    return {
      success: false,
      error: error.message
    };
  }
}

// 如果作为脚本运行
if (import.meta.url === `file://${process.argv[1]}`) {
  main().then(result => {
    console.log('\n[Scanner Activator] 最终结果:', JSON.stringify(result, null, 2));
    process.exit(result.success ? 0 : 1);
  });
}

export { activateQueuedSelfDriveTasks, validateScannerRules, generateCapabilityMap, main };