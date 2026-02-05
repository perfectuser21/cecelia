import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Target,
  ChevronLeft,
  AlertCircle,
  CheckCircle,
  Clock,
  MessageSquare,
  Send,
  Loader2,
  RefreshCw
} from 'lucide-react';
import { brainApi, type Goal, type PendingQuestion } from '../api';

// Status badge colors
const STATUS_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  pending: { bg: 'bg-gray-100', text: 'text-gray-700', label: '待开始' },
  needs_info: { bg: 'bg-yellow-100', text: 'text-yellow-700', label: '待补充' },
  ready: { bg: 'bg-blue-100', text: 'text-blue-700', label: '就绪' },
  decomposing: { bg: 'bg-purple-100', text: 'text-purple-700', label: '拆解中' },
  in_progress: { bg: 'bg-green-100', text: 'text-green-700', label: '进行中' },
  completed: { bg: 'bg-emerald-100', text: 'text-emerald-700', label: '已完成' },
  cancelled: { bg: 'bg-red-100', text: 'text-red-700', label: '已取消' }
};

const PRIORITY_COLORS: Record<string, string> = {
  P0: 'bg-red-500',
  P1: 'bg-orange-500',
  P2: 'bg-blue-500'
};

export default function GoalDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [goal, setGoal] = useState<Goal | null>(null);
  const [questions, setQuestions] = useState<PendingQuestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState<string | null>(null);

  // Fetch goal details
  const fetchGoal = async () => {
    if (!id) return;

    try {
      setLoading(true);
      setError(null);

      // Fetch goals list and find the one we need
      const goalsRes = await brainApi.getGoals();
      const foundGoal = goalsRes.data.find((g: Goal) => g.id === id);

      if (!foundGoal) {
        setError('目标不存在');
        return;
      }

      setGoal(foundGoal);

      // Fetch questions if status is needs_info
      if (foundGoal.status === 'needs_info') {
        const questionsRes = await brainApi.getQuestions(id);
        setQuestions(questionsRes.data.questions || []);
      }
    } catch (err: any) {
      setError(err.message || '加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchGoal();
  }, [id]);

  // Submit answer
  const handleSubmitAnswer = async (questionId: string) => {
    if (!id || !answers[questionId]?.trim()) return;

    try {
      setSubmitting(questionId);
      await brainApi.answerQuestion(id, questionId, answers[questionId]);

      // Refresh
      await fetchGoal();
      setAnswers(prev => ({ ...prev, [questionId]: '' }));
    } catch (err: any) {
      setError(err.message || '提交失败');
    } finally {
      setSubmitting(null);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }

  if (error || !goal) {
    return (
      <div className="min-h-screen bg-gray-50 p-6">
        <div className="max-w-4xl mx-auto">
          <button
            onClick={() => navigate(-1)}
            className="flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-6"
          >
            <ChevronLeft className="w-5 h-5" />
            返回
          </button>
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-red-500" />
            <span className="text-red-700">{error || '目标不存在'}</span>
          </div>
        </div>
      </div>
    );
  }

  const statusInfo = STATUS_COLORS[goal.status] || STATUS_COLORS.pending;
  const unansweredQuestions = questions.filter(q => !q.answered);

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <button
            onClick={() => navigate(-1)}
            className="flex items-center gap-2 text-gray-600 hover:text-gray-900"
          >
            <ChevronLeft className="w-5 h-5" />
            返回
          </button>
          <button
            onClick={fetchGoal}
            className="flex items-center gap-2 text-gray-600 hover:text-gray-900"
          >
            <RefreshCw className="w-4 h-4" />
            刷新
          </button>
        </div>

        {/* Goal Card */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
          {/* Title & Status */}
          <div className="flex items-start justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className={`w-2 h-2 rounded-full ${PRIORITY_COLORS[goal.priority]}`} />
              <h1 className="text-2xl font-bold text-gray-900">{goal.title}</h1>
            </div>
            <span className={`px-3 py-1 rounded-full text-sm font-medium ${statusInfo.bg} ${statusInfo.text}`}>
              {statusInfo.label}
            </span>
          </div>

          {/* Description */}
          {goal.description && (
            <p className="text-gray-600 mb-6">{goal.description}</p>
          )}

          {/* Progress */}
          <div className="mb-6">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-gray-500">进度</span>
              <span className="text-sm font-medium text-gray-700">{goal.progress}%</span>
            </div>
            <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-500 rounded-full transition-all duration-300"
                style={{ width: `${goal.progress}%` }}
              />
            </div>
          </div>

          {/* Meta */}
          <div className="flex items-center gap-6 text-sm text-gray-500">
            <div className="flex items-center gap-1">
              <Target className="w-4 h-4" />
              <span>{goal.priority}</span>
            </div>
            <div className="flex items-center gap-1">
              <Clock className="w-4 h-4" />
              <span>更新于 {new Date(goal.updated_at).toLocaleDateString('zh-CN')}</span>
            </div>
          </div>
        </div>

        {/* Questions Section (only show if needs_info) */}
        {goal.status === 'needs_info' && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <div className="flex items-center gap-2 mb-4">
              <MessageSquare className="w-5 h-5 text-yellow-500" />
              <h2 className="text-lg font-semibold text-gray-900">待回答问题</h2>
              {unansweredQuestions.length > 0 && (
                <span className="px-2 py-0.5 bg-yellow-100 text-yellow-700 text-xs rounded-full">
                  {unansweredQuestions.length} 个待回答
                </span>
              )}
            </div>

            {questions.length === 0 ? (
              <p className="text-gray-500 text-center py-4">暂无问题</p>
            ) : (
              <div className="space-y-4">
                {questions.map(question => (
                  <div
                    key={question.id}
                    className={`border rounded-lg p-4 ${
                      question.answered ? 'bg-green-50 border-green-200' : 'bg-gray-50 border-gray-200'
                    }`}
                  >
                    {/* Question */}
                    <div className="flex items-start gap-2 mb-3">
                      {question.answered ? (
                        <CheckCircle className="w-5 h-5 text-green-500 mt-0.5" />
                      ) : (
                        <AlertCircle className="w-5 h-5 text-yellow-500 mt-0.5" />
                      )}
                      <span className="font-medium text-gray-900">{question.question}</span>
                    </div>

                    {/* Answer or Input */}
                    {question.answered ? (
                      <div className="ml-7 p-3 bg-white rounded border border-green-200">
                        <p className="text-gray-700">{question.answer}</p>
                      </div>
                    ) : (
                      <div className="ml-7 flex gap-2">
                        <input
                          type="text"
                          value={answers[question.id] || ''}
                          onChange={e => setAnswers(prev => ({ ...prev, [question.id]: e.target.value }))}
                          placeholder="输入答案..."
                          className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                          onKeyDown={e => {
                            if (e.key === 'Enter') handleSubmitAnswer(question.id);
                          }}
                        />
                        <button
                          onClick={() => handleSubmitAnswer(question.id)}
                          disabled={!answers[question.id]?.trim() || submitting === question.id}
                          className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                        >
                          {submitting === question.id ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Send className="w-4 h-4" />
                          )}
                          提交
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Help text */}
            {unansweredQuestions.length > 0 && (
              <p className="mt-4 text-sm text-gray-500">
                回答所有问题后，目标状态将自动变为"就绪"，可以开始拆解任务。
              </p>
            )}
          </div>
        )}

        {/* Tasks will be shown here in future */}
        {goal.status !== 'needs_info' && goal.status !== 'pending' && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">关联任务</h2>
            <p className="text-gray-500 text-center py-4">任务列表功能开发中...</p>
          </div>
        )}
      </div>
    </div>
  );
}
