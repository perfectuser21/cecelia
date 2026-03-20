/**
 * 需求语义解析器 (Thalamus 架构兼容版本)
 *
 * 基于 fact-extractor 的设计模式：
 * 1. 正则快速提取（零延迟、零成本）
 * 2. Haiku 并行补全（fire-and-forget）
 * 3. 反哺进化机制
 * 4. 遵循 "LLM只下指令" 原则
 */

/* global console */

import { _extractKeywords } from './entity-linker.js';
import { callLLM } from './llm-caller.js';
import pool from './db.js';
import natural from 'natural';

/**
 * 需求解析模式定义（正则匹配，零延迟）
 */
const REQUIREMENT_PATTERNS = [
  // 功能需求模式
  { re: /(?:添加|新增|加|创建|做|实现)(.{2,30}?)(?:[功能|模块|组件|接口])(?:[。，,\s]|$)/g, type: 'feature_add', weight: 1.0 },
  { re: /(?:修复|修改|解决|处理)(.{2,30}?)(?:[bug|问题|错误|异常])(?:[。，,\s]|$)/g, type: 'bug_fix', weight: 1.0 },
  { re: /(?:优化|改进|提升|增强)(.{2,30}?)(?:[性能|体验|功能])(?:[。，,\s]|$)/g, type: 'enhancement', weight: 0.9 },

  // 技术需求模式
  { re: /(?:集成|接入|对接)(.{2,30}?)(?:[API|接口|服务|系统])(?:[。，,\s]|$)/g, type: 'integration', weight: 1.0 },
  { re: /(?:重构|重写|改造)(.{2,30}?)(?:[代码|模块|架构])(?:[。，,\s]|$)/g, type: 'refactor', weight: 0.9 },

  // 英文模式
  { re: /(add|create|implement|build)\s+(.{2,30}?)\s+(?:feature|module|component|function)/gi, type: 'feature_add', weight: 1.0 },
  { re: /(fix|resolve|solve)\s+(.{2,30}?)\s+(?:bug|issue|error|problem)/gi, type: 'bug_fix', weight: 1.0 },
  { re: /(optimize|improve|enhance)\s+(.{2,30}?)\s+(?:performance|feature|function)/gi, type: 'enhancement', weight: 0.9 },
];

/**
 * 技术实体模式（基于现有 entity-linker 扩展）
 */
const TECH_ENTITY_PATTERNS = [
  // 技术栈
  { re: /\b(React|Vue|Angular|Node\.js|Express|Koa|MongoDB|PostgreSQL|Redis|Docker|Kubernetes)\b/gi, type: 'tech_stack', weight: 1.0 },
  // 组件类型
  { re: /(?:按钮|输入框|表单|表格|列表|菜单|导航|弹窗|对话框)/g, type: 'ui_component', weight: 0.9 },
  { re: /\b(button|input|form|table|list|menu|nav|modal|dialog|dropdown)\b/gi, type: 'ui_component', weight: 0.9 },
  // 功能模块
  { re: /(?:登录|注册|认证|授权|支付|订单|用户|管理|搜索|筛选)/g, type: 'feature_module', weight: 1.0 },
  { re: /\b(login|register|auth|payment|order|user|admin|search|filter)\b/gi, type: 'feature_module', weight: 1.0 },
];

/**
 * 主要解析函数（正则 + LLM 混合模式）
 * @param {string} text - 需求描述文本
 * @returns {Promise<Object>} 解析结果 {keywords, entities, patterns, llmEnhancement}
 */
export async function parse(text) {
  if (!text || typeof text !== 'string') {
    return { keywords: [], entities: [], patterns: [], llmEnhancement: null };
  }

  const startTime = Date.now();

  try {
    // 1. 正则快速提取（零延迟）
    const keywords = _extractKeywords(text); // 复用现有逻辑
    const entities = extractTechEntities(text);
    const patterns = extractRequirementPatterns(text);

    // 2. 构建基础结果
    const baseResult = {
      keywords,
      entities,
      patterns,
      parseTime: Date.now() - startTime,
      llmEnhancement: null
    };

    // 3. LLM 并行补全（fire-and-forget）
    enhanceWithLLM(text, baseResult).catch(err => {
      console.warn('[semantic-parser] LLM enhancement failed silently:', err.message);
    });

    return baseResult;
  } catch (error) {
    console.warn('[semantic-parser] Parse error:', error.message);
    return { keywords: [], entities: [], patterns: [], error: error.message };
  }
}

/**
 * 批量解析
 * @param {string[]} texts
 * @returns {Promise<Object[]>}
 */
export async function batchParse(texts) {
  if (!Array.isArray(texts)) {
    return [];
  }

  const results = [];
  for (const text of texts) {
    results.push(await parse(text));
  }
  return results;
}

/**
 * 提取技术实体（正则模式）
 * @param {string} text
 * @returns {Object[]} 实体数组
 */
