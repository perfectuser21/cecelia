import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, AlertCircle } from 'lucide-react';

/**
 * 深度知识页查看器
 * 通过 fetch 获取 HTML 文件内容，用原生 React 渲染（不使用 iframe）
 * 路由：/knowledge/view?url=knowledge/brain/tick-loop.html
 */
export default function KnowledgePageViewer() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const htmlUrl = searchParams.get('url');

  const [html, setHtml] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!htmlUrl) {
      setError('缺少 url 参数');
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    setError(null);

    fetch(`/${htmlUrl}`, { signal: controller.signal })
      .then(res => {
        if (!res.ok) throw new Error(`加载失败（${res.status}）`);
        return res.text();
      })
      .then(text => {
        const parser = new DOMParser();
        const doc = parser.parseFromString(text, 'text/html');
        const body = doc.body?.innerHTML || text;
        setHtml(body);
      })
      .catch(err => {
        if (err.name !== 'AbortError') {
          setError(err.message || '页面加载失败');
        }
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [htmlUrl]);

  return (
    <div className="max-w-4xl mx-auto">
      <button
        onClick={() => navigate(-1)}
        className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 mb-6 transition-colors"
      >
        <ArrowLeft size={16} />
        <span>返回</span>
      </button>

      {loading && (
        <div className="flex items-center justify-center min-h-[300px]">
          <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {error && (
        <div className="flex items-center gap-3 bg-red-50 border border-red-200 rounded-xl p-5 text-red-700">
          <AlertCircle size={18} className="shrink-0" />
          <p className="text-sm">{error}</p>
        </div>
      )}

      {html && !loading && (
        <div
          className="bg-white border border-gray-200 rounded-xl p-8 prose prose-sm max-w-none
            [&_h1]:text-2xl [&_h1]:font-bold [&_h1]:mb-4 [&_h1]:text-gray-900
            [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:mt-6 [&_h2]:mb-3 [&_h2]:text-gray-800
            [&_h3]:text-base [&_h3]:font-semibold [&_h3]:mt-4 [&_h3]:mb-2 [&_h3]:text-gray-700
            [&_p]:text-sm [&_p]:text-gray-600 [&_p]:leading-relaxed [&_p]:mb-3
            [&_ul]:text-sm [&_ul]:text-gray-600 [&_ul]:mb-3 [&_ul]:pl-5 [&_ul]:list-disc
            [&_ol]:text-sm [&_ol]:text-gray-600 [&_ol]:mb-3 [&_ol]:pl-5 [&_ol]:list-decimal
            [&_li]:mb-1
            [&_table]:w-full [&_table]:text-sm [&_table]:border-collapse [&_table]:mb-4
            [&_th]:bg-gray-50 [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:font-medium [&_th]:text-gray-700 [&_th]:border [&_th]:border-gray-200
            [&_td]:px-3 [&_td]:py-2 [&_td]:text-gray-600 [&_td]:border [&_td]:border-gray-200
            [&_code]:bg-gray-100 [&_code]:text-sm [&_code]:font-mono [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded
            [&_pre]:bg-gray-900 [&_pre]:text-gray-100 [&_pre]:p-4 [&_pre]:rounded-lg [&_pre]:overflow-x-auto [&_pre]:text-xs [&_pre]:mb-4
            [&_pre_code]:bg-transparent [&_pre_code]:p-0
            [&_blockquote]:border-l-4 [&_blockquote]:border-blue-300 [&_blockquote]:pl-4 [&_blockquote]:text-gray-500 [&_blockquote]:italic [&_blockquote]:mb-3
            [&_hr]:border-gray-200 [&_hr]:my-6
            [&_a]:text-blue-600 [&_a]:hover:underline"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      )}
    </div>
  );
}
