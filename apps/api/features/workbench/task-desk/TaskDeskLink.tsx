import React from 'react';
import { Link } from 'react-router-dom';
export default function TaskDeskLink({ onNavigate }: { onNavigate?: () => void }) {
  return <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400">
    <p>聊天回复不代表交办成功。需要执行的事情，请到交办台提交并查看任务编号。</p>
    <Link to="/workbench/inbox" onClick={onNavigate} className="inline-flex min-h-8 items-center text-blue-300 underline">去交办台</Link>
  </div>;
}
