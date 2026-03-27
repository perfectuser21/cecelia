import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, CheckCircle, Clock, FileCode, ExternalLink } from 'lucide-react';
import { useApi } from '../../shared/hooks/useApi';

const KNOWLEDGE_BASE_URL = 'http://38.23.47.81:9998';

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

const PRIORITY_COLOR: Record<string, { bg: string; text: string; border: string }> = {
  P0: { bg: '#3a1515', text: '#f87171', border: '#5a2020' },
  P1: { bg: '#3a2e10', text: '#fbbf24', border: '#5a4520' },
  P2: { bg: '#1a1a1a', text: '#666', border: '#2a2a2a' },
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
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '200px', color: '#555' }}>
        加载中...
      </div>
    );
  }

  if (error || !data) {
    return (
      <div style={{ padding: '48px', textAlign: 'center', color: '#f87171' }}>
        加载失败：{error || '未知错误'}
      </div>
    );
  }

  const group = data.groups.find(g => g.id === groupId);
  const module = group?.items.find(i => i.id === moduleId);

  if (!group || !module) {
    return (
      <div style={{ padding: '48px', textAlign: 'center' }}>
        <p style={{ color: '#555', marginBottom: '16px' }}>模块不存在</p>
        <button
          onClick={() => navigate('/knowledge/modules')}
          style={{ background: 'none', border: 'none', color: '#3467D6', cursor: 'pointer', fontSize: '14px' }}
        >
          返回模块列表
        </button>
      </div>
    );
  }

  const isDone = module.status === 'done';
  const pColor = PRIORITY_COLOR[module.priority] || PRIORITY_COLOR.P2;

  return (
    <div style={{ background: '#0d0d0d', minHeight: '100%', padding: '32px' }}>
      <div style={{ maxWidth: '720px', margin: '0 auto' }}>
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
            marginBottom: '24px',
            padding: 0,
            transition: 'color 0.15s',
          }}
          onMouseEnter={e => (e.currentTarget.style.color = '#e2e8f0')}
          onMouseLeave={e => (e.currentTarget.style.color = '#555')}
        >
          <ArrowLeft size={14} />
          返回模块列表
        </button>

        {/* 标题卡片 */}
        <div style={{ background: '#111', border: '1px solid #1f1f1f', borderRadius: '12px', padding: '24px', marginBottom: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '16px', marginBottom: '12px' }}>
            <h1 style={{ fontSize: '20px', fontWeight: 700, color: '#fff', margin: 0, lineHeight: '1.3' }}>{module.title}</h1>
            <span style={{
              flexShrink: 0,
              fontSize: '11px',
              fontWeight: 700,
              padding: '4px 8px',
              borderRadius: '6px',
              background: pColor.bg,
              color: pColor.text,
              border: `1px solid ${pColor.border}`,
              fontFamily: 'monospace',
            }}>
              {module.priority} · {PRIORITY_LABEL[module.priority] || '一般'}
            </span>
          </div>
          <p style={{ fontSize: '14px', color: '#888', lineHeight: '1.7', margin: '0 0 16px' }}>{module.desc}</p>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px', fontSize: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: isDone ? '#22c55e' : '#555' }}>
              {isDone ? <CheckCircle size={13} /> : <Clock size={13} />}
              <span>{isDone ? `已完成 · ${module.completed || ''}` : '知识页待生成'}</span>
            </div>
            <span style={{ color: '#2a2a2a' }}>·</span>
            <span style={{ color: '#555' }}>{group.label}</span>
          </div>
        </div>

        {/* 来源文件 */}
        {module.source_files.length > 0 && (
          <div style={{ background: '#111', border: '1px solid #1f1f1f', borderRadius: '12px', padding: '20px', marginBottom: '16px' }}>
            <h2 style={{ fontSize: '12px', fontWeight: 600, color: '#555', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <FileCode size={12} />
              来源文件
            </h2>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {module.source_files.map(file => (
                <li key={file} style={{
                  fontSize: '12px',
                  fontFamily: 'monospace',
                  color: '#888',
                  background: '#0d0d0d',
                  border: '1px solid #1a1a1a',
                  borderRadius: '6px',
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
          <div style={{ background: '#0d1a2a', border: '1px solid #1a2a3a', borderRadius: '12px', padding: '20px' }}>
            <h2 style={{ fontSize: '12px', fontWeight: 600, color: '#3467D6', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '8px' }}>
              深度知识页
            </h2>
            <p style={{ fontSize: '13px', color: '#5a7a9a', marginBottom: '16px', lineHeight: '1.6' }}>
              此模块已由西安 Codex 生成完整的深度知识 HTML 页面。
            </p>
            <button
              onClick={() => window.open(`${KNOWLEDGE_BASE_URL}/${module.output_url}`, '_blank')}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                fontSize: '13px',
                fontWeight: 500,
                color: '#3467D6',
                background: '#111',
                border: '1px solid #1a2a3a',
                borderRadius: '8px',
                padding: '8px 16px',
                cursor: 'pointer',
                transition: 'border-color 0.15s, color 0.15s',
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLButtonElement).style.borderColor = '#3467D6';
                (e.currentTarget as HTMLButtonElement).style.color = '#6690e8';
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLButtonElement).style.borderColor = '#1a2a3a';
                (e.currentTarget as HTMLButtonElement).style.color = '#3467D6';
              }}
            >
              <ExternalLink size={13} />
              在新标签页打开
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
