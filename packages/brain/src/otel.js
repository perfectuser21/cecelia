/**
 * otel.js — Brain OpenTelemetry SDK 初始化
 *
 * 环境变量：
 *   HONEYCOMB_API_KEY — Honeycomb API 密钥。缺失时静默跳过，不报错。
 *
 * 用法（必须在 server.js 最顶部调用）：
 *   import { initOtel } from './src/otel.js';
 *   await initOtel();
 */

import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-otlp-http';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';

const SERVICE_NAME = 'cecelia-brain';
const HONEYCOMB_ENDPOINT = 'https://api.honeycomb.io';

let _sdk = null;

/**
 * 初始化 OpenTelemetry SDK。
 * 无 HONEYCOMB_API_KEY 时静默返回 null，不抛错。
 * @returns {NodeSDK|null}
 */
export async function initOtel() {
  const apiKey = process.env.HONEYCOMB_API_KEY;

  if (!apiKey) {
    return null;
  }

  try {
    const traceExporter = new OTLPTraceExporter({
      url: `${HONEYCOMB_ENDPOINT}/v1/traces`,
      headers: {
        'x-honeycomb-team': apiKey,
      },
    });

    _sdk = new NodeSDK({
      serviceName: SERVICE_NAME,
      traceExporter,
      instrumentations: [
        getNodeAutoInstrumentations({
          '@opentelemetry/instrumentation-fs': { enabled: false },
        }),
      ],
    });

    _sdk.start();
    return _sdk;
  } catch (err) {
    console.warn('[otel] OTel SDK 初始化失败（非致命）:', err.message);
    return null;
  }
}

/** 仅供测试使用：重置 SDK 实例 */
export function _resetOtel() {
  if (_sdk) {
    try { _sdk.shutdown(); } catch (_) {}
    _sdk = null;
  }
}
