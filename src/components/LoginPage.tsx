import { useEffect, useId, useState } from "react";
import {
  AlertCircle,
  ArrowRight,
  Check,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  LockKeyhole,
  Mail,
  ShieldCheck,
} from "lucide-react";
import {
  confirmPasswordReset,
  requestEmailLoginCode,
  requestPasswordReset,
} from "../services/auth";

type AuthMode = "email-code" | "password";

interface LoginPageProps {
  onSignIn: (email: string, password: string) => Promise<void>;
  onEmailCodeSignIn: (email: string, code: string) => Promise<void>;
  onSignUp: (email: string, password: string, displayName: string) => Promise<void>;
}

const authCopy = {
  "email-code": {
    button: "登录",
  },
  password: {
    button: "登录",
  },
} satisfies Record<AuthMode, { button: string }>;

export default function LoginPage({ onSignIn, onEmailCodeSignIn }: LoginPageProps) {
  const emailId = useId();
  const passwordId = useId();
  const codeId = useId();
  const feedbackId = useId();
  const [mode, setMode] = useState<AuthMode>("email-code");
  const [resetOpen, setResetOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [emailCode, setEmailCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [resendSeconds, setResendSeconds] = useState(0);
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [capsLockOn, setCapsLockOn] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sendingCode, setSendingCode] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const copy = authCopy[mode];

  useEffect(() => {
    if (resendSeconds <= 0) return;
    const timer = window.setInterval(() => {
      setResendSeconds((seconds) => Math.max(0, seconds - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [resendSeconds]);

  const resetFeedback = () => {
    setError("");
    setNotice("");
  };

  const leaveReset = () => {
    setResetOpen(false);
    setPassword("");
    setEmailCode("");
    setCodeSent(false);
    setResendSeconds(0);
    setPasswordVisible(false);
    resetFeedback();
  };

  const handleModeChange = (nextMode: AuthMode) => {
    setMode(nextMode);
    setPassword("");
    setEmailCode("");
    setCodeSent(false);
    setResendSeconds(0);
    setPasswordVisible(false);
    resetFeedback();
  };

  const handleSendCode = async () => {
    resetFeedback();
    if (!email.trim()) {
      setError("请先输入邮箱地址。");
      return;
    }
    setSendingCode(true);
    try {
      const result = resetOpen
        ? await requestPasswordReset(email.trim())
        : await requestEmailLoginCode(email.trim());
      setCodeSent(true);
      setResendSeconds(60);
      setNotice(result.message);
      const developmentCode = "developmentCode" in result
        ? result.developmentCode
        : undefined;
      if (!resetOpen && typeof developmentCode === "string" && developmentCode) {
        setEmailCode(developmentCode);
        setNotice("开发环境验证码已自动填入。");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "验证码发送失败，请稍后重试。");
    } finally {
      setSendingCode(false);
    }
  };

  const handlePasswordReset = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    resetFeedback();
    if (!email.trim()) {
      setError("请输入账号邮箱。");
      return;
    }
    if (!/^\d{6}$/.test(emailCode)) {
      setError("请输入邮件中的 6 位验证码。");
      return;
    }
    if (password.length < 8) {
      setError("新密码至少需要 8 位。");
      return;
    }
    setLoading(true);
    try {
      const message = await confirmPasswordReset(email.trim(), emailCode, password);
      setNotice(message);
      setResetOpen(false);
      setMode("password");
      setEmailCode("");
      setCodeSent(false);
      setResendSeconds(0);
      setPassword("");
      setPasswordVisible(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "密码重置失败，请稍后重试。");
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    resetFeedback();
    if (!email.trim()) {
      setError("请输入有效邮箱。");
      return;
    }
    if (mode === "email-code" && !/^\d{6}$/.test(emailCode)) {
      setError("请输入邮件中的 6 位验证码。");
      return;
    }
    if (mode === "password" && password.length < 6) {
      setError("密码至少需要 6 位。");
      return;
    }

    setLoading(true);
    try {
      if (mode === "email-code") {
        await onEmailCodeSignIn(email.trim(), emailCode);
      } else {
        await onSignIn(email.trim(), password);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "登录失败，请稍后重试。");
    } finally {
      setLoading(false);
    }
  };

  const title = resetOpen ? "重置密码" : "登录 NoteFlow";
  const showPassword = (mode === "password" && !resetOpen) || resetOpen;
  const submitDisabled = loading || sendingCode || !email.trim() || (
    resetOpen
      ? !/^\d{6}$/.test(emailCode) || password.length < 8
      : mode === "email-code"
        ? !/^\d{6}$/.test(emailCode)
        : password.length < 6
  );

  return (
    <main className="login-page">
      <div className="login-layout">
        <section className="login-form-panel">
          <div className="login-mobile-brand">
            <img src="/noteflow_icon.svg" alt="" />
            <span>NoteFlow</span>
          </div>

          <div className="login-form-wrap">
            <div className="login-heading">
              <h2>{title}</h2>
            </div>

            {!resetOpen && (
              <div className="login-mode-switch" role="group" aria-label="选择登录方式">
                {([["email-code", "验证码登录"], ["password", "密码登录"]] as const).map(([id, label]) => (
                  <button key={id} type="button" aria-pressed={mode === id} onClick={() => handleModeChange(id)} className={mode === id ? "active" : ""}>
                    {label}
                  </button>
                ))}
              </div>
            )}

            <form className="login-form" onSubmit={resetOpen ? handlePasswordReset : handleSubmit} aria-describedby={error || notice ? feedbackId : undefined}>
              <label className="login-field" htmlFor={emailId}>
                <span>邮箱</span>
                <div className="login-input-shell">
                  <Mail size={17} aria-hidden="true" />
                  <input id={emailId} type="email" inputMode="email" autoComplete="email" autoFocus required value={email} onChange={(event) => { setEmail(event.target.value); if (codeSent) { setCodeSent(false); setEmailCode(""); setResendSeconds(0); } }} placeholder="name@example.com" />
                </div>
              </label>

              {(resetOpen || mode === "email-code") && (
                <div className="login-field">
                  <span><label htmlFor={codeId}>{resetOpen ? "邮箱验证码" : "验证码"}</label></span>
                  <div className="login-input-shell login-code-shell">
                    <ShieldCheck size={17} aria-hidden="true" />
                    <input id={codeId} type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={emailCode} onChange={(event) => setEmailCode(event.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="输入验证码" />
                    <button type="button" className="login-code-button" disabled={sendingCode || resendSeconds > 0 || !email.trim()} onClick={() => void handleSendCode()}>
                      {sendingCode ? "发送中…" : resendSeconds > 0 ? `${resendSeconds}s` : codeSent ? "重新发送" : "获取验证码"}
                    </button>
                  </div>
                </div>
              )}

              {showPassword && (
                <div className="login-field">
                  <span>
                    <label htmlFor={passwordId}>{resetOpen ? "新密码" : "密码"}</label>
                    {!resetOpen && (
                      <button type="button" className="login-forgot-link" onClick={() => { setResetOpen(true); setPassword(""); setEmailCode(""); setCodeSent(false); setResendSeconds(0); setPasswordVisible(false); resetFeedback(); }}>
                        忘记密码？
                      </button>
                    )}
                  </span>
                  <div className="login-input-shell">
                    <KeyRound size={17} aria-hidden="true" />
                    <input
                      id={passwordId}
                      type={passwordVisible ? "text" : "password"}
                      autoComplete={!resetOpen ? "current-password" : "new-password"}
                      minLength={resetOpen ? 8 : 6}
                      required
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      onKeyUp={(event) => setCapsLockOn(event.getModifierState("CapsLock"))}
                      onBlur={() => setCapsLockOn(false)}
                      placeholder={!resetOpen ? "输入密码" : "至少 8 位"}
                    />
                    <button type="button" className="login-password-toggle" onClick={() => setPasswordVisible((visible) => !visible)} aria-label={passwordVisible ? "隐藏密码" : "显示密码"} aria-pressed={passwordVisible}>
                      {passwordVisible ? <EyeOff size={17} /> : <Eye size={17} />}
                    </button>
                  </div>
                  {capsLockOn && <small className="login-field-hint">大写锁定已开启</small>}
                  {resetOpen && (
                    <div className="login-password-strength" aria-label={`密码长度${password.length >= 8 ? "已达要求" : "未达要求"}`}>
                      <span className={password.length > 0 ? "filled" : ""} />
                      <span className={password.length >= 8 ? "filled" : ""} />
                      <span className={password.length >= 12 ? "filled" : ""} />
                      <small>{password.length >= 12 ? "密码强度很好" : password.length >= 8 ? "已达到长度要求" : "至少 8 位"}</small>
                    </div>
                  )}
                </div>
              )}

              {(error || notice) && (
                <div id={feedbackId} className={`login-feedback ${error ? "error" : "success"}`} role={error ? "alert" : "status"} aria-live="polite">
                  {error ? <AlertCircle size={17} /> : <Check size={17} />}
                  <span>{error || notice}</span>
                </div>
              )}

              <button type="submit" disabled={submitDisabled} className="login-submit">
                {loading ? <Loader2 size={18} className="animate-spin" /> : resetOpen ? <LockKeyhole size={17} /> : null}
                <span>{loading ? "请稍候…" : resetOpen ? "重置密码" : copy.button}</span>
                {!loading && !resetOpen && <ArrowRight size={18} />}
              </button>

              {resetOpen && <button type="button" onClick={leaveReset} className="login-back-button">返回登录</button>}
            </form>
          </div>
        </section>
      </div>
    </main>
  );
}