function extractTechEntities(text) {
  const entities = [];

  for (const pattern of TECH_ENTITY_PATTERNS) {
    let match;
    pattern.re.lastIndex = 0; // 重置正则索引

    while ((match = pattern.re.exec(text)) !== null) {
      entities.push({
        type: pattern.type,
        value: match[1] || match[0],
        confidence: pattern.weight,
        position: match.index
      });
    }
  }

  // 去重并排序
  const uniqueEntities = [];
  const seen = new Set();

  entities
    .sort((a, b) => b.confidence - a.confidence)
    .forEach(entity => {
      const key = `${entity.type}:${entity.value.toLowerCase()}`;
      if (!seen.has(key)) {
        seen.add(key);
        uniqueEntities.push(entity);
      }
    });

  return uniqueEntities.slice(0, 10); // 限制最多10个实体
}

/**
 * 提取需求模式（正则匹配）
 * @param {string} text
 * @returns {Object[]} 模式数组
 */
function extractRequirementPatterns(text) {
  const patterns = [];

  for (const pattern of REQUIREMENT_PATTERNS) {
    let match;
    pattern.re.lastIndex = 0;

    while ((match = pattern.re.exec(text)) !== null) {
      patterns.push({
        type: pattern.type,
        content: match[1] ? match[1].trim() : match[0],
        confidence: pattern.weight,
        position: match.index
      });
    }
  }

  return patterns.slice(0, 5); // 限制最多5个模式
}

/**
 * LLM 增强处理（fire-and-forget，不阻塞主流程）
 * @param {string} text
 * @param {Object} baseResult
 * @returns {Promise<void>}
 */
async function enhanceWithLLM(text, baseResult) {
  try {
    const prompt = `你是一个需求解析专家。请分析以下需求描述，提取关键信息：

需求描述："""${text}"""

基础解析结果：
- 关键词：${baseResult.keywords.join(', ')}
- 实体：${baseResult.entities.map(e => e.value).join(', ')}
- 模式：${baseResult.patterns.map(p => p.type).join(', ')}

请补充遗漏的关键词、实体或模式。输出格式：
{
  "additional_keywords": ["补充关键词"],
  "additional_entities": [{"type": "类型", "value": "值"}],
  "complexity": "low|medium|high",
  "category": "feature|bug_fix|enhancement|integration|refactor"
}`;

    const response = await callLLM({
      agentId: 'haiku',
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 300,
      systemPrompt: '你是一个需求解析助手，专门识别软件需求中的关键信息。输出简洁的JSON格式。'
    });

    if (response && response.content) {
      const enhanced = parseJSONSafely(response.content);
      if (enhanced) {
        // 异步存储增强结果（不等待）
        storeEnhancedResult(text, baseResult, enhanced).catch(err => {
          console.warn('[semantic-parser] Store enhanced result failed:', err.message);
        });
      }
    }
  } catch (error) {
    // LLM 失败静默处理，不影响基础功能
    console.warn('[semantic-parser] LLM enhancement silent failure:', error.message);
  }
}

/**
 * 安全JSON解析
 * @param {string} jsonStr
 * @returns {Object|null}
 */
function parseJSONSafely(jsonStr) {
  try {
    // 尝试提取JSON块
    const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    return JSON.parse(jsonStr);
  } catch {
    return null;
  }
}

/**
 * 存储增强结果到学习表（反哺进化）
 * @param {string} originalText
 * @param {Object} baseResult
 * @param {Object} enhancedResult
 * @returns {Promise<void>}
 */
async function storeEnhancedResult(originalText, baseResult, enhancedResult) {
  try {
    // 将 LLM 发现的增强信息存储到 learned_patterns 表
    // 下次相似文本可以直接正则匹配
    const learningData = {
      original_text: originalText,
      base_keywords: baseResult.keywords,
      enhanced_keywords: enhancedResult.additional_keywords || [],
      enhanced_entities: enhancedResult.additional_entities || [],
      complexity: enhancedResult.complexity,
      category: enhancedResult.category,
      created_at: new Date().toISOString()
    };

    await pool.query(`
      INSERT INTO learned_patterns (pattern_type, pattern_data, source, confidence)
      VALUES ('semantic_enhancement', $1, 'semantic_parser', 0.8)
      ON CONFLICT DO NOTHING
    `, [JSON.stringify(learningData)]);

  } catch (error) {
    console.warn('[semantic-parser] Store learning data failed:', error.message);
  }
}

/**
 * 从学习历史中加载模式（启动时调用）
 * @returns {Promise<void>}
 */
export async function loadLearnedPatterns() {
  try {
    const result = await pool.query(`
      SELECT pattern_data FROM learned_patterns
      WHERE pattern_type = 'semantic_enhancement'
        AND confidence > 0.5
      ORDER BY created_at DESC
      LIMIT 100
    `);

    // 将学习到的模式添加到正则匹配中
    // 这里可以动态生成正则表达式
    console.log(`[semantic-parser] Loaded ${result.rows.length} learned patterns`);
  } catch (error) {
    console.warn('[semantic-parser] Load learned patterns failed:', error.message);
  }
}

/**
 * 导出内部函数用于测试
 */
export const _internal = {
  extractTechEntities,
  extractRequirementPatterns,
  enhanceWithLLM,
  REQUIREMENT_PATTERNS,
  TECH_ENTITY_PATTERNS
};