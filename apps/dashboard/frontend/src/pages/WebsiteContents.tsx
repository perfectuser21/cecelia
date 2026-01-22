import React, { useState, useEffect } from 'react';
import {
  Plus,
  Edit2,
  Trash2,
  Eye,
  EyeOff,
  FileText,
  Film,
  MessageSquare,
  Loader2,
  ArrowLeft,
  Save,
  Globe,
  X,
} from 'lucide-react';
import type { WebsiteContent, CreateContentInput } from '../api/contents.api';
import { contentsApi } from '../api/contents.api';

type ViewMode = 'list' | 'create' | 'edit';
type ContentType = 'article' | 'video' | 'post';
type Lang = 'zh' | 'en';

// Status badge component
function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, { bg: string; text: string }> = {
    draft: { bg: 'bg-gray-100', text: 'text-gray-600' },
    published: { bg: 'bg-green-100', text: 'text-green-700' },
  };
  const style = styles[status] || styles.draft;
  const labels: Record<string, string> = {
    draft: '草稿',
    published: '已发布',
  };

  return (
    <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${style.bg} ${style.text}`}>
      {labels[status] || status}
    </span>
  );
}

// Content type icon
function ContentTypeIcon({ type }: { type: ContentType }) {
  const icons = {
    article: <FileText className="w-4 h-4" />,
    video: <Film className="w-4 h-4" />,
    post: <MessageSquare className="w-4 h-4" />,
  };
  const labels = {
    article: '文章',
    video: '视频',
    post: '帖子',
  };

  return (
    <span className="inline-flex items-center gap-1 text-sm text-gray-600">
      {icons[type]}
      {labels[type]}
    </span>
  );
}

// Language badge
function LangBadge({ lang }: { lang: Lang }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
      lang === 'zh' ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'
    }`}>
      {lang === 'zh' ? '中文' : 'EN'}
    </span>
  );
}

