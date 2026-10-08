import { useEffect, useId, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Eye, EyeOff, Loader2, LockKeyhole, Mail } from "lucide-react";
import { confirmPasswordReset, requestEmailLoginCode, requestPasswordReset } from "../services/auth";

type Mode = "login" | "register" | "reset";
interface LoginPageProps {
  onSignIn: (email: string, password: string) => Promise<void>;
  onEmailCodeSignIn: (email: string, code: string) => Promise<void>;
  onSignUp: (email: string, code: string) => Promise<void>;
}

export default function LoginPage({ onSignIn, onEmailCodeSignIn, onSignUp }: LoginPageProps) {
  const id = useId();
  const [mode, setMode] = useState<Mode>("login");
  const [method, setMethod] = useState<"code" | "password">("code");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [feedback, setFeedback] = useState({ text: "", error: false });
  const [now, setNow] = useState(Date.now());
  const deadlines = useRef(new Map<string, number>());
  const sendRequest = useRef<AbortController | null>(null);
  const sendVersion = useRef(0);
  const submitting = useRef(false);
  const mounted = useRef(true);
  const emailInput = useRef<HTMLInputElement>(null);
  const passwordInput = useRef<HTMLInputElement>(null);
  const submitButton = useRef<HTMLButtonElement>(null);
  const codeInput = useRef<HTMLInputElement>(null);
  const address = email.trim().toLowerCase();
  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address);
  const key = `${mode}:${address}`;
  const seconds = Math.max(0, Math.ceil(((deadlines.current.get(key) || 0) - now) / 1000));
  const showCode = mode !== "login" || method === "code";
  const showPassword = mode === "reset" || (mode === "login" && method === "password");
  const ready = validEmail && (!showCode || /^\d{6}$/.test(code)) && (!showPassword || password.length >= (mode === "reset" ? 8 : 6));

  useEffect(() => {
    mounted.current = true;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => { mounted.current = false; sendVersion.current++; sendRequest.current?.abort(); window.clearInterval(timer); };
  }, []);

  const stopSend = () => {
    sendVersion.current++;
    sendRequest.current?.abort();
    sendRequest.current = null;
    setSending(false);
  };
  const clearFeedback = () => setFeedback({ text: "", error: false });
  const changeMode = (next: Mode) => {
    if (submitting.current) return;
    stopSend(); setMode(next); setMethod(next === "login" && mode === "reset" ? "password" : "code");
    setCode(""); setPassword(""); setVisible(false); setCapsLock(false); clearFeedback();
    window.requestAnimationFrame(() => emailInput.current?.focus());
  };
  const changeMethod = () => {
    if (submitting.current) return;
    stopSend(); setMethod(method === "code" ? "password" : "code");
    setCode(""); setPassword(""); setVisible(false); setCapsLock(false); clearFeedback();
  };
  const sendCode = async () => {
    if (!validEmail || seconds || sendRequest.current || submitting.current) return;
    clearFeedback();
    const controller = new AbortController();
    sendRequest.current = controller;
    const version = ++sendVersion.current;
    const target = key;
    setSending(true);
    // Preserve cooldown even if cancelled after the server has already sent mail.
    deadlines.current.set(target, Date.now() + 60000); setNow(Date.now());
    try {
      const result = mode === "reset" ? await requestPasswordReset(address, controller.signal)
        : await requestEmailLoginCode(address, mode, controller.signal);
      if (!mounted.current || version !== sendVersion.current) return;
      const developmentCode = "developmentCode" in result ? result.developmentCode : undefined;
      if (typeof developmentCode === "string") setCode(developmentCode);
      setFeedback({ text: typeof developmentCode === "string" ? "开发环境验证码已自动填入。" : result.message, error: false });
      if (document.activeElement?.closest(".auth-code-row")?.querySelector("button") === document.activeElement) codeInput.current?.focus();
    } catch (error) {
      if (!mounted.current || version !== sendVersion.current) return;
      setFeedback({ text: error instanceof Error ? error.message : "发送失败，请稍后重试。", error: true });
    } finally {
      if (mounted.current && version === sendVersion.current) { setSending(false); sendRequest.current = null; }
    }
  };
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting.current || sendRequest.current || !ready) return;
    submitting.current = true; setBusy(true); clearFeedback();
    try {
      if (mode === "reset") {
        const message = await confirmPasswordReset(address, code, password);
        if (!mounted.current) return;
        setMode("login"); setMethod("password"); setCode(""); setPassword(""); setVisible(false);
        setFeedback({ text: message, error: false });
        window.requestAnimationFrame(() => passwordInput.current?.focus());
      } else if (mode === "register") await onSignUp(address, code);
      else if (method === "code") await onEmailCodeSignIn(address, code);
      else await onSignIn(address, password);
    } catch (error) {
      if (mounted.current) setFeedback({ text: error instanceof Error ? error.message : "操作失败，请重试。", error: true });
    } finally {
      submitting.current = false;
      if (mounted.current) { setBusy(false); window.requestAnimationFrame(() => { if (document.activeElement === document.body) submitButton.current?.focus(); }); }
    }
  };

  return <main className="auth-page">
    <header className="auth-brand"><img src="/noteflow_icon.svg" width="44" height="44" alt="" /><span>NoteFlow</span></header>
    <section className="auth-main" aria-label="NoteFlow 账号入口">
      <form className="auth-form" data-mode={mode} onSubmit={submit} aria-busy={busy} aria-describedby={feedback.text ? `${id}-feedback` : undefined}
        onKeyDown={event => { if (event.key === "Enter" && (event.nativeEvent.isComposing || event.keyCode === 229)) event.preventDefault(); }}>
        <div className="auth-heading">
          <h1>{mode === "reset" ? "重设密码" : mode === "register" ? "开始你的笔记" : "欢迎回来"}</h1>
          <p>{mode === "reset" ? "验证邮箱，为账号设置新密码。" : mode === "register" ? "验证邮箱，创建你的 NoteFlow 账号。" : "登录 NoteFlow，继续你的笔记。"}</p>
        </div>
        {mode === "reset" ? <div className="auth-reset-nav"><button type="button" className="auth-text" disabled={busy} onClick={() => changeMode("login")}><ArrowLeft aria-hidden="true" />返回登录</button></div>
          : <div className="auth-switch" role="group" aria-label="选择登录或注册"><span className="auth-switch-thumb" aria-hidden="true" />
            {(["login", "register"] as const).map(value => <button key={value} type="button" aria-pressed={mode === value} disabled={busy} onClick={() => { if (mode !== value) changeMode(value); }}>{value === "login" ? "登录" : "注册"}</button>)}
          </div>}
        <div className="auth-fields">
          <div className="auth-field"><label htmlFor={`${id}-email`}>邮箱</label>
            <div className="auth-input"><Mail aria-hidden="true" /><input ref={emailInput} id={`${id}-email`} type="email" autoComplete="email" inputMode="email" placeholder="你的邮箱地址" required disabled={busy} value={email}
              onChange={event => { stopSend(); setEmail(event.target.value); setCode(""); clearFeedback(); }} /></div>
          </div>
          {showCode && <div className="auth-field"><label htmlFor={`${id}-code`}>验证码</label><div className="auth-code-row">
            <div className="auth-input"><input ref={codeInput} id={`${id}-code`} type="text" inputMode="numeric" autoComplete="one-time-code" placeholder="6 位验证码" maxLength={6} required disabled={busy} value={code}
              onChange={event => { stopSend(); setCode(event.target.value.replace(/\D/g, "").slice(0, 6)); clearFeedback(); }} /></div>
            <button type="button" className="auth-send" disabled={busy || !validEmail || (!sending && seconds > 0)} onClick={() => {
              if (sending) { stopSend(); setFeedback({ text: "已停止等待；若邮件已发送，仍可使用验证码。", error: false }); } else void sendCode();
            }}>{sending ? "取消等待" : seconds > 0 ? `${seconds}s 后重发` : "获取验证码"}</button>
          </div></div>}
          {showPassword && <div className="auth-field"><div className="auth-label-row"><label htmlFor={`${id}-password`}>{mode === "reset" ? "新密码" : "密码"}</label>
            {mode === "login" && <button type="button" className="auth-text" disabled={busy} onClick={() => changeMode("reset")}>忘记密码？</button>}</div>
            <div className="auth-input"><LockKeyhole aria-hidden="true" /><input ref={passwordInput} id={`${id}-password`} type={visible ? "text" : "password"} autoComplete={mode === "reset" ? "new-password" : "current-password"}
              placeholder={mode === "reset" ? "至少 8 位" : "你的密码"} minLength={mode === "reset" ? 8 : 6} required disabled={busy} value={password}
              onChange={event => { setPassword(event.target.value); clearFeedback(); }} onKeyUp={event => setCapsLock(event.getModifierState("CapsLock"))} onBlur={() => setCapsLock(false)} />
              <button type="button" className="auth-eye" disabled={busy} aria-label={visible ? "隐藏密码" : "显示密码"} aria-pressed={visible} onClick={() => { setVisible(!visible); passwordInput.current?.focus(); }}>{visible ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}</button>
            </div>
          </div>}
        </div>
        <div id={`${id}-feedback`} className="auth-feedback" data-error={feedback.error} role={feedback.error ? "alert" : "status"} aria-live="polite" aria-atomic="true">
          <span>{feedback.text || (capsLock ? "大写锁定已开启" : sending ? "正在发送验证码…" : "")}</span>
        </div>
        <button ref={submitButton} className="auth-submit" type="submit" disabled={!ready || busy || sending}>
          <span>{busy ? "请稍候…" : mode === "register" ? "验证并注册" : mode === "reset" ? "保存新密码" : "登录"}</span>
          {busy ? <Loader2 className="auth-spinner" aria-hidden="true" /> : <ArrowRight aria-hidden="true" />}
        </button>
        <div className="auth-secondary">{mode === "login" ? <button type="button" className="auth-text" disabled={busy} onClick={changeMethod}>{method === "code" ? "使用密码登录" : "使用验证码登录"}</button>
          : mode === "register" ? <p>注册无需密码，之后可通过邮箱验证设置。</p> : null}</div>
      </form>
    </section>
  </main>;
}
