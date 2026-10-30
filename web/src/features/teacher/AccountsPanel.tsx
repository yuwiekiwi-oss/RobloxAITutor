import { useEffect, useMemo, useState } from "react";
import { Icon } from "../../components/Icon";
import { useApi } from "../../lib/api";
import { type AccountRow, PASSWORD_MIN } from "../../lib/types";

// Easy to read aloud and type: no 0/O, 1/l/I.
const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

/** A random 8-character password a child can type. */
export function generatePassword(length = 8): string {
  const bytes = new Uint32Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (n) => ALPHABET[n % ALPHABET.length]).join("");
}

/** Teacher dashboard: every account the teacher may manage, with password changes. */
export function AccountsPanel({ onClose }: { onClose: () => void }) {
  const api = useApi();
  const [accounts, setAccounts] = useState<AccountRow[] | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [filter, setFilter] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      const r = await api.listAccounts();
      setAccounts(r.accounts);
      setIsAdmin(r.isAdmin);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  useEffect(() => {
    load();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const list = accounts ?? [];
    return q ? list.filter((a) => a.display_name.toLowerCase().includes(q) || a.login_id.toLowerCase().includes(q)) : list;
  }, [accounts, filter]);
  const teachers = shown.filter((a) => a.role === "teacher");
  const students = shown.filter((a) => a.role === "student");

  const toggleAdmin = async (a: AccountRow) => {
    const ok = window.confirm(a.is_admin
      ? `${a.display_name}を管理者から外しますか？`
      : `${a.display_name}を管理者にしますか？\n管理者は、すべての先生と生徒のパスワードを変えられます。`);
    if (!ok) return;
    try {
      await api.setAdmin(a.id, !a.is_admin);
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer accounts" role="dialog" aria-modal="true" aria-label="アカウントとパスワード" onClick={(e) => e.stopPropagation()}>
        <header className="drawer-head">
          <div>
            <span className="t-eyebrow">ACCOUNTS</span>
            <h2>アカウントとパスワード</h2>
            <p className="drawer-meta">
              {isAdmin
                ? <span><b className="acc-badge admin">管理者</b> すべての先生と生徒のパスワードを変えられます</span>
                : <span>自分と、担当している生徒のパスワードを変えられます</span>}
            </p>
          </div>
          <button className="t-btn t-btn-ghost" onClick={onClose} aria-label="閉じる">
            <Icon name="x" size={18} />
          </button>
        </header>

        <div className="drawer-body">
          <input
            className="acc-filter"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="名前かログインIDでさがす"
            aria-label="アカウントをさがす"
          />
          {error && <p className="error-text">{error}</p>}
          {accounts === null && !error && <p className="muted">読みこみ中…</p>}

          {teachers.length > 0 && (
            <section className="acc-group">
              <h3>先生 <span>{teachers.length}</span></h3>
              <ul>{teachers.map((a) => <AccountItem key={a.id} account={a} canToggleAdmin={isAdmin} onToggleAdmin={() => toggleAdmin(a)} />)}</ul>
            </section>
          )}
          {students.length > 0 && (
            <section className="acc-group">
              <h3>生徒 <span>{students.length}</span></h3>
              <ul>{students.map((a) => <AccountItem key={a.id} account={a} />)}</ul>
            </section>
          )}
          {accounts !== null && shown.length === 0 && <p className="muted">見つかりませんでした。</p>}
        </div>
      </aside>
    </div>
  );
}

function AccountItem({ account: a, canToggleAdmin, onToggleAdmin }: {
  account: AccountRow;
  canToggleAdmin?: boolean;
  onToggleAdmin?: () => void;
}) {
  const api = useApi();
  const [editing, setEditing] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.setPassword(a.id, password);
      setDone(password);
      setEditing(false);
      setPassword("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const valid = password.length >= PASSWORD_MIN && !/\s/.test(password);

  return (
    <li className="acc-item">
      <div className="acc-row">
        <div className="acc-who">
          <p className="acc-name">
            {a.display_name}
            {a.is_self && <span className="acc-badge self">あなた</span>}
            {a.is_admin && <span className="acc-badge admin">管理者</span>}
          </p>
          <p className="acc-meta">
            ログインID <code>{a.login_id || "—"}</code>
            {a.teacher_name && <span> · 担当 {a.teacher_name}</span>}
          </p>
        </div>
        <div className="acc-actions">
          {canToggleAdmin && !a.is_self && (
            <button className="link-btn" onClick={onToggleAdmin}>{a.is_admin ? "管理者から外す" : "管理者にする"}</button>
          )}
          {!editing && (
            <button className="t-btn" onClick={() => { setEditing(true); setDone(null); setError(null); }}>
              <Icon name="key" size={15} /> パスワードを変える
            </button>
          )}
        </div>
      </div>

      {editing && (
        <div className="acc-edit">
          <div className="acc-edit-row">
            <input
              className="acc-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={`新しいパスワード（${PASSWORD_MIN}文字以上）`}
              autoComplete="new-password"
              spellCheck={false}
              aria-label={`${a.display_name}の新しいパスワード`}
            />
            <button className="t-btn" onClick={() => setPassword(generatePassword())} disabled={busy}>自動で作る</button>
          </div>
          {error && <p className="error-text">{error}</p>}
          <div className="acc-edit-row">
            <button className="t-btn t-btn-primary" onClick={save} disabled={busy || !valid}>
              {busy ? "変更中…" : "このパスワードにする"}
            </button>
            <button className="link-btn" onClick={() => { setEditing(false); setPassword(""); setError(null); }} disabled={busy}>やめる</button>
          </div>
        </div>
      )}

      {done && (
        <div className="acc-done">
          <p>
            <Icon name="check" size={15} /> 変更しました。{a.is_self ? "次からこのパスワードでログインしてください。" : "新しいパスワードを本人に伝えてください。"}
          </p>
          <p className="acc-done-pass">
            <code>{done}</code>
            <button
              className="link-btn"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(done);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                } catch {
                  // Clipboard blocked: the password is still on screen.
                }
              }}
            >
              {copied ? "コピーした" : "コピー"}
            </button>
            <button className="link-btn" onClick={() => setDone(null)}>とじる</button>
          </p>
          <p className="muted acc-done-note">この画面を閉じると、パスワードはもう表示されません。</p>
        </div>
      )}
    </li>
  );
}
