#!/usr/bin/env node
/**
 * 快手 Open Platform API 图文发布脚本
 *
 * 功能：通过 Kuaishou Open Platform API 发布图文内容（图片 + 文案）
 * 用法：node kuaishou-api-publisher.cjs --content /path/to/image-{id}/
 *
 * 内容目录结构：
 *   content.txt   - 文案内容（可选）
 *   image.jpg     - 图片（支持 image1.jpg, image2.jpg 等）
 *
 * 环境要求：
 *   NODE_PATH=/Users/administrator/perfect21/cecelia/node_modules
 *   ~/.credentials/kuaishou.env（需配置 APP_KEY/APP_SECRET/ACCESS_TOKEN）
 *
 * 退出码：
 *   0 - 发布成功
 *   1 - 发布失败
 *   2 - 需要重新授权（refresh token 过期）
 */

'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const os = require('os');

const { getValidAccessToken, getCredentials, httpsPost, KUAISHOU_API_HOST } = require('./kuaishou-oauth-client.cjs');
const { findImages, readContent } = require('./utils.cjs');

// ========== 配置 ==========

const SCREENSHOTS_DIR = '/tmp/kuaishou-api-screenshots';

// 确保截图目录存在
if (!fs.existsSync(SCREENSHOTS_DIR)) {
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
}

// ========== 参数解析 ==========

const args = process.argv.slice(2);
const contentDirArg = args[args.indexOf('--content') + 1];

if (!contentDirArg || !fs.existsSync(contentDirArg)) {
  console.error('❌ 错误：必须提供有效的内容目录路径');
  console.error('使用方式：node kuaishou-api-publisher.cjs --content /path/to/image-xxx/');
  process.exit(1);
}

const contentDir = path.resolve(contentDirArg);
const contentText = readContent(contentDir);
const localImages = findImages(contentDir);

if (localImages.length === 0) {
  console.error('❌ 错误：内容目录中没有图片文件');
  process.exit(1);
}

console.log('\n========================================');
console.log('快手图文发布（API 模式）');
console.log('========================================\n');
console.log(`📁 内容目录: ${contentDir}`);
console.log(`📝 文案长度: ${contentText.length} 字符`);
console.log(`🖼️  图片数量: ${localImages.length}`);
console.log('');

// ========== 图片上传 ==========

/**
 * 将图片文件上传到快手
 * @param {string} imagePath - 本地图片路径
 * @param {string} accessToken - 有效的 access_token
 * @returns {Promise<string>} 图片 token
 */
async function uploadImage(imagePath, accessToken) {
  const filename = path.basename(imagePath);
  const ext = path.extname(imagePath).toLowerCase().replace('.', '');
  const mimeTypes = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
  const mimeType = mimeTypes[ext] || 'image/jpeg';

  const imageData = fs.readFileSync(imagePath);
  const boundary = `----FormBoundary${Math.random().toString(36).slice(2)}`;

  // 构建 multipart/form-data
  const parts = [];
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="access_token"\r\n\r\n${accessToken}\r\n`));
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="${filename}"\r\nContent-Type: ${mimeType}\r\n\r\n`));
  parts.push(imageData);
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));

  const body = Buffer.concat(parts);

  return new Promise((resolve, reject) => {
    const options = {
      hostname: KUAISHOU_API_HOST,
      port: 443,
      path: '/openapi/photo/image/upload',
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length,
      },
    };

    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => (data += chunk));
      res.on('end', () => {
        try {
          const result = JSON.parse(data);
          if (result.result !== 1 || !result.photo_id) {
            reject(new Error(`[KUAISHOU_IMAGE_UPLOAD_FAILED] 图片上传失败: ${result.error_msg || JSON.stringify(result)}`));
          } else {
            resolve(result.photo_id);
          }
        } catch (e) {
          reject(new Error(`图片上传响应解析失败: ${e.message}`));
        }
      });
    });

    req.setTimeout(60000, () => {
      req.destroy();
      reject(new Error('图片上传超时 (60s)'));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ========== 图文发布 ==========

/**
 * 发布图文内容
 * @param {string[]} photoIds - 已上传图片的 photo_id 列表
 * @param {string} caption - 文案内容
 * @param {string} accessToken - 有效的 access_token
 * @returns {Promise<Object>} 发布结果
 */
async function publishPhoto(photoIds, caption, accessToken) {
  const creds = getCredentials();

  const body = {
    access_token: accessToken,
    open_id: creds.openId,
    photo_ids: photoIds,
    caption: caption || '',
  };

  const resp = await httpsPost('/openapi/photo/publish', body);

  if (resp.result !== 1) {
    throw new Error(`[KUAISHOU_PUBLISH_FAILED] 发布失败: ${resp.error_msg || JSON.stringify(resp)}`);
  }

  return resp;
}

// ========== 主流程 ==========

async function main() {
  try {
    // 步骤 1：获取有效 Token
    console.log('1️⃣  获取有效 access_token...\n');
    let accessToken;
    try {
      accessToken = await getValidAccessToken();
      console.log('   ✅ Token 有效\n');
    } catch (err) {
      console.error(`   ❌ ${err.message}`);
      process.exit(err.exitCode || 1);
    }

    // 步骤 2：上传图片
    console.log(`2️⃣  上传图片（${localImages.length} 张）...\n`);
    const photoIds = [];
    for (let i = 0; i < localImages.length; i++) {
      const imagePath = localImages[i];
      const filename = path.basename(imagePath);
      console.log(`   上传: ${filename}`);
      try {
        const photoId = await uploadImage(imagePath, accessToken);
        photoIds.push(photoId);
        console.log(`   ✅ photo_id: ${photoId}`);
      } catch (err) {
        console.error(`   ❌ 上传失败: ${err.message}`);
        process.exit(1);
      }
    }
    console.log(`\n   ✅ 图片全部上传完成（${photoIds.length} 张）\n`);

    // 步骤 3：发布图文
    console.log('3️⃣  发布图文...\n');
    if (contentText) {
      console.log(`   文案: ${contentText.slice(0, 50)}${contentText.length > 50 ? '...' : ''}`);
    }

    const publishResult = await publishPhoto(photoIds, contentText, accessToken);
    const publishId = publishResult.photo_id || publishResult.result_id || '(已发布)';

    console.log(`\n========== ✅ 发布成功 ==========\n`);
    console.log(`发布 ID: ${publishId}`);
    console.log(`图片数量: ${photoIds.length}`);
    if (contentText) {
      console.log(`文案: ${contentText.slice(0, 30)}...`);
    }
    console.log('');

    process.exit(0);

  } catch (err) {
    console.error('\n========== ❌ 发布失败 ==========\n');
    console.error(err.message);
    console.error('');
    process.exit(err.exitCode || 1);
  }
}

main();
