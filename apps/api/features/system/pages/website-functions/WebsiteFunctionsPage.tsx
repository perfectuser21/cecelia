import { useMemo, useState } from 'react';
import { buildCoreNavigation } from '../../../navigation';
import snapshot from './inventory.json';
import { buildInventory, categories, filterOperations, statusLabels, summarize } from './model';
import type { Category, Operation, Status } from './model';
import { growth, verifications } from './verification';

const navigation = new Set(buildCoreNavigation().flatMap(group => group.items.flatMap(item =>
  (item.children ?? [item]).map(child => child.path))));
const operations = buildInventory(snapshot.rows, verifications, navigation);
const totals = summarize(operations);
const statusStyles: Record<Status, string> = {
  verified: 'text-emerald-300 bg-emerald-950/60', readChecked: 'text-sky-300 bg-sky-950/60',
  broken: 'text-rose-300 bg-rose-950/60', pending: 'text-amber-300 bg-amber-950/60',
};

function OperationCard({ item }: { item: Operation }) {
  const [expanded, setExpanded] = useState(false);
  const category = categories.find(c => c.key === item.category)!;
  return <article className="rounded-xl border border-slate-700 bg-slate-900 p-4 min-w-0">
    <div className="flex flex-wrap gap-2 text-xs mb-2">
      <span className="text-slate-300">{category.label}</span>
      <span className={`px-2 py-0.5 rounded ${statusStyles[item.status]}`}>{statusLabels[item.status]}</span>
      <span className="text-slate-400">{item.disposition}</span>
      <span className="text-slate-500">{item.inNavigation ? '主导航内' : item.path ? '历史入口' : '无直接入口'}</span>
      {item.combined && <span className="text-slate-400">组合操作 · 按主要作用归类</span>}
    </div>
    <h3 className="font-medium text-white break-words">{item.name}</h3>
    <p className="mt-1 text-sm text-slate-400">{item.page}</p>
    <p className="mt-2 text-sm text-slate-300 break-words">{item.effect}</p>
    <div className="mt-3 flex flex-wrap gap-4 text-sm">
      {item.path && <a className="text-sky-300 hover:underline" href={item.path}>打开页面</a>}
      <a className="text-slate-400 hover:underline" href={item.notionUrl} target="_blank" rel="noreferrer">原始清单</a>
      <button className="text-slate-300 hover:text-white" onClick={() => setExpanded(!expanded)} aria-expanded={expanded}>
        {expanded ? '收起证据' : '查看证据'}
      </button>
    </div>
    {expanded && <div className="mt-3 border-t border-slate-700 pt-3 text-xs text-slate-400 space-y-2 break-words">
      {item.verification && <p className="text-emerald-300">验收更新 {item.verification.date}：{item.verification.evidence}</p>}
      <p>本人验收：{item.humanAcceptance}。未找到记录不等于本人从未使用。</p>
      <p>原始分类：{item.originalCategory}；原始状态：{item.originalStatus}</p>
      <p>后台连接：<span className="break-all">{item.method} {item.api}</span></p>
      <p className="whitespace-pre-wrap">原始审计 {snapshot.auditDate}：{item.auditEvidence}</p>
    </div>}
  </article>;
}

