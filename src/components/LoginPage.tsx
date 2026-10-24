import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Eye, EyeOff, Pencil } from "lucide-react";
import { confirmPasswordReset, requestEmailLoginCode, requestPasswordReset } from "../services/auth";
import type { ClothLoginController, ClothLoginState } from "./login/cloth-login.js";
import "./login/cloth-login.css";

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
  const [step, setStep] = useState<"email" | "verify">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [feedback, setFeedback] = useState<{ text: string; error: boolean; quiet?: boolean }>({ text: "", error: false });
  const [renderer, setRenderer] = useState<"loading" | "active" | "fallback">("loading");
  const [entranceReady, setEntranceReady] = useState(false);
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
  const loginRoot = useRef<HTMLElement>(null);
  const cloth = useRef<ClothLoginController | null>(null);
  const address = email.trim().toLowerCase();
  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address);
  const key = `${mode}:${address}`;
  const seconds = Math.max(0, Math.ceil(((deadlines.current.get(key) || 0) - now) / 1000));
  const needsCode = mode !== "login" || method === "code";
  const showCode = needsCode && step === "verify";
  const showPassword = (mode === "reset" && step === "verify") || (mode === "login" && method === "password");
  const ready = validEmail && (!showCode || /^\d{6}$/.test(code)) && (!showPassword || password.length >= (mode === "reset" ? 8 : 6));
  const buttonLabel = sending ? "正在发送…" : busy ? "请稍候…" : needsCode && step === "email" ? "获取验证码" : mode === "register" ? "创建账号" : mode === "reset" ? "保存新密码" : "登录";
  const title = mode === "reset" ? "重设密码" : mode === "register" ? "创建账号" : "登录";
  const feedbackText = feedback.error ? feedback.text : capsLock ? "大写锁定已开启" : feedback.text || (sending ? "正在发送验证码…" : "");
  // Sending is already expressed by the primary action and delivery controls.
  // Keep the live announcement without adding another visible paragraph.
  const quietFeedback = !feedback.error && !capsLock && (feedback.quiet || (!feedback.text && sending));
  const presentation = useMemo<ClothLoginState>(() => ({
    loading: busy || sending, primaryLabel: showCode ? "验证码" : "邮箱",
    passwordLabel: mode === "reset" ? "新密码" : "密码", buttonLabel, title,
  }), [busy, sending, showCode, mode, buttonLabel, title]);
  const latestPresentation = useRef(presentation);
  latestPresentation.current = presentation;

  const prepareAutofillEditing = (event: React.PointerEvent<HTMLInputElement>) => {
    const field = event.currentTarget;
    if (event.button !== 0 || !field.matches(":is(:autofill, :-webkit-autofill)")) return;
    const value = field.value;
    if (!value) return;
    // Hand an autofilled value back to the native editor before the default mouse
    // action resolves its caret. Never clear it or synthesize a keyboard edit.
    field.value = value;
  };

  useEffect(() => {
    const root = loginRoot.current;
    // Canvas-less environments keep the same usable native authentication form.
    if (!root) return;
    if (typeof ResizeObserver === "undefined" || typeof IntersectionObserver === "undefined") {
      setRenderer("fallback");
      return;
    }
    let controller: ClothLoginController | null = null;
    let cancelled = false;
    // Do not add the cloth renderer to the workspace's initial JavaScript bundle.
    void import("./login/cloth-login.js").then(({ mountClothLogin }) => {
      if (cancelled) return;
      controller = mountClothLogin(root, () => { if (!cancelled) setEntranceReady(true); });
      cloth.current = controller;
      controller.update(latestPresentation.current);
      setRenderer("active");
    }).catch(error => {
      controller?.destroy(); cloth.current = null;
      if (!cancelled) {
        setRenderer("fallback");
        console.warn("登录动画不可用，保留原生表单。", error);
      }
    });
    return () => { cancelled = true; controller?.destroy(); cloth.current = null; };
  }, []);

  useLayoutEffect(() => {
    cloth.current?.update(presentation);
  }, [presentation, email, code, password, visible]);

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
    stopSend(); setMode(next); setStep("email"); setMethod(next === "login" && mode === "reset" ? "password" : "code");
    setCode(""); setPassword(""); setVisible(false); setCapsLock(false); clearFeedback();
    window.requestAnimationFrame(() => emailInput.current?.focus());
  };
  const changeMethod = () => {
    if (submitting.current) return;
    stopSend(); setStep("email"); setMethod(method === "code" ? "password" : "code");
    setCode(""); setPassword(""); setVisible(false); setCapsLock(false); clearFeedback();
    window.requestAnimationFrame(() => { if (method === "code") passwordInput.current?.focus(); else emailInput.current?.focus(); });
  };
  const editEmail = () => {
    if (submitting.current) return;
    stopSend(); setStep("email"); setCode(""); setPassword(""); setVisible(false); setCapsLock(false); clearFeedback();
    window.requestAnimationFrame(() => emailInput.current?.focus());
  };
  const sendCode = async () => {
    if (!validEmail || seconds || sendRequest.current || submitting.current) return;
    clearFeedback();
    const controller = new AbortController();
    sendRequest.current = controller;
    const version = ++sendVersion.current;
    const target = key;
    setStep("verify"); setSending(true);
    window.requestAnimationFrame(() => codeInput.current?.focus());
    // Preserve cooldown even if cancelled after the server has already sent mail.
    deadlines.current.set(target, Date.now() + 60000); setNow(Date.now());
    try {
      const result = mode === "reset" ? await requestPasswordReset(address, controller.signal)
        : await requestEmailLoginCode(address, mode, controller.signal);
      if (!mounted.current || version !== sendVersion.current) return;
      const developmentCode = "developmentCode" in result ? result.developmentCode : undefined;
      if (typeof developmentCode === "string") setCode(developmentCode);
      setFeedback({ text: typeof developmentCode === "string" ? "开发环境验证码已自动填入。" : result.message, error: false, quiet: true });
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
    if (needsCode && step === "email") {
      if (seconds > 0) {
        setStep("verify");
        setFeedback({ text: "如果已收到邮件，可继续输入验证码。", error: false, quiet: true });
        window.requestAnimationFrame(() => codeInput.current?.focus());
      } else await sendCode();
      return;
    }
    submitting.current = true; setBusy(true); clearFeedback();
    try {
      if (mode === "reset") {
        const message = await confirmPasswordReset(address, code, password);
        if (!mounted.current) return;
        setMode("login"); setMethod("password"); setStep("email"); setCode(""); setPassword(""); setVisible(false);
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

  return <main ref={loginRoot} id="cloth-character-login" className="login-page auth-page" data-renderer={renderer} data-entered={entranceReady || renderer === "fallback"}>
    <header className="site-header">
      <a className="site-brand" href="/" aria-label="NoteFlow 首页">NoteFlow<span>.</span></a>
    </header>
    <div className="page-main">
      <form className="auth-form" data-mode={mode} data-step={step} onSubmit={submit} aria-busy={busy || sending} aria-label={title} aria-describedby={feedback.text ? `${id}-feedback` : undefined}
        onKeyDown={event => { if (event.key === "Enter" && (event.nativeEvent.isComposing || event.keyCode === 229)) event.preventDefault(); }}>
        <h1 className="sr-only">{title}</h1>
        <section className="cl-scene" aria-label="NoteFlow 账号登录">
          <canvas className="cl-shadow" aria-hidden="true" />
          <canvas className="cl-cloth" aria-hidden="true" />
          <div className="cl-drag-surface" aria-hidden="true" />
          <div className="cl-form">
            <h2 className="cl-fallback-title" aria-hidden="true">{title}</h2>
            <div className="auth-fields" key={`${mode}:${method}:${step}`}>
              {!showCode && <div className="cl-field cl-primary-field"><label className="sr-only" htmlFor={`${id}-email`}>邮箱</label>
                <input className="cl-email cl-input" ref={emailInput} id={`${id}-email`} name="email" type="email" autoComplete="email" inputMode="email" placeholder="输入你的邮箱地址" required disabled={busy} value={email}
                  onPointerDownCapture={prepareAutofillEditing}
                  onChange={event => { stopSend(); setEmail(event.target.value); setCode(""); clearFeedback(); }} />
                <span className="cl-field-weave" aria-hidden="true" /></div>}
              {showCode && <div className="cl-field cl-primary-field"><label className="sr-only" htmlFor={`${id}-code`}>验证码</label>
                <input className="cl-email cl-input" ref={codeInput} id={`${id}-code`} name="code" type="text" inputMode="numeric" autoComplete="one-time-code" placeholder="6 位验证码" maxLength={6} required disabled={busy} value={code}
                  onPointerDownCapture={prepareAutofillEditing}
                  aria-describedby={`${id}-destination`} onChange={event => { stopSend(); setCode(event.target.value.replace(/\D/g, "").slice(0, 6)); clearFeedback(); }} />
                <span className="cl-field-weave" aria-hidden="true" /></div>}
              {showPassword && <div className="cl-field cl-password-field"><label className="sr-only" htmlFor={`${id}-password`}>{mode === "reset" ? "新密码" : "密码"}</label>
                <input className="cl-password cl-input" ref={passwordInput} id={`${id}-password`} name="password" type={visible ? "text" : "password"} autoComplete={mode === "reset" ? "new-password" : "current-password"}
                  onPointerDownCapture={prepareAutofillEditing}
                  placeholder={mode === "reset" ? "至少 8 位" : "你的密码"} minLength={mode === "reset" ? 8 : 6} required disabled={busy} value={password}
                  onChange={event => { setPassword(event.target.value); clearFeedback(); }} onKeyUp={event => setCapsLock(event.getModifierState("CapsLock"))} onBlur={() => setCapsLock(false)} />
                <span className="cl-field-weave" aria-hidden="true" />
                <button type="button" className="cl-password-toggle" disabled={busy} aria-label={visible ? "隐藏密码" : "显示密码"} title={visible ? "隐藏密码" : "显示密码"} aria-pressed={visible}
                  onClick={() => { setVisible(!visible); passwordInput.current?.focus(); }}>{visible ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}</button></div>}
            </div>
            <button ref={submitButton} className="cl-enter auth-submit" type="submit" disabled={!ready || busy || sending}>{buttonLabel}</button>
          </div>
          <canvas className="cl-fx" aria-hidden="true" />
          <span className="cl-bubble" hidden aria-hidden="true" /><span className="cl-probe" aria-hidden="true" />
          <p className="cl-status sr-only" aria-hidden="true" />
        </section>
        <div className="auth-support" inert={!entranceReady && renderer !== "fallback"} aria-hidden={!entranceReady && renderer !== "fallback"}>
          <div id={`${id}-feedback`} className="auth-feedback" data-error={feedback.error} data-empty={!feedbackText} data-quiet={Boolean(quietFeedback)} role={feedback.error ? "alert" : "status"} aria-live="polite" aria-atomic="true">
            <span>{feedbackText}</span>
          </div>
          {showCode && <div className="auth-delivery">
            <button type="button" className="auth-text auth-destination" aria-label="修改邮箱" aria-describedby={`${id}-destination`} title={address} disabled={busy} onClick={editEmail}>
              <span id={`${id}-destination`}>{address}</span><Pencil size={12} aria-hidden="true" />
            </button>
            <button type="button" className="auth-text auth-send" aria-label={sending ? "取消等待" : seconds > 0 ? `${seconds}s 后重发` : "重新发送验证码"} disabled={busy || (!sending && seconds > 0)} onClick={() => {
              if (sending) { stopSend(); setFeedback({ text: "已停止等待；若邮件已发送，仍可使用验证码。", error: false }); } else void sendCode();
            }}>{sending ? "取消等待" : seconds > 0 ? `${seconds}s 后重发` : "重新发送"}</button>
          </div>}
          <div className="auth-options">
            {mode === "login" && <button type="button" className="auth-text" aria-label={method === "code" ? "使用密码登录" : "使用验证码登录"} disabled={busy} onClick={changeMethod}>{method === "code" ? "密码登录" : "验证码登录"}</button>}
            {mode === "reset" && <button type="button" className="auth-text" disabled={busy} onClick={() => changeMode("login")}>返回登录</button>}
            {mode === "login" && showPassword && <button type="button" className="auth-text" aria-label="忘记密码？" disabled={busy} onClick={() => changeMode("reset")}>忘记密码</button>}
            {mode !== "reset" && <button type="button" className="auth-text" disabled={busy} onClick={() => changeMode(mode === "login" ? "register" : "login")}>{mode === "login" ? "注册" : "登录"}</button>}
          </div>
        </div>
      </form>
    </div>
  </main>;
}
