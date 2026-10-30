import { readFileSync } from 'node:fs';

try {
  const report = JSON.parse(readFileSync(0, 'utf8'));
  if (report?.auditReportVersion !== 2 || report.error || !report.vulnerabilities
      || typeof report.vulnerabilities !== 'object' || Array.isArray(report.vulnerabilities)
      || !Number.isInteger(report.metadata?.vulnerabilities?.total) || report.metadata.vulnerabilities.total < 0) {
    throw new Error('审计报告结构不完整');
  }
  for (const item of Object.values(report.vulnerabilities)) {
    if (!item || !['info', 'low', 'moderate', 'high', 'critical'].includes(item.severity) || !Array.isArray(item.via)) {
      throw new Error('漏洞条目结构无效');
    }
  }
} catch (error) {
  process.stderr.write(`依赖审计未获得有效证据：${error.message}\n`);
  process.exitCode = 1;
}
