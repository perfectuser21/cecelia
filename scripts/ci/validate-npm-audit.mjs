import { readFileSync } from 'node:fs';

try {
  const report = JSON.parse(readFileSync(0, 'utf8'));
  const status = Number(process.env.NPM_AUDIT_STATUS);
  if (report?.auditReportVersion !== 2 || report.error || !report.vulnerabilities
      || typeof report.vulnerabilities !== 'object' || Array.isArray(report.vulnerabilities)
      || !Number.isInteger(report.metadata?.vulnerabilities?.total) || report.metadata.vulnerabilities.total < 0) {
    throw new Error('审计报告结构不完整');
  }
  const entries = Object.entries(report.vulnerabilities);
  if (![0, 1].includes(status) || report.metadata.vulnerabilities.total !== entries.length || (status === 1 && entries.length === 0)) {
    throw new Error('审计状态、计数和漏洞表不一致');
  }
  const levels = ['info', 'low', 'moderate', 'high', 'critical'];
  for (const [name, item] of entries) {
    if (!item || !['info', 'low', 'moderate', 'high', 'critical'].includes(item.severity) || !Array.isArray(item.via)) {
      throw new Error('漏洞条目结构无效');
    }
    if (!item.via.length) throw new Error(`漏洞缺少来源：${name}`);
    for (const advisory of item.via) {
      if (typeof advisory === 'string') {
        if (!Object.hasOwn(report.vulnerabilities, advisory)) throw new Error('漏洞依赖引用缺失');
      } else {
        if (!advisory || !levels.includes(advisory.severity) || typeof advisory.title !== 'string' || !advisory.title.trim()
            || typeof advisory.url !== 'string' || new URL(advisory.url).protocol !== 'https:') {
          throw new Error('漏洞公告缺少有效等级、标题或来源');
        }
        if (levels.indexOf(advisory.severity) > levels.indexOf(item.severity)) throw new Error('漏洞公告和聚合等级矛盾');
      }
    }
  }
  function hasAdvisory(name, visited = new Set()) {
    if (visited.has(name)) return false;
    const next = new Set([...visited, name]);
    return report.vulnerabilities[name].via.some(value => typeof value !== 'string' || hasAdvisory(value, next));
  }
  for (const [name] of entries) if (!hasAdvisory(name)) throw new Error('漏洞引用没有可验证公告');
} catch (error) {
  process.stderr.write(`依赖审计未获得有效证据：${error.message}\n`);
  process.exitCode = 1;
}
