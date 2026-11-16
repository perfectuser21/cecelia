#!/usr/bin/env node
// 旧缺契约扫描不再自行生产开发任务；真实契约漂移门禁独立保留。
console.error(JSON.stringify({ status: 410, code: 'CONTRACT_SCAN_RETIRED', message: '自动扫描建开发任务已退役；请通过明确登记的任务执行契约检查' }));
process.exitCode = 1;
