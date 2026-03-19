'use strict';
/**
 * flow-内容发布.json 结构验证测试
 *
 * 验证 N8N workflow 的路由配置正确性：
 * - 三平台（抖音/快手/小红书）+ 两类型（图文/视频）的统一路由
 * - Respond to Webhook 400 错误处理
 * - contentType 字段解析
 *
 * 运行：node --test packages/workflows/n8n/workflows/media/__tests__/flow-content-publish.test.cjs
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const WORKFLOW_PATH = path.join(__dirname, '..', 'flow-\u5185\u5bb9\u53d1\u5e03.json');

let workflow;

describe('flow-内容发布.json', () => {
  test('JSON 文件可正常解析', () => {
    const raw = fs.readFileSync(WORKFLOW_PATH, 'utf8');
    workflow = JSON.parse(raw);
    assert.ok(workflow, 'workflow 不为空');
    assert.ok(Array.isArray(workflow.nodes), '包含 nodes 数组');
    assert.ok(typeof workflow.connections === 'object', '包含 connections 对象');
  });

  test('Webhook 节点使用 responseNode 模式', () => {
    const raw = fs.readFileSync(WORKFLOW_PATH, 'utf8');
    const wf = JSON.parse(raw);
    const webhook = wf.nodes.find(n => n.name === 'Webhook');
    assert.ok(webhook, 'Webhook 节点存在');
    assert.strictEqual(webhook.parameters.responseMode, 'responseNode');
  });

  test('准备节点包含 contentType 和 platform 字段（兼容 targetPlatforms）', () => {
    const raw = fs.readFileSync(WORKFLOW_PATH, 'utf8');
    const wf = JSON.parse(raw);
    const prep = wf.nodes.find(n => n.name === '准备');
    assert.ok(prep, '准备节点存在');
    const code = prep.parameters.jsCode;
    assert.ok(code.includes('contentType'), '解析 contentType');
    assert.ok(code.includes('platform'), '解析 platform');
    assert.ok(code.includes('targetPlatforms'), '向后兼容 targetPlatforms');
  });

  test('存在 Respond-400 节点（HTTP 400 状态码）', () => {
    const raw = fs.readFileSync(WORKFLOW_PATH, 'utf8');
    const wf = JSON.parse(raw);
    const node = wf.nodes.find(
      n => n.type === 'n8n-nodes-base.respondToWebhook' && n.parameters && n.parameters.responseCode === 400
    );
    assert.ok(node, 'Respond-400 节点存在');
  });

  test('平台类型路由 Switch 节点恰好有 5 条规则', () => {
    const raw = fs.readFileSync(WORKFLOW_PATH, 'utf8');
    const wf = JSON.parse(raw);
    const sw = wf.nodes.find(n => n.name === '平台类型路由');
    assert.ok(sw, '平台类型路由节点存在');
    const rules = sw.parameters.rules.values;
    assert.strictEqual(rules.length, 5, '5 条路由规则');
  });

  test('5 条路由规则覆盖所有平台+类型组合', () => {
    const raw = fs.readFileSync(WORKFLOW_PATH, 'utf8');
    const wf = JSON.parse(raw);
    const sw = wf.nodes.find(n => n.name === '平台类型路由');
    const rules = sw.parameters.rules.values;

    const has = (platform, type) => rules.some(r =>
      r.conditions.conditions.some(c => c.rightValue === platform) &&
      (type ? r.conditions.conditions.some(c => c.rightValue === type) : true)
    );

    assert.ok(has('douyin'), 'douyin 规则存在');
    assert.ok(has('kuaishou', 'image'), 'kuaishou+image 规则存在');
    assert.ok(has('kuaishou', 'video'), 'kuaishou+video 规则存在');
    assert.ok(has('xiaohongshu', 'image'), 'xiaohongshu+image 规则存在');
    assert.ok(has('xiaohongshu', 'video'), 'xiaohongshu+video 规则存在');
  });

  test('SSH-快手图文节点调用 publish-kuaishou-api.cjs，SSH 至 CN Mac mini', () => {
    const raw = fs.readFileSync(WORKFLOW_PATH, 'utf8');
    const wf = JSON.parse(raw);
    const node = wf.nodes.find(n => n.name === 'SSH-快手图文');
    assert.ok(node, 'SSH-快手图文节点存在');
    assert.ok(node.parameters.command.includes('publish-kuaishou-api.cjs'));
    assert.strictEqual(node.parameters.host, '100.108.7.63');
  });

  test('SSH-快手视频节点调用 publish-kuaishou-video.cjs', () => {
    const raw = fs.readFileSync(WORKFLOW_PATH, 'utf8');
    const wf = JSON.parse(raw);
    const node = wf.nodes.find(n => n.name === 'SSH-快手视频');
    assert.ok(node, 'SSH-快手视频节点存在');
    assert.ok(node.parameters.command.includes('publish-kuaishou-video.cjs'));
  });

  test('SSH-小红书图文节点调用 publish-xiaohongshu-image.cjs', () => {
    const raw = fs.readFileSync(WORKFLOW_PATH, 'utf8');
    const wf = JSON.parse(raw);
    const node = wf.nodes.find(n => n.name === 'SSH-小红书图文');
    assert.ok(node, 'SSH-小红书图文节点存在');
    assert.ok(node.parameters.command.includes('publish-xiaohongshu-image.cjs'));
  });

  test('解析通知节点包含所有平台和类型显示名称', () => {
    const raw = fs.readFileSync(WORKFLOW_PATH, 'utf8');
    const wf = JSON.parse(raw);
    const node = wf.nodes.find(n => n.name === '解析通知');
    assert.ok(node, '解析通知节点存在');
    const code = node.parameters.jsCode;
    assert.ok(code.includes('\u6296\u97f3'), '含抖音');
    assert.ok(code.includes('\u5feb\u624b'), '含快手');
    assert.ok(code.includes('\u5c0f\u7ea2\u4e66'), '含小红书');
    assert.ok(code.includes('\u89c6\u9891'), '含视频类型判断');
  });
});
