/**
 * Unified Intent Router - 统一意图路由层
 *
 * 所有意图（欲望/聊天/Cortex）经过 /plan 识别层级后，
 * 通过这个路由层决定下一步动作：
 * - Layer 1-4: OKR/KR/Project → 秋米拆解 (/autumnrice)
 * - Layer 5-6: Initiative/Task → 直接 /dev
 *
 * 这是三条路径的汇聚点。
 */

/* global console */

/**
 * 根据 task_layer 路由到对应的处理器
 * @param {Object} intent - 意图对象，包含识别结果
 * @param {string} intent.task_layer - 层级标识（Layer 1-6）
 * @param {string} intent.content - 意图内容
 * @param {string} intent.source - 意图来源（desire/chat/cortex）
 * @returns {Promise<{action: string, skill: string, params: Object}>} 路由结果
 */
export async function routeByTaskLayer(intent) {
  const { task_layer, content, source } = intent;

  // 验证输入
  if (!task_layer) {
    console.warn('[unified-intent-router] Missing task_layer, fallback to Layer 5');
    return {
      action: 'execute',
      skill: '/dev',
      params: { description: content, source }
    };
  }

  // 提取层级数字（Layer 1 → 1）
  const layerMatch = task_layer.match(/Layer\s+(\d+)/i);
  if (!layerMatch) {
    console.warn(`[unified-intent-router] Invalid task_layer format: ${task_layer}, fallback to Layer 5`);
    return {
      action: 'execute',
      skill: '/dev',
      params: { description: content, source }
    };
  }

  const layerNum = parseInt(layerMatch[1], 10);

  // 路由决策
  if (layerNum >= 1 && layerNum <= 4) {
    // Layer 1-4: OKR/KR/Project → 秋米拆解
    console.log(`[unified-intent-router] ${task_layer} → 秋米拆解 (/autumnrice)`);
    return {
      action: 'decompose',
      skill: '/autumnrice',
      params: {
        layer: layerNum,
        content,
        source
      }
    };
  } else if (layerNum === 5 || layerNum === 6) {
    // Layer 5-6: Initiative/Task → 直接 /dev
    console.log(`[unified-intent-router] ${task_layer} → 直接执行 (/dev)`);
    return {
      action: 'execute',
      skill: '/dev',
      params: {
        description: content,
        source
      }
    };
  } else {
    // 异常层级，fallback
    console.warn(`[unified-intent-router] Unknown layer ${layerNum}, fallback to Layer 5`);
    return {
      action: 'execute',
      skill: '/dev',
      params: { description: content, source }
    };
  }
}

/**
 * 调用 /plan skill 识别意图层级
 * @param {string} content - 意图内容
 * @returns {Promise<string>} task_layer 字符串（如 "Layer 5"）
 */
export async function identifyTaskLayer(content) {
  // TODO: 实际实现需要调用 /plan skill
  // 这里先返回默认值，后续接入真实的 /plan 调用
  console.log('[unified-intent-router] identifyTaskLayer called (stub)');

  // 临时简单规则（后续会被 /plan 替换）
  const lowerContent = content.toLowerCase();

  if (lowerContent.includes('okr') || lowerContent.includes('目标')) {
    return 'Layer 2'; // KR
  }
  if (lowerContent.includes('项目') || lowerContent.includes('project')) {
    return 'Layer 4'; // Project
  }
  if (lowerContent.includes('拆解') || lowerContent.includes('decomp')) {
    return 'Layer 4'; // Project
  }
  if (lowerContent.includes('修复') || lowerContent.includes('fix') || lowerContent.includes('bug')) {
    return 'Layer 6'; // Task
  }

  // 默认 Initiative
  return 'Layer 5';
}
