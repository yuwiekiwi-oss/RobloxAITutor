import { type FormEvent, useState } from "react";
import { SchoolLogo } from "../../components/Brand";
import { Icon } from "../../components/Icon";
import { TutorAvatar } from "../../components/TutorAvatar";
import { useAuth } from "../../lib/auth";

export function LoginScreen() {
  const { signIn } = useAuth();
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signIn(loginId, password);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="theme-student login">
      <form className="login-card glass" onSubmit={submit}>
        <div className="login-head">
          <SchoolLogo size={84} />
          <p className="login-school">ミスタージョーンズ 金町校</p>
          <p className="login-product">
            <TutorAvatar size={26} />
            Roblox AI先生
          </p>
        </div>

        <label className="field">
          <span className="field-label">ログインID</span>
          <input
            className="input"
            value={loginId}
            onChange={(e) => setLoginId(e.target.value)}
            autoComplete="username"
            autoCapitalize="off"
            spellCheck={false}
            required
            placeholder="例：tanaka"
          />
        </label>
        <label className="field">
          <span className="field-label">パスワード</span>
          <div className="input-with-btn">
            <input
              className="input"
              type={show ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
            <button
              type="button"
              className="icon-btn"
              onClick={() => setShow(!show)}
              aria-label={show ? "パスワードをかくす" : "パスワードを見る"}
            >
              <Icon name={show ? "eyeOff" : "eye"} />
            </button>
          </div>
        </label>

        {error && <p className="error-text" role="alert">{error}</p>}
        <button className="btn btn-primary btn-lg btn-block" disabled={busy}>
          {busy ? "ログイン中…" : "ログイン"}
        </button>
        <p className="login-help">IDやパスワードがわからないときは、先生に聞いてね。</p>
      </form>
    </div>
  );
}
