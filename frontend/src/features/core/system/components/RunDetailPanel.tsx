import { useState, useEffect } from 'react';
import { X, FileText, CheckCircle, XCircle, SkipForward } from 'lucide-react';

interface RunDetailPanelProps {
  runId: string | null;
  onClose: () => void;
}

export default function RunDetailPanel({ runId, onClose }: RunDetailPanelProps) {
  const [summary, setSummary] = useState<any>(null);
  const [result, setResult] = useState<any>(null);
  const [evidence, setEvidence] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'summary' | 'tests' | 'evidence'>('summary');

  useEffect(() => {
    if (!runId) {
      setLoading(false);
      return;
    }

    const fetchData = async () => {
      setLoading(true);
      try {
        const [summaryRes, resultRes, evidenceRes] = await Promise.all([
          fetch(`/api/quality/runs/${runId}`),
          fetch(`/api/quality/runs/${runId}/result`),
          fetch(`/api/quality/runs/${runId}/evidence`)
        ]);

        if (summaryRes.ok) setSummary(await summaryRes.json());
        if (resultRes.ok) setResult(await resultRes.json());
        if (evidenceRes.ok) setEvidence(await evidenceRes.json());
      } catch (err) {
        console.error('Failed to fetch run details:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [runId]);

  if (!runId) return null;

  return (
    <div className="fixed inset-y-0 right-0 w-[600px] bg-slate-800 border-l border-slate-700 shadow-2xl z-50 flex flex-col">
      <div className="flex items-center justify-between p-6 border-b border-slate-700">
        <h2 className="text-xl font-bold text-white">
          Run Detail: {runId.slice(0, 8)}...
        </h2>
        <button
          onClick={onClose}
          className="text-slate-400 hover:text-white p-2 rounded-lg hover:bg-slate-700"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="flex border-b border-slate-700">
        <button
          onClick={() => setActiveTab('summary')}
          className={`px-6 py-3 text-sm font-medium ${
            activeTab === 'summary'
              ? 'text-white border-b-2 border-blue-500'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          Summary
        </button>
        <button
          onClick={() => setActiveTab('tests')}
          className={`px-6 py-3 text-sm font-medium ${
            activeTab === 'tests'
              ? 'text-white border-b-2 border-blue-500'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          Tests
        </button>
        <button
          onClick={() => setActiveTab('evidence')}
          className={`px-6 py-3 text-sm font-medium ${
            activeTab === 'evidence'
              ? 'text-white border-b-2 border-blue-500'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          Evidence
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <p className="text-slate-400">Loading...</p>
        ) : (
          <>
            {activeTab === 'summary' && (
              <div className="space-y-4">
                <div>
                  <p className="text-sm text-slate-400">Intent</p>
                  <p className="text-white font-medium">{summary?.intent}</p>
                </div>
                <div>
                  <p className="text-sm text-slate-400">Source</p>
                  <p className="text-white font-medium">{summary?.source || 'N/A'}</p>
                </div>
                <div>
                  <p className="text-sm text-slate-400">Duration</p>
                  <p className="text-white font-medium">{summary?.duration}s</p>
                </div>
                <div>
                  <p className="text-sm text-slate-400">Status</p>
                  <span className={`px-2 py-1 text-xs rounded ${
                    summary?.status === 'completed'
                      ? 'bg-emerald-900/50 text-emerald-300'
                      : 'bg-red-900/50 text-red-300'
                  }`}>
                    {summary?.status}
                  </span>
                </div>
                {summary?.error && (
                  <div>
                    <p className="text-sm text-slate-400">Error</p>
                    <p className="text-red-400 font-mono text-sm">{summary.error}</p>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'tests' && result && (
              <div className="space-y-6">
                <div className="grid grid-cols-3 gap-4">
                  <div className="bg-emerald-900/20 border border-emerald-700 rounded-lg p-4">
                    <CheckCircle className="w-5 h-5 text-emerald-400 mb-2" />
                    <p className="text-2xl font-bold text-emerald-400">{result.tests?.passed || 0}</p>
                    <p className="text-sm text-emerald-300">Passed</p>
                  </div>
                  <div className="bg-red-900/20 border border-red-700 rounded-lg p-4">
                    <XCircle className="w-5 h-5 text-red-400 mb-2" />
                    <p className="text-2xl font-bold text-red-400">{result.tests?.failed || 0}</p>
                    <p className="text-sm text-red-300">Failed</p>
                  </div>
                  <div className="bg-yellow-900/20 border border-yellow-700 rounded-lg p-4">
                    <SkipForward className="w-5 h-5 text-yellow-400 mb-2" />
                    <p className="text-2xl font-bold text-yellow-400">{result.tests?.skipped || 0}</p>
                    <p className="text-sm text-yellow-300">Skipped</p>
                  </div>
                </div>

                {result.skipped_details && result.skipped_details.length > 0 && (
                  <div>
                    <h3 className="text-lg font-semibold text-white mb-3">Skipped Details</h3>
                    <div className="space-y-2">
                      {result.skipped_details.map((detail: any, idx: number) => (
                        <div key={idx} className="bg-slate-700/50 rounded-lg p-3">
                          <p className="text-white font-medium">{detail.id}</p>
                          <p className="text-sm text-slate-400 mt-1">Reason: {detail.reason}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'evidence' && (
              <div className="space-y-2">
                <h3 className="text-lg font-semibold text-white mb-3">
                  Evidence Files ({evidence.length})
                </h3>
                {evidence.length === 0 ? (
                  <p className="text-slate-400">No evidence files</p>
                ) : (
                  evidence.map(file => (
                    <a
                      key={file}
                      href={`/api/quality/runs/${runId}/logs/${file}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-3 p-3 bg-slate-700/50 rounded-lg hover:bg-slate-700 transition"
                    >
                      <FileText className="w-5 h-5 text-slate-400" />
                      <span className="text-white font-mono text-sm">{file}</span>
                    </a>
                  ))
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