export default function WebsiteFunctionsPage() {
  const [category, setCategory] = useState<Category | 'all'>('all');
  const [status, setStatus] = useState<Status | 'all'>('all');
  const [navigationOnly, setNavigationOnly] = useState(false);
  const [search, setSearch] = useState('');
  const [limit, setLimit] = useState(30);
  const filtered = useMemo(() => filterOperations(operations, { category, status, navigationOnly, search }),
    [category, status, navigationOnly, search]);
  const countCards = [
    ['操作记录', totals.total, '含历史入口与重复操作'],
    ['确认可用', totals.verified, '有针对性验收证据'],
    ['读取抽查', totals.readChecked, '接口抽查，不等于完整验收'],
    ['已知待修', totals.broken, `断点来自 ${snapshot.auditDate} 审计`],
    ['待验证', totals.pending, '未执行、参数待验或本地行为'],
  ];
  return <div className="max-w-6xl mx-auto space-y-6 text-slate-200 min-w-0">
    <header>
      <h1 className="text-2xl font-semibold text-white">网站功能清单</h1>
      <p className="mt-2 text-sm text-slate-400">查询、输入、变更、输出：看有什么、哪些有证据可用、哪些需要修或继续验证。</p>
      <p className="mt-2 text-xs text-slate-500">盘点 {snapshot.auditDate} · 验收更新 {growth.date} · {snapshot.pageComponents} 个页面组件</p>
    </header>

    <section aria-label="功能分类说明" className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
      {categories.map(item => <div key={item.key} className="p-4 rounded-xl bg-slate-800/60 border border-slate-700">
        <h2 className="font-medium text-white">{item.label} <span className="text-slate-400 text-sm">{totals.categories[item.key]} 条</span></h2>
        <p className="mt-2 text-sm text-slate-300">{item.description}</p>
        <p className="mt-2 text-xs text-slate-400">{item.responsibility}</p>
      </div>)}
    </section>

    <section aria-label="全站盘点数量" className="grid grid-cols-2 lg:grid-cols-5 gap-3">
      {countCards.map(([label, count, note]) => <div key={label} className="p-4 rounded-xl border border-slate-700">
        <p className="text-sm text-slate-400">{label}</p><p className="mt-1 text-2xl font-semibold text-white">{count}</p>
        <p className="mt-1 text-xs text-slate-500">{note}</p>
      </div>)}
    </section>

    <section className="rounded-xl border border-emerald-900 bg-emerald-950/20 p-4" aria-label="成长记录">
      <h2 className="font-medium text-emerald-300">这次成长了多少</h2>
      <p className="mt-2 text-sm">已验证的配置变更闭环增加 {growth.newlyVerifiedChanges} 项：单 Agent 模型保存、读回与数据库留痕。</p>
      <p className="mt-2 text-xs text-slate-400">查询与变更分别登记验收；不是新增两条 Workflow。全站可用率缺少完整验收基线，未计算百分比。</p>
      <a href={growth.evidenceUrl} target="_blank" rel="noreferrer" className="inline-block mt-2 text-sm text-emerald-300 hover:underline">查看这次变更与验证</a>
    </section>

    <p className="text-xs leading-relaxed text-slate-400">
      可用数是已验收下限，不代表全站只有这些功能能用。读取抽查通过不等于完整可用；待验证不等于坏了。
      这是带日期的盘点快照，不是实时健康检测。统计范围为已登记清单，未盘点的新功能不计入。
      {totals.total} 条是操作记录，含重复；{snapshot.rows.length - totals.total} 条导航或占位未计入。组合操作按主要作用计一次。
      页面、操作与 Workflow 数量不同，Workflow 是操作背后的处理过程。
    </p>

    <section aria-label="操作筛选" className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {[{ key: 'all', label: '全部' }, ...categories].map(item => <button key={item.key}
          aria-pressed={category === item.key} onClick={() => { setCategory(item.key as Category | 'all'); setLimit(30); }}
          className={`px-4 py-2 text-sm rounded-lg border ${category === item.key ? 'bg-sky-950 border-sky-700 text-sky-200' : 'border-slate-700 text-slate-400'}`}>
          {item.label}
        </button>)}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <label className="text-xs text-slate-400">搜索功能
          <input className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 p-2 text-sm text-white" value={search}
            placeholder="名称、页面或后台接口" onChange={e => { setSearch(e.target.value); setLimit(30); }} />
        </label>
        <label className="text-xs text-slate-400">验收状态
          <select className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 p-2 text-sm text-white" value={status}
            onChange={e => { setStatus(e.target.value as Status | 'all'); setLimit(30); }}>
            <option value="all">全部状态</option>
            {Object.entries(statusLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </label>
        <label className="text-xs text-slate-400">入口范围
          <select className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 p-2 text-sm text-white" value={navigationOnly ? 'navigation' : 'all'}
            onChange={e => { setNavigationOnly(e.target.value === 'navigation'); setLimit(30); }}>
            <option value="all">全站（含历史入口）</option><option value="navigation">当前主导航</option>
          </select>
        </label>
      </div>
      <p className="text-xs text-slate-500">符合条件 {filtered.length} 条 · 当前显示 {Math.min(limit, filtered.length)} 条</p>
    </section>

    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
      {filtered.slice(0, limit).map(item => <OperationCard key={item.id} item={item} />)}
    </div>
    {!filtered.length && <p className="py-8 text-center text-slate-400">没有符合条件的操作。</p>}
    {filtered.length > limit && <button className="px-4 py-2 rounded-lg border border-slate-700 text-sm" onClick={() => setLimit(limit + 30)}>显示更多</button>}
    <footer className="flex flex-wrap gap-4 border-t border-slate-800 pt-4 text-sm text-slate-400">
      <a href={snapshot.source} target="_blank" rel="noreferrer" className="hover:underline">Notion 完整功能清单</a>
      <a href={snapshot.report} target="_blank" rel="noreferrer" className="hover:underline">盘点依据与整理结论</a>
      <a href="/ledger" className="hover:underline">技术功能账本</a>
    </footer>
  </div>;
}
