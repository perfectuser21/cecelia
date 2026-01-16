import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { BarChart3, Shield, Zap } from 'lucide-react';

// 飞书登录页面
export default function FeishuLogin() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [searchParams] = useSearchParams();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // 飞书应用配置（从环境变量读取）
  const APP_ID = import.meta.env.VITE_FEISHU_APP_ID;
  // 动态 redirect_uri：使用当前域名，确保登录后回到原域名
  const REDIRECT_URI = `${window.location.origin}/login`;

  useEffect(() => {
    // 检查是否有 code 参数（飞书回调）
    const code = searchParams.get('code');
    if (code) {
      handleFeishuCallback(code);
    }
  }, [searchParams]);

  // 处理飞书登录回调
  const handleFeishuCallback = async (code: string) => {
    setLoading(true);
    setError('');

    try {
      console.log('Received code from Feishu:', code);

      // 调用后端 API 处理飞书登录（后端有 app_secret）
      const response = await fetch(`/api/feishu-login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ code }),
      });

      const data = await response.json();
      console.log('Backend response:', data);

      if (data.success && data.user) {
        console.log('Login successful, user data:', data.user);
        console.log('🔑 你的飞书 ID:', data.user.feishu_user_id);
        login(data.user, data.user.access_token);
        navigate('/');
      } else {
        throw new Error(data.error || '登录失败');
      }
    } catch (err) {
      console.error('Feishu login error:', err);
      setError('登录失败，请重试');
      setLoading(false);
    }
  };

  // 发起飞书登录
  const handleLogin = () => {
    if (!APP_ID) {
      setError('飞书应用未配置，请联系管理员');
      return;
    }

    // 构造飞书登录 URL
    const feishuAuthUrl = `https://open.feishu.cn/open-apis/authen/v1/authorize?app_id=${APP_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&state=STATE`;

    // 跳转到飞书登录页面
    window.location.href = feishuAuthUrl;
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #1e3a8a 0%, #0f172a 100%)' }}>
        <div className="text-center">
          <img src="/logo-white.png" alt="Logo" className="h-14 mx-auto mb-8" />
          <p className="text-white/80 text-lg mb-6">正在为你准备一切...</p>
          {/* 品牌进度条 */}
          <div className="w-48 h-1 mx-auto bg-white/10 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full"
              style={{
                background: 'linear-gradient(90deg, #3467D6, #3C8CFD, #01C7D2)',
                animation: 'progressSlide 1.5s ease-in-out infinite',
              }}
            />
          </div>
          <style>{`
            @keyframes progressSlide {
              0% { width: 0%; margin-left: 0%; }
              50% { width: 60%; margin-left: 20%; }
              100% { width: 0%; margin-left: 100%; }
            }
          `}</style>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex" style={{ background: 'linear-gradient(135deg, #1e3a8a 0%, #0f172a 100%)' }}>
      {/* 左侧 - 品牌展示区 */}
      <div className="hidden lg:flex lg:w-1/2 xl:w-3/5 flex-col justify-between p-12 relative overflow-hidden">
        {/* 背景装饰 */}
        <div className="absolute inset-0 overflow-hidden">
          <div className="absolute -top-40 -left-40 w-80 h-80 rounded-full opacity-10 bg-blue-500" />
          <div className="absolute top-1/3 -right-20 w-60 h-60 rounded-full opacity-10 bg-sky-400" />
          <div className="absolute -bottom-20 left-1/4 w-40 h-40 rounded-full opacity-5 bg-cyan-400" />
        </div>

        {/* Logo */}
        <div className="relative z-10">
          <img src="/logo-white.png" alt="悦升云端科技" className="h-16" />
        </div>

        {/* 主标语 */}
        <div className="relative z-10 max-w-lg">
          <h2 className="text-4xl xl:text-5xl font-bold text-white leading-tight mb-6">
            回来啦
            <br />
            <span className="text-sky-400">这里一直等着你</span>
          </h2>
          <p className="text-white/60 text-lg leading-relaxed">
            你的专属空间，熟悉的工具，顺手的节奏。
          </p>
        </div>

        {/* 特性展示 */}
        <div className="relative z-10 grid grid-cols-3 gap-6">
          {[
            { icon: BarChart3, label: '数据都在', desc: '随时查看' },
            { icon: Shield, label: '账号放心', desc: '统一守护' },
            { icon: Zap, label: '简单顺手', desc: '少点折腾' },
          ].map((item, i) => (
            <div key={i} className="p-4 rounded-xl bg-white/5 backdrop-blur border border-white/10">
              <item.icon className="w-6 h-6 mb-3 text-sky-400" />
              <p className="text-white font-medium">{item.label}</p>
              <p className="text-white/50 text-sm">{item.desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* 右侧 - 登录区 */}
      <div className="w-full lg:w-1/2 xl:w-2/5 flex items-center justify-center p-8">
        <div className="w-full max-w-md">
          {/* 移动端 Logo */}
          <div className="lg:hidden text-center mb-10">
            <img src="/logo-white.png" alt="悦升云端科技" className="h-12 mx-auto" />
          </div>

          {/* 登录卡片 */}
          <div className="bg-white/5 backdrop-blur-xl rounded-3xl p-8 border border-white/10 shadow-2xl">
            <div className="text-center mb-8">
              <h3 className="text-2xl font-bold text-white mb-2">欢迎回家</h3>
              <p className="text-white/50">用飞书账号，一键进入</p>
            </div>

            {error && (
              <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-xl">
                <p className="text-red-400 text-sm text-center">{error}</p>
              </div>
            )}

            {/* 飞书登录按钮 */}
            <button
              onClick={handleLogin}
              className="group w-full flex items-center justify-center gap-3 px-6 py-4 rounded-xl font-medium text-white transition-all duration-300 hover:scale-[1.02] hover:shadow-lg bg-gradient-to-r from-blue-600 to-blue-700 shadow-blue-500/30"
            >
              {/* 飞书 Logo */}
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 15l-4-4 1.41-1.41L11 14.17l6.59-6.59L19 9l-8 8z" opacity="0"/>
                <path d="M6.265 6.264l11.47 11.471L12 22l-5.735-5.736L6.265 6.264z" fillOpacity="0.9"/>
                <path d="M17.736 6.264L6.265 17.736 12 22l5.736-5.736v-10z" fillOpacity="0.6"/>
                <path d="M12 2L6.265 6.264l5.735 5.735 5.736-5.735L12 2z" fillOpacity="0.8"/>
              </svg>
              <span>飞书登录</span>
            </button>

            {/* 分隔线 */}
            <div className="flex items-center gap-4 my-6">
              <div className="flex-1 h-px bg-white/10" />
              <span className="text-white/30 text-sm">团队专属</span>
              <div className="flex-1 h-px bg-white/10" />
            </div>

            {/* 说明文字 */}
            <p className="text-center text-white/40 text-sm leading-relaxed">
              遇到问题？随时找我们
            </p>
          </div>

          {/* 底部版权 */}
          <p className="text-center text-white/30 text-xs mt-8">
            © 2025 悦升云端科技 ZenithJoy
          </p>
        </div>
      </div>
    </div>
  );
}
