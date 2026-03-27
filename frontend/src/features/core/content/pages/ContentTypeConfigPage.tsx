import { useState, useEffect, useCallback } from 'react';

interface ContentTypeConfig {
  content_type: string;
  source: 'db' | 'yaml';
  config: {
    research_prompt?: string;
    generate_prompt?: string;
    review_prompt?: string;
    copy_rules?: {
      brand_keywords?: string[];
      banned_words?: string[];
      min_short_copy?: number;
      min_long_form?: number;
    };
  };
  updated_at?: string;
  updated_by?: string;
}

type TabKey = 'prompts' | 'copy_rules' | 'review_rules';

export default function ContentTypeConfigPage() {
  const [contentTypes, setContentTypes] = useState<string[]>([]);
  const [selectedType, setSelectedType] = useState<string>('');
  const [config, setConfig] = useState<ContentTypeConfig | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');
  const [activeTab, setActiveTab] = useState<TabKey>('prompts');

  // Edit state
  const [researchPrompt, setResearchPrompt] = useState('');
  const [generatePrompt, setGeneratePrompt] = useState('');
  const [reviewPrompt, setReviewPrompt] = useState('');
  const [brandKeywords, setBrandKeywords] = useState('');
  const [bannedWords, setBannedWords] = useState('');
  const [minShortCopy, setMinShortCopy] = useState('300');
  const [minLongForm, setMinLongForm] = useState('1000');

  useEffect(() => {
    fetch('/api/brain/content-types')
      .then(r => r.json())
      .then(data => {
        const types: string[] = Array.isArray(data) ? data.map((t: any) => t.content_type || t) : [];
        setContentTypes(types);
        if (types.length > 0) setSelectedType(types[0]);
      })
      .catch(() => setContentTypes([]));
  }, []);

  const loadConfig = useCallback((type: string) => {
    setLoading(true);
    setSaveMsg('');
    fetch(`/api/brain/content-types/${encodeURIComponent(type)}/config`)
      .then(r => r.json())
      .then((data: ContentTypeConfig) => {
        setConfig(data);
        setResearchPrompt(data.config?.research_prompt || '');
        setGeneratePrompt(data.config?.generate_prompt || '');
        setReviewPrompt(data.config?.review_prompt || '');
        setBrandKeywords((data.config?.copy_rules?.brand_keywords || []).join('\n'));
        setBannedWords((data.config?.copy_rules?.banned_words || []).join('\n'));
        setMinShortCopy(String(data.config?.copy_rules?.min_short_copy ?? 300));
        setMinLongForm(String(data.config?.copy_rules?.min_long_form ?? 1000));
      })
      .catch(() => setConfig(null))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (selectedType) loadConfig(selectedType);
  }, [selectedType, loadConfig]);

  const handleSave = async () => {
    if (!selectedType || !config) return;
    setSaving(true);
    setSaveMsg('');
    const updatedConfig = {
      ...config.config,
      research_prompt: researchPrompt,
      generate_prompt: generatePrompt,
      review_prompt: reviewPrompt,
      copy_rules: {
        ...config.config?.copy_rules,
        brand_keywords: brandKeywords.split('\n').map(s => s.trim()).filter(Boolean),
        banned_words: bannedWords.split('\n').map(s => s.trim()).filter(Boolean),
        min_short_copy: parseInt(minShortCopy, 10) || 300,
        min_long_form: parseInt(minLongForm, 10) || 1000,
      },
    };
    try {
      const res = await fetch(`/api/brain/content-types/${encodeURIComponent(selectedType)}/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: updatedConfig, updated_by: 'dashboard' }),
      });
      if (!res.ok) throw new Error('保存失败');
      setSaveMsg('✓ 已保存');
      loadConfig(selectedType);
    } catch (e: any) {
      setSaveMsg(`✗ ${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleSeed = async () => {
    setSeeding(true);
    setSaveMsg('');
    try {
      const res = await fetch('/api/brain/content-types/seed', { method: 'POST' });
      if (!res.ok) throw new Error('初始化失败');
      setSaveMsg('✓ 已从 YAML 初始化');
      if (selectedType) loadConfig(selectedType);
    } catch (e: any) {
      setSaveMsg(`✗ ${e.message}`);
    } finally {
      setSeeding(false);
    }
  };

  const tabs: { key: TabKey; label: string }[] = [
    { key: 'prompts', label: 'Prompts' },
    { key: 'copy_rules', label: '文案规则' },
    { key: 'review_rules', label: '审查规则' },
  ];

  return (
    <div style={{ display: 'flex', height: '100%', fontFamily: 'sans-serif' }}>
      {/* Left sidebar */}
      <div style={{ width: 200, borderRight: '1px solid #e5e7eb', padding: '16px 0', flexShrink: 0 }}>
        <div style={{ padding: '0 16px 12px', fontSize: 12, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase' }}>
          内容类型
        </div>
        {contentTypes.map(type => (
          <button
            key={type}
            onClick={() => setSelectedType(type)}
            style={{
              display: 'block', width: '100%', textAlign: 'left',
              padding: '8px 16px', border: 'none', cursor: 'pointer', fontSize: 14,
              background: selectedType === type ? '#eff6ff' : 'transparent',
              color: selectedType === type ? '#2563eb' : '#374151',
              fontWeight: selectedType === type ? 600 : 400,
            }}
          >
            {type}
          </button>
        ))}
        {contentTypes.length === 0 && (
          <div style={{ padding: '8px 16px', fontSize: 13, color: '#9ca3af' }}>
            无内容类型
            <br />
            <button
              onClick={handleSeed}
              disabled={seeding}
              style={{ marginTop: 8, fontSize: 12, padding: '4px 8px', cursor: 'pointer' }}
            >
              {seeding ? '初始化中…' : '从 YAML 初始化'}
            </button>
          </div>
        )}
      </div>

      {/* Right editor area */}
      <div style={{ flex: 1, padding: 24, overflow: 'auto' }}>
        {!selectedType ? (
          <div style={{ color: '#9ca3af', fontSize: 14 }}>请选择内容类型</div>
        ) : loading ? (
          <div style={{ color: '#9ca3af', fontSize: 14 }}>加载中…</div>
        ) : (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div>
                <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>{selectedType}</h2>
                {config && (
                  <span style={{ fontSize: 12, color: config.source === 'db' ? '#059669' : '#9ca3af' }}>
                    来源: {config.source === 'db' ? '数据库' : 'YAML（未自定义）'}
                    {config.updated_at && ` · ${new Date(config.updated_at).toLocaleString('zh-CN')}`}
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                {saveMsg && <span style={{ fontSize: 13, color: saveMsg.startsWith('✓') ? '#059669' : '#dc2626' }}>{saveMsg}</span>}
                <button
                  onClick={handleSeed}
                  disabled={seeding}
                  style={{ padding: '6px 12px', border: '1px solid #d1d5db', borderRadius: 4, cursor: 'pointer', fontSize: 13 }}
                >
                  {seeding ? '初始化中…' : '从 YAML 重置'}
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  style={{ padding: '6px 12px', background: '#2563eb', color: 'white', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 13 }}
                >
                  {saving ? '保存中…' : '保存'}
                </button>
              </div>
            </div>

            {/* Tabs */}
            <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid #e5e7eb', marginBottom: 20 }}>
              {tabs.map(tab => (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  style={{
                    padding: '8px 16px', border: 'none', cursor: 'pointer', fontSize: 14,
                    background: 'transparent', borderBottom: activeTab === tab.key ? '2px solid #2563eb' : '2px solid transparent',
                    color: activeTab === tab.key ? '#2563eb' : '#6b7280',
                    fontWeight: activeTab === tab.key ? 600 : 400,
                  }}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {activeTab === 'prompts' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                <PromptField label="调研 Prompt" value={researchPrompt} onChange={setResearchPrompt} />
                <PromptField label="生成 Prompt" value={generatePrompt} onChange={setGeneratePrompt} />
              </div>
            )}

            {activeTab === 'copy_rules' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <PromptField
                  label="品牌关键词（每行一个）"
                  value={brandKeywords}
                  onChange={setBrandKeywords}
                  rows={6}
                />
                <PromptField
                  label="禁用词（每行一个）"
                  value={bannedWords}
                  onChange={setBannedWords}
                  rows={6}
                />
                <div style={{ display: 'flex', gap: 16 }}>
                  <NumberField label="社交媒体文案最小字数" value={minShortCopy} onChange={setMinShortCopy} />
                  <NumberField label="长文最小字数" value={minLongForm} onChange={setMinLongForm} />
                </div>
              </div>
            )}

            {activeTab === 'review_rules' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                <PromptField label="审查 Prompt" value={reviewPrompt} onChange={setReviewPrompt} />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function PromptField({ label, value, onChange, rows = 8 }: {
  label: string; value: string; onChange: (v: string) => void; rows?: number;
}) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: '#374151', marginBottom: 4 }}>
        {label}
      </label>
      <textarea
        value={value}
        onChange={e => onChange(e.target.value)}
        rows={rows}
        style={{
          width: '100%', padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: 4,
          fontSize: 13, fontFamily: 'monospace', resize: 'vertical', boxSizing: 'border-box',
        }}
      />
    </div>
  );
}

function NumberField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: '#374151', marginBottom: 4 }}>
        {label}
      </label>
      <input
        type="number"
        value={value}
        onChange={e => onChange(e.target.value)}
        style={{ padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: 4, fontSize: 13, width: 120 }}
      />
    </div>
  );
}