// FAQ Editor component
function FAQEditor({
  faq,
  onChange,
}: {
  faq: { question: string; answer: string }[];
  onChange: (faq: { question: string; answer: string }[]) => void;
}) {
  const addFAQ = () => {
    onChange([...faq, { question: '', answer: '' }]);
  };

  const updateFAQ = (index: number, field: 'question' | 'answer', value: string) => {
    const newFaq = [...faq];
    newFaq[index][field] = value;
    onChange(newFaq);
  };

  const removeFAQ = (index: number) => {
    onChange(faq.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-3">
      {faq.map((item, index) => (
        <div key={index} className="p-3 bg-gray-50 rounded-lg space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-gray-700">FAQ {index + 1}</span>
            <button
              type="button"
              onClick={() => removeFAQ(index)}
              className="text-red-500 hover:text-red-700"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <input
            type="text"
            value={item.question}
            onChange={(e) => updateFAQ(index, 'question', e.target.value)}
            placeholder="问题"
            className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent outline-none"
          />
          <textarea
            value={item.answer}
            onChange={(e) => updateFAQ(index, 'answer', e.target.value)}
            placeholder="答案"
            rows={2}
            className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent outline-none resize-none"
          />
        </div>
      ))}
      <button
        type="button"
        onClick={addFAQ}
        className="text-sm text-blue-600 hover:text-blue-800"
      >
        + 添加 FAQ
      </button>
    </div>
  );
}

// Tags Editor component
function TagsEditor({
  tags,
  onChange,
}: {
  tags: string[];
  onChange: (tags: string[]) => void;
}) {
  const [input, setInput] = useState('');

  const addTag = () => {
    if (input.trim() && !tags.includes(input.trim())) {
      onChange([...tags, input.trim()]);
      setInput('');
    }
  };

  const removeTag = (tag: string) => {
    onChange(tags.filter((t) => t !== tag));
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {tags.map((tag) => (
          <span
            key={tag}
            className="inline-flex items-center gap-1 px-2 py-1 bg-gray-100 rounded-full text-sm"
          >
            {tag}
            <button
              type="button"
              onClick={() => removeTag(tag)}
              className="text-gray-500 hover:text-gray-700"
            >
              <X className="w-3 h-3" />
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addTag())}
          placeholder="输入标签后按 Enter"
          className="flex-1 px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent outline-none"
        />
        <button
          type="button"
          onClick={addTag}
          className="px-3 py-2 bg-gray-100 rounded-lg hover:bg-gray-200"
        >
          添加
        </button>
      </div>
    </div>
  );
}

// List Editor component (for key_takeaways and quotable_insights)
function ListEditor({
  items,
  onChange,
  placeholder,
}: {
  items: string[];
  onChange: (items: string[]) => void;
  placeholder: string;
}) {
  const [input, setInput] = useState('');

  const addItem = () => {
    if (input.trim()) {
      onChange([...items, input.trim()]);
      setInput('');
    }
  };

  const removeItem = (index: number) => {
    onChange(items.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-2">
      {items.map((item, index) => (
        <div key={index} className="flex items-start gap-2">
          <span className="flex-1 p-2 bg-gray-50 rounded-lg text-sm">{item}</span>
          <button
            type="button"
            onClick={() => removeItem(index)}
            className="p-2 text-red-500 hover:text-red-700"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      ))}
      <div className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addItem())}
          placeholder={placeholder}
          className="flex-1 px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent outline-none"
        />
        <button
          type="button"
          onClick={addItem}
          className="px-3 py-2 bg-gray-100 rounded-lg hover:bg-gray-200"
        >
          添加
        </button>
      </div>
    </div>
  );
}

export default function WebsiteContents() {
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [contents, setContents] = useState<WebsiteContent[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Filters
  const [filterLang, setFilterLang] = useState<string>('');
  const [filterType, setFilterType] = useState<string>('');
  const [filterStatus, setFilterStatus] = useState<string>('');

  // Form state
  const [formData, setFormData] = useState<CreateContentInput>({
    slug: '',
    title: '',
    description: '',
    body: '',
    content_type: 'article',
    lang: 'zh',
    tags: [],
    reading_time: '',
    faq: [],
    key_takeaways: [],
    quotable_insights: [],
    video_url: '',
    thumbnail_url: '',
    status: 'draft',
  });

  useEffect(() => {
    loadContents();
  }, [filterLang, filterType, filterStatus]);

  const loadContents = async () => {
    setLoading(true);
    try {
      const result = await contentsApi.getAll({
        lang: filterLang || undefined,
        type: filterType || undefined,
        status: filterStatus || undefined,
        limit: 100,
      });
      setContents(result.data);
    } catch (error) {
      console.error('Failed to load contents:', error);
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setFormData({
      slug: '',
      title: '',
      description: '',
      body: '',
      content_type: 'article',
      lang: 'zh',
      tags: [],
      reading_time: '',
      faq: [],
      key_takeaways: [],
      quotable_insights: [],
      video_url: '',
      thumbnail_url: '',
      status: 'draft',
    });
    setEditingId(null);
  };

  const handleCreate = () => {
    resetForm();
    setViewMode('create');
  };

  const handleEdit = async (content: WebsiteContent) => {
    setFormData({
      slug: content.slug,
      title: content.title,
      description: content.description || '',
      body: content.body || '',
      content_type: content.content_type,
      lang: content.lang,
      tags: content.tags,
      reading_time: content.reading_time || '',
      faq: content.faq,
      key_takeaways: content.key_takeaways,
      quotable_insights: content.quotable_insights,
      video_url: content.video_url || '',
      thumbnail_url: content.thumbnail_url || '',
      status: content.status,
    });
    setEditingId(content.id);
    setViewMode('edit');
  };

  const handleSave = async () => {
    if (!formData.slug || !formData.title) {
      alert('请填写 Slug 和标题');
      return;
    }

    setSubmitting(true);
    try {
      if (editingId) {
        await contentsApi.update(editingId, formData);
      } else {
        await contentsApi.create(formData);
      }
      resetForm();
      setViewMode('list');
      await loadContents();
    } catch (error: any) {
      alert(error.response?.data?.error || '保存失败');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('确定要删除这个内容吗？')) return;

    try {
      await contentsApi.delete(id);
      await loadContents();
    } catch (error: any) {
      alert(error.response?.data?.error || '删除失败');
    }
  };

  const handlePublish = async (id: string) => {
    try {
      await contentsApi.publish(id);
      await loadContents();
    } catch (error: any) {
      alert(error.response?.data?.error || '发布失败');
    }
  };

  const handleUnpublish = async (id: string) => {
    try {
      await contentsApi.unpublish(id);
      await loadContents();
    } catch (error: any) {
      alert(error.response?.data?.error || '撤回失败');
    }
  };

  if (loading && viewMode === 'list') {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
      </div>
    );
  }

  // List view
  if (viewMode === 'list') {
    return (
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">网站内容管理</h1>
            <p className="text-gray-500 mt-1">管理 zenithjoyai.com 网站上显示的内容</p>
          </div>
          <button
            onClick={handleCreate}
            className="flex items-center gap-2 px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors"
          >
            <Plus className="w-5 h-5" />
            创建内容
          </button>
        </div>

        {/* Filters */}
        <div className="flex gap-4 mb-6">
          <select
            value={filterLang}
            onChange={(e) => setFilterLang(e.target.value)}
            className="px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent outline-none"
          >
            <option value="">全部语言</option>
            <option value="zh">中文</option>
            <option value="en">English</option>
          </select>
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            className="px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent outline-none"
          >
            <option value="">全部类型</option>
            <option value="article">文章</option>
            <option value="video">视频</option>
            <option value="post">帖子</option>
          </select>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent outline-none"
          >
            <option value="">全部状态</option>
            <option value="draft">草稿</option>
            <option value="published">已发布</option>
          </select>
        </div>

        {/* Content list */}
        {contents.length === 0 ? (
          <div className="text-center py-16 bg-white rounded-xl border border-gray-200">
            <Globe className="w-16 h-16 mx-auto text-gray-300 mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">暂无内容</h3>
            <p className="text-gray-500 mb-6">点击上方按钮创建第一个内容</p>
            <button
              onClick={handleCreate}
              className="inline-flex items-center gap-2 px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors"
            >
              <Plus className="w-5 h-5" />
              创建内容
            </button>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">标题</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">类型</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">语言</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">状态</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">更新时间</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {contents.map((content) => (
                  <tr key={content.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4">
                      <div className="font-medium text-gray-900">{content.title}</div>
                      <div className="text-sm text-gray-500">/{content.lang}/blog/{content.slug}</div>
                    </td>
                    <td className="px-6 py-4">
                      <ContentTypeIcon type={content.content_type} />
                    </td>
                    <td className="px-6 py-4">
                      <LangBadge lang={content.lang} />
                    </td>
                    <td className="px-6 py-4">
                      <StatusBadge status={content.status} />
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-500">
                      {new Date(content.updated_at).toLocaleString('zh-CN')}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => handleEdit(content)}
                          className="p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg"
                          title="编辑"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        {content.status === 'draft' ? (
                          <button
                            onClick={() => handlePublish(content.id)}
                            className="p-2 text-green-600 hover:text-green-800 hover:bg-green-50 rounded-lg"
                            title="发布"
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                        ) : (
                          <button
                            onClick={() => handleUnpublish(content.id)}
                            className="p-2 text-orange-600 hover:text-orange-800 hover:bg-orange-50 rounded-lg"
                            title="撤回"
                          >
                            <EyeOff className="w-4 h-4" />
                          </button>
                        )}
                        <button
                          onClick={() => handleDelete(content.id)}
                          className="p-2 text-red-600 hover:text-red-800 hover:bg-red-50 rounded-lg"
                          title="删除"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  }

  // Create/Edit form
  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-4 mb-8">
        <button
          onClick={() => {
            resetForm();
            setViewMode('list');
          }}
          className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
        >
          <ArrowLeft className="w-5 h-5 text-gray-600" />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            {viewMode === 'create' ? '创建内容' : '编辑内容'}
          </h1>
          <p className="text-gray-500 mt-1">
            {viewMode === 'create' ? '创建新的网站内容' : '修改现有内容'}
          </p>
        </div>
      </div>

      <div className="space-y-6">
        {/* Basic info */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">内容类型 *</label>
            <select
              value={formData.content_type}
              onChange={(e) => setFormData({ ...formData, content_type: e.target.value as ContentType })}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent outline-none"
            >
              <option value="article">文章</option>
              <option value="video">视频</option>
              <option value="post">帖子</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">语言 *</label>
            <select
              value={formData.lang}
              onChange={(e) => setFormData({ ...formData, lang: e.target.value as Lang })}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent outline-none"
            >
              <option value="zh">中文</option>
              <option value="en">English</option>
            </select>
          </div>
        </div>

        {/* Slug and Title */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Slug *</label>
          <input
            type="text"
            value={formData.slug}
            onChange={(e) => setFormData({ ...formData, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') })}
            placeholder="url-friendly-slug"
            className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent outline-none"
          />
          <p className="text-xs text-gray-500 mt-1">访问地址: /{formData.lang}/blog/{formData.slug || 'your-slug'}</p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">标题 *</label>
          <input
            type="text"
            value={formData.title}
            onChange={(e) => setFormData({ ...formData, title: e.target.value })}
            placeholder="输入内容标题"
            className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent outline-none"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">描述 (SEO)</label>
          <textarea
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            placeholder="简短的内容描述，用于 SEO"
            rows={2}
            className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent outline-none resize-none"
          />
        </div>

        {/* Video URL (for video type) */}
        {formData.content_type === 'video' && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">视频链接</label>
            <input
              type="url"
              value={formData.video_url}
              onChange={(e) => setFormData({ ...formData, video_url: e.target.value })}
              placeholder="https://..."
              className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent outline-none"
            />
          </div>
        )}

        {/* Body (Markdown) */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">正文 (Markdown)</label>
          <textarea
            value={formData.body}
            onChange={(e) => setFormData({ ...formData, body: e.target.value })}
            placeholder="支持 Markdown 格式"
            rows={12}
            className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent outline-none font-mono text-sm"
          />
        </div>

        {/* Reading time */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">阅读时长</label>
            <input
              type="text"
              value={formData.reading_time}
              onChange={(e) => setFormData({ ...formData, reading_time: e.target.value })}
              placeholder="5 分钟"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">缩略图 URL</label>
            <input
              type="url"
              value={formData.thumbnail_url}
              onChange={(e) => setFormData({ ...formData, thumbnail_url: e.target.value })}
              placeholder="https://..."
              className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-gray-900 focus:border-transparent outline-none"
            />
          </div>
        </div>

        {/* Tags */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">标签</label>
          <TagsEditor
            tags={formData.tags || []}
            onChange={(tags) => setFormData({ ...formData, tags })}
          />
        </div>

        {/* GEO Optimization */}
        <div className="p-4 bg-blue-50 rounded-xl space-y-4">
          <h3 className="font-medium text-blue-900">GEO 优化 (AI 可引用性)</h3>

          <div>
            <label className="block text-sm font-medium text-blue-800 mb-2">核心要点 (Key Takeaways)</label>
            <ListEditor
              items={formData.key_takeaways || []}
              onChange={(items) => setFormData({ ...formData, key_takeaways: items })}
              placeholder="输入一个核心要点"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-blue-800 mb-2">可引用金句 (Quotable Insights)</label>
            <ListEditor
              items={formData.quotable_insights || []}
              onChange={(items) => setFormData({ ...formData, quotable_insights: items })}
              placeholder="输入一个可引用的金句"
            />
          </div>
        </div>

        {/* FAQ */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">常见问题 (FAQ)</label>
          <FAQEditor
            faq={formData.faq || []}
            onChange={(faq) => setFormData({ ...formData, faq })}
          />
        </div>

        {/* Actions */}
        <div className="flex items-center gap-4 pt-4 border-t border-gray-200">
          <button
            onClick={handleSave}
            disabled={submitting}
            className="flex items-center gap-2 px-6 py-3 bg-gray-900 text-white rounded-xl hover:bg-gray-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <Save className="w-5 h-5" />
            )}
            保存
          </button>
          <button
            onClick={() => {
              resetForm();
              setViewMode('list');
            }}
            disabled={submitting}
            className="px-6 py-3 text-gray-500 hover:text-gray-700 transition-colors"
          >
            取消
          </button>
        </div>
      </div>
    </div>
  );
}
