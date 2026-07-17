import { useState } from "react";
import { ArrowRight, BookOpenText, Database, KeyRound, Loader2, Mail, Server, Sparkles } from "lucide-react";
import { confirmPasswordReset, requestPasswordReset } from "../services/auth";

type AuthMode = "sign-in" | "sign-up";

interface LoginPageProps {
  onSignIn: (email: string, password: string) => Promise<void>;
  onSignUp: (email: string, password: string, displayName: string) => Promise<void>;
}

function modeCopy(mode: AuthMode) {
  if (mode === "sign-up") {
    return {
      title: "创建 NoteFlow 账号",
      subtitle: "注册后会在你的服务器 PostgreSQL 中创建独立知识库",
      button: "创建账号",
    };
  }

  return {
    title: "登录 NoteFlow",
    subtitle: "进入你的个人知识库",
    button: "登录",
  };
}

export default function LoginPage({ onSignIn, onSignUp }: LoginPageProps) {
  const initialResetParams = new URLSearchParams(window.location.search);
  const [mode, setMode] = useState<AuthMode>("sign-in");
  const [resetOpen, setResetOpen] = useState(Boolean(initialResetParams.get("resetToken")));
  const [resetToken, setResetToken] = useState(initialResetParams.get("resetToken") ?? "");
  const [email, setEmail] = useState(initialResetParams.get("resetEmail") ?? "");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const copy = modeCopy(mode);
  const canSubmit = email.trim().length > 0 && password.length >= (mode === "sign-up" ? 8 : 6);

  const resetFeedback = () => {
    setError("");
    setNotice("");
  };

  const handlePasswordReset = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    resetFeedback();
    if (!email.trim()) {
      setError("请输入账号邮箱。");
      return;
    }
    if (resetToken && password.length < 8) {
      setError("新密码至少需要 8 位。");
      return;
    }
    setLoading(true);
    try {
      if (resetToken) {
        const message = await confirmPasswordReset(email.trim(), resetToken, password);
        setNotice(message);
        setResetOpen(false);
        setResetToken("");
        setPassword("");
        window.history.replaceState({}, "", window.location.pathname);
      } else {
        const result = await requestPasswordReset(email.trim());
        setNotice(result.message);
        if (result.developmentToken) {
          setResetToken(result.developmentToken);
          setNotice("开发环境已生成一次性令牌，请设置新密码。");
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "密码重置失败，请稍后重试。");
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    resetFeedback();

    if (!canSubmit) {
      setError(`请输入邮箱，并确保密码至少 ${mode === "sign-up" ? 8 : 6} 位。`);
      return;
    }

    setLoading(true);
    try {
      if (mode === "sign-in") {
        await onSignIn(email.trim(), password);
      } else {
        await onSignUp(email.trim(), password, displayName.trim());
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "登录失败，请稍后重试。");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="flex h-full min-h-0 bg-jelly-bg p-3">
      <div className="app-frame grid min-h-0 w-full grid-cols-1 overflow-hidden lg:grid-cols-[minmax(0,0.95fr)_minmax(420px,520px)]">
        <section className="relative hidden min-h-0 overflow-hidden border-r border-jelly-border bg-jelly-surface px-10 py-10 lg:block">
          <div className="flex items-center gap-3">
            <img
              src="/noteflow_icon.svg"
              alt="NoteFlow"
              className="h-10 w-10 rounded-md shadow-[0_10px_24px_rgba(61,111,142,0.24)]"
            />
            <div>
              <p className="text-[15px] font-semibold text-jelly-text">NoteFlow</p>
              <p className="text-[12px] text-jelly-text-muted">个人知识库</p>
            </div>
          </div>

          <div className="mt-24 max-w-[560px]">
            <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-jelly-border bg-white px-3 py-1 text-[12px] font-medium text-jelly-blue-deep">
              <Sparkles size={14} strokeWidth={1.8} />
              FastAPI + PostgreSQL
            </p>
            <h1 className="text-[2.6rem] font-semibold leading-tight tracking-normal text-jelly-text">
              自己掌控登录、数据和 AI 服务
            </h1>
            <p className="mt-5 max-w-[460px] text-[14px] leading-7 text-jelly-text-soft">
              账号、知识库和 AI 接口都通过自有 Python 后端处理，部署在同一台服务器上，访问链路更直接。
            </p>
          </div>

          <div className="absolute bottom-8 left-10 right-10 grid grid-cols-3 gap-3">
            {[
              { icon: Server, label: "Python 后端" },
              { icon: Database, label: "pgvector 存储" },
              { icon: BookOpenText, label: "个人知识库" },
            ].map((item) => {
              const Icon = item.icon;
              return (
                <div key={item.label} className="rounded-md border border-jelly-border bg-white px-4 py-3">
                  <Icon size={17} className="text-jelly-blue-deep" strokeWidth={1.8} />
                  <p className="mt-2 text-[12px] font-medium text-jelly-text">{item.label}</p>
                </div>
              );
            })}
          </div>
        </section>

        <section className="flex min-h-0 items-center justify-center px-6 py-8">
          <div className="w-full max-w-[360px]">
            <div className="mb-8 lg:hidden">
              <img
                src="/noteflow_icon.svg"
                alt="NoteFlow"
                className="mb-5 h-10 w-10 rounded-md"
              />
              <p className="text-[13px] font-medium text-jelly-blue-deep">NoteFlow</p>
            </div>

            <div className="mb-6">
              <h1 className="text-[1.55rem] font-semibold leading-tight text-jelly-text">
                {resetOpen ? (resetToken ? "设置新密码" : "找回密码") : copy.title}
              </h1>
              <p className="mt-2 text-[13px] text-jelly-text-muted">
                {resetOpen ? (resetToken ? "新密码会使用 Argon2id 安全保存，并退出其他设备。" : "输入邮箱以获取一次性重置链接。") : copy.subtitle}
              </p>
            </div>

            {!resetOpen && <div className="mb-5 grid grid-cols-2 rounded-md border border-jelly-border bg-jelly-blue-pale p-1">
              {[
                { id: "sign-in", label: "登录" },
                { id: "sign-up", label: "注册" },
              ].map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setMode(item.id as AuthMode);
                    resetFeedback();
                  }}
                  className={`h-8 rounded-[5px] text-[12px] font-medium transition-colors ${
                    mode === item.id
                      ? "bg-white text-jelly-blue-deep shadow-[0_4px_12px_rgba(22,34,45,0.08)]"
                      : "text-jelly-text-soft hover:text-jelly-text"
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>}

            <form className="space-y-4" onSubmit={resetOpen ? handlePasswordReset : handleSubmit}>
              {mode === "sign-up" && (
                <label className="block">
                  <span className="mb-1.5 block text-[12px] font-medium text-jelly-text-soft">
                    昵称
                  </span>
                  <input
                    value={displayName}
                    onChange={(event) => setDisplayName(event.target.value)}
                    className="ui-input h-10 w-full px-3 text-[13px] outline-none placeholder:text-jelly-text-muted"
                    placeholder="Cheng"
                  />
                </label>
              )}

              <label className="block">
                <span className="mb-1.5 block text-[12px] font-medium text-jelly-text-soft">
                  邮箱
                </span>
                <div className="ui-input flex h-10 items-center gap-2 px-3">
                  <Mail size={15} className="text-jelly-text-muted" strokeWidth={1.8} />
                  <input
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    className="min-w-0 flex-1 bg-transparent text-[13px] text-jelly-text outline-none placeholder:text-jelly-text-muted"
                    placeholder="you@example.com"
                  />
                </div>
              </label>

              {(!resetOpen || Boolean(resetToken)) && <label className="block">
                <span className="mb-1.5 block text-[12px] font-medium text-jelly-text-soft">
                  密码
                </span>
                <div className="ui-input flex h-10 items-center gap-2 px-3">
                  <KeyRound size={15} className="text-jelly-text-muted" strokeWidth={1.8} />
                  <input
                    type="password"
                    autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    className="min-w-0 flex-1 bg-transparent text-[13px] text-jelly-text outline-none placeholder:text-jelly-text-muted"
                    placeholder={mode === "sign-in" && !resetOpen ? "至少 6 位" : "至少 8 位"}
                  />
                </div>
              </label>}

              {!resetOpen && mode === "sign-in" && (
                <button
                  type="button"
                  onClick={() => {
                    setResetOpen(true);
                    setPassword("");
                    resetFeedback();
                  }}
                  className="text-[12px] font-medium text-jelly-blue-deep hover:underline"
                >
                  忘记密码？
                </button>
              )}

              {error && (
                <p className="rounded-md border border-jelly-red/25 bg-jelly-red-bg px-3 py-2 text-[13px] leading-5 text-jelly-red">
                  {error}
                </p>
              )}
              {notice && (
                <p className="rounded-md border border-jelly-green/25 bg-jelly-green-bg px-3 py-2 text-[13px] leading-5 text-jelly-green">
                  {notice}
                </p>
              )}

              <button
                type="submit"
                disabled={loading || (resetOpen ? !email.trim() || Boolean(resetToken && password.length < 8) : !canSubmit)}
                className="ui-button ui-button-primary h-10 w-full px-4"
              >
                {loading ? (
                  <Loader2 size={16} className="animate-spin" strokeWidth={1.9} />
                ) : (
                  <ArrowRight size={16} strokeWidth={1.9} />
                )}
                {resetOpen ? (resetToken ? "更新密码" : "发送重置说明") : copy.button}
              </button>
              {resetOpen && (
                <button
                  type="button"
                  onClick={() => {
                    setResetOpen(false);
                    setResetToken("");
                    setPassword("");
                    resetFeedback();
                  }}
                  className="ui-button ui-button-secondary h-10 w-full px-4"
                >
                  返回登录
                </button>
              )}
            </form>
          </div>
        </section>
      </div>
    </main>
  );
}
