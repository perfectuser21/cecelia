import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, CheckCircle, Clock, FileCode, BookOpen } from 'lucide-react';
import { useApi } from '../../shared/hooks/useApi';

interface ModuleItem {
  id: string;
  title: string;
  desc: string;
  priority: string;
  status: string;
  output_url: string | null;
  source_files: string[];
  completed: string | null;
}

interface ModuleGroup {
  id: string;
  label: string;
  items: ModuleItem[];
}

interface ModulesData {
  meta: Record<string, unknown>;
  groups: ModuleGroup[];
}

const PRIORITY_LABEL: Record<string, string> = {
  P0: '最高优先级',
  P1: '高优先级',
  P2: '一般',
};

const PRIORITY_STYLE: Record<string, React.CSSProperties> = {
  P0: { background: 'rgba(239,68,68,0.15)', color: '#f87171', border: '1px solid rgba(239,68,68,0.3)' },
  P1: { background: 'rgba(234,179,8,0.15)', color: '#fbbf24', border: '1px solid rgba(234,179,8,0.3)' },
  P2: { background: 'rgba(107,114,128,0.15)', color: '#6b7280', border: '1px solid rgba(107,114,128,0.2)' },
};

export default function KnowledgeModuleDetail() {
  const { groupId, moduleId } = useParams<{ groupId: string; moduleId: string }>();
  const navigate = useNavigate();

  const { data, loading, error } = useApi<ModulesData>(
    '/api/brain/knowledge/modules',
    { staleTime: 300_000 }
  );

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '200px' }}>
        <div style={{
          width: '28px', height: '28px',
          border: '3px solid #3467D6',
          borderTopColor: 'transparent',
          borderRadius: '50%',
          animation: 'spin 0.8s linear infinite',
        }} />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div style={{ textAlign: 'center', padding: '48px', color: '#f87171', fontSize: '14px' }}>
        加载失败：{error || '未知错误'}
      </div>
    );
  }

  const group = data.groups.find(g => g.id === groupId);
  const module = group?.items.find(i => i.id === moduleId);

  if (!group || !module) {
    return (
      <div style={{ textAlign: 'center', padding: '48px' }}>
        <p style={{ color: '#555', marginBottom: '16px', fontSize: '14px' }}>模块不存在</p>
        <button
          onClick={() => navigate('/knowledge/modules')}
          style={{ color: '#3467D6', background: 'none', border: 'none', cursor: 'pointer', fontSize: '13px' }}
        >
          返回模块列表
        </button>
      </div>
    );
  }

  const isDone = module.status === 'done';
  const priorityStyle = PRIORITY_STYLE[module.priority] || PRIORITY_STYLE.P2;

  return (
    <div style={{ maxWidth: '720px', margin: '0 auto', padding: '0 4px' }}>
      {/* 返回按钮 */}
      <button
        onClick={() => navigate('/knowledge/modules')}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          fontSize: '13px',
          color: '#555',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          padding: '0 0 20px',
          transition: 'color 0.15s',
        }}
        onMouseEnter={e => (e.currentTarget.style.color = '#aaa')}
        onMouseLeave={e => (e.currentTarget.style.color = '#555')}
      >
        <ArrowLeft size={15} />
        <span>返回模块列表</span>
      </button>

      {/* 标题卡片 */}
      <div style={{ background: '#141414', border: '1px solid #1f1f1f', borderRadius: '12px', padding: '24px', marginBottom: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '16px', marginBottom: '12px' }}>
          <h1 style={{ fontSize: '18px', fontWeight: 700, color: '#fff', margin: 0, lineHeight: '1.4' }}>
            {module.title}
          </h1>
          <span style={{
            flexShrink: 0,
            fontSize: '11px',
            fontWeight: 700,
            padding: '3px 8px',
            borderRadius: '5px',
            ...priorityStyle,
          }}>
            {module.priority} · {PRIORITY_LABEL[module.priority] || '一般'}
          </span>
        </div>
        <p style={{ fontSize: '13px', color: '#999', lineHeight: '1.7', margin: '0 0 16px' }}>
          {module.desc}
        </p>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', fontSize: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px', color: isDone ? '#4ade80' : '#555' }}>
            {isDone ? <CheckCircle size={13} /> : <Clock size={13} />}
            <span>{isDone ? `已完成 · ${module.completed || ''}` : '知识页待生成'}</span>
          </div>
          <span style={{ color: '#333' }}>·</span>
          <span style={{ color: '#555' }}>{group.label}</span>
        </div>
      </div>

      {/* 来源文件 */}
      {module.source_files.length > 0 && (
        <div style={{ background: '#141414', border: '1px solid #1f1f1f', borderRadius: '12px', padding: '20px', marginBottom: '16px' }}>
          <h2 style={{
            fontSize: '12px',
            fontWeight: 600,
            color: '#555',
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            marginBottom: '12px',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
          }}>
            <FileCode size={13} />
            来源文件
          </h2>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {module.source_files.map(file => (
              <li key={file} style={{
                fontSize: '12px',
                fontFamily: 'monospace',
                color: '#999',
                background: '#0d0d0d',
                borderRadius: '5px',
                padding: '6px 12px',
              }}>
                {file}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 知识页链接 */}
      {isDone && module.output_url && (
        <div style={{ background: 'rgba(52,103,214,0.08)', border: '1px solid rgba(52,103,214,0.25)', borderRadius: '12px', padding: '20px' }}>
          <h2 style={{
            fontSize: '12px',
            fontWeight: 600,
            color: '#3467D6',
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            marginBottom: '8px',
          }}>
            深度知识页
          </h2>
          <p style={{ fontSize: '13px', color: '#6b8fd6', marginBottom: '14px', lineHeight: '1.6' }}>
            此模块已由西安 Codex 生成完整的深度知识 HTML 页面。
          </p>
          <button
            onClick={() => window.open(`http://38.23.47.81:9998/${module.output_url}`, '_blank')}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '13px',
              fontWeight: 600,
              color: '#3467D6',
              background: '#0d0d0d',
              border: '1px solid rgba(52,103,214,0.4)',
              borderRadius: '7px',
              padding: '8px 16px',
              cursor: 'pointer',
              transition: 'border-color 0.15s',
            }}
            onMouseEnter={e => (e.currentTarget.style.borderColor = '#3467D6')}
            onMouseLeave={e => (e.currentTarget.style.borderColor = 'rgba(52,103,214,0.4)')}
          >
            <BookOpen size={13} />
            在新标签中查看
          </button>
        </div>
      )}
    </div>
  );
}
