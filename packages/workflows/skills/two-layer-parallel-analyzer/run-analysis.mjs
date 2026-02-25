#!/usr/bin/env node
/**
 * Two-Layer Parallel Analyzer - 完整执行脚本
 * 在 skill 内部直接调用,无需外部依赖
 */
import { Client } from '@notionhq/client';
import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config();

const notion = new Client({ auth: process.env.NOTION_API_KEY });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/**
 * 读取 Notion 页面内容
 */
async function readPageContent(pageId) {
  console.log(`📖 Reading page ${pageId}...`);

  const blocks = await notion.blocks.children.list({
    block_id: pageId,
    page_size: 100
  });

  let content = '';
  for (const block of blocks.results) {
    if (block.type === 'paragraph' && block.paragraph?.rich_text) {
      const text = block.paragraph.rich_text.map(t => t.plain_text).join('');
      if (text.trim()) content += text + '\n\n';
    } else if (block.type === 'heading_1' && block.heading_1?.rich_text) {
      content += '# ' + block.heading_1.rich_text.map(t => t.plain_text).join('') + '\n\n';
    } else if (block.type === 'heading_2' && block.heading_2?.rich_text) {
      content += '## ' + block.heading_2.rich_text.map(t => t.plain_text).join('') + '\n\n';
    } else if (block.type === 'bulleted_list_item' && block.bulleted_list_item?.rich_text) {
      content += '- ' + block.bulleted_list_item.rich_text.map(t => t.plain_text).join('') + '\n';
    } else if (block.type === 'numbered_list_item' && block.numbered_list_item?.rich_text) {
      content += '1. ' + block.numbered_list_item.rich_text.map(t => t.plain_text).join('') + '\n';
    }
  }

  return content.trim();
}

/**
 * 并行执行多个分析任务
 */
async function runParallelAnalysis(prompts) {
  console.log(`🔄 Running ${prompts.length} agents in parallel...`);

  const promises = prompts.map(async (prompt) => {
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      messages: [{
        role: 'user',
        content: prompt.content
      }]
    });

    return {
      name: prompt.name,
      result: message.content[0].text
    };
  });

  return await Promise.all(promises);
}

/**
 * Layer 1: 战略分析 (4 agents并行)
 */
async function runLayer1Analysis(content) {
  console.log('\n━━━ Layer 1: Strategic Analysis (4 agents) ━━━');

  const prompts = [
    {
      name: 'topicSummary',
      content: `你是话题总结专家。请用3-5句话概括以下内容的核心话题、关键冲突、反直觉洞察:\n\n${content}\n\n只返回话题总结的3-5句话,不要其他内容。`
    },
    {
      name: 'audienceValue',
      content: `你是受众价值分析专家。请分析以下内容的目标人群、核心痛点、价值主张:\n\n${content}\n\n返回JSON格式:\n{\n  "target_group": "...",\n  "characteristics": "...",\n  "current_state": "...",\n  "core_confusion": "...",\n  "pain_points": "...",\n  "value_proposition": "..."\n}`
    },
    {
      name: 'ipPerception',
      content: `你是IP感知分析专家。请分析读者会如何感知作者的IP形象:\n\n${content}\n\n返回JSON格式:\n{\n  "image": "...",\n  "reactions": ["反应1", "反应2", "反应3"]\n}`
    },
    {
      name: 'authority',
      content: `你是权威增强专家。请为以下内容匹配权威引用和方法论框架:\n\n${content}\n\n返回JSON格式,包含level, citations, frameworks, best_leverage字段。`
    }
  ];

  const results = await runParallelAnalysis(prompts);

  // 解析结果
  const layer1 = {};
  for (const result of results) {
    if (result.name === 'topicSummary') {
      layer1.topic_summary = result.result;
    } else {
      try {
        // 尝试解析JSON
        const jsonMatch = result.result.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          layer1[result.name] = JSON.parse(jsonMatch[0]);
        }
      } catch (e) {
        console.warn(`Warning: Failed to parse ${result.name} as JSON`);
        layer1[result.name] = result.result;
      }
    }
  }

  console.log('✅ Layer 1 completed');
  return layer1;
}

/**
 * Layer 2: 内容大纲生成 (5 agents并行)
 */
async function runLayer2Analysis(content, layer1Results) {
  console.log('\n━━━ Layer 2: Content Outlines (5 agents) ━━━');

  const angles = [
    '揭露真相',
    '拥抱不确定性',
    '认知与现实的断层',
    '概率游戏策略',
    '认知革命'
  ];

  const prompts = angles.map((angle, index) => ({
    name: `outline${index + 1}`,
    content: `你是内容大纲生成专家,擅长Dan Koe风格。

原始内容:
${content}

第一层分析结果:
${JSON.stringify(layer1Results, null, 2)}

请从"${angle}"角度生成一个Dan Koe风格的内容大纲。

返回JSON格式:
{
  "title": "...",
  "paradox": "...",
  "transformation": "...",
  "steps": ["步骤1", "步骤2", "步骤3"],
  "insight": "..."
}`
  }));

  const results = await runParallelAnalysis(prompts);

  // 解析大纲
  const outlines = [];
  for (const result of results) {
    try {
      const jsonMatch = result.result.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        outlines.push(JSON.parse(jsonMatch[0]));
      }
    } catch (e) {
      console.warn(`Warning: Failed to parse outline as JSON`);
    }
  }

  console.log('✅ Layer 2 completed');
  return outlines;
}

/**
 * 主执行函数
 */
async function main() {
  const pageId = process.argv[2];

  if (!pageId) {
    console.error('Usage: node run-analysis.mjs <page-id>');
    process.exit(1);
  }

  try {
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('  Two-Layer Parallel Analyzer');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // Step 1: Read page content
    const content = await readPageContent(pageId);
    console.log(`✅ Content read: ${content.length} characters\n`);

    // Step 2: Layer 1 analysis
    const layer1 = await runLayer1Analysis(content);

    // Step 3: Layer 2 analysis
    const layer2 = await runLayer2Analysis(content, layer1);

    // Step 4: Build final JSON
    const analysisData = {
      layer1,
      layer2: { outlines: layer2 }
    };

    // Step 5: Save JSON
    const outputFile = `/tmp/analysis-result-${pageId}.json`;
    fs.writeFileSync(outputFile, JSON.stringify(analysisData, null, 2), 'utf-8');

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✅ Analysis completed!');
    console.log(`📁 Result saved: ${outputFile}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    return outputFile;

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { main, runLayer1Analysis, runLayer2Analysis };
