import { useId, useState, type FormEvent } from 'react';
import { supabase } from '../../lib/supabase';

interface AuthScreenProps {
  /** 비밀번호 재설정 링크를 타고 돌아온 상태(PASSWORD_RECOVERY 이벤트)면 true. */
  recoveryMode: boolean;
  /** 새 비밀번호 설정을 마친 뒤(또는 취소) 복구 모드를 벗어날 때. */
  onRecoveryDone: () => void;
}

type Mode = 'login' | 'forgot' | 'forgot_sent';

function authErrorMessage(err: unknown): string {
  const e = err as { name?: string; status?: number; code?: string; message?: string } | null;
  if (!e) return '알 수 없는 오류가 발생했습니다.';
  if (e.name === 'AuthRetryableFetchError') {
    return '연결에 실패했습니다. 인터넷 연결을 확인하고 다시 시도해 주세요.';
  }
  if (e.code === 'invalid_credentials' || e.status === 400) {
    return '이메일 또는 비밀번호가 올바르지 않습니다.';
  }
  return e.message ?? '알 수 없는 오류가 발생했습니다.';
}

export default function AuthScreen({ recoveryMode, onRecoveryDone }: AuthScreenProps) {
  if (recoveryMode) {
    return <NewPasswordForm onDone={onRecoveryDone} />;
  }
  return <LoginOrForgot />;
}

function LoginOrForgot() {
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const idPrefix = useId();

  async function handleLogin(e: FormEvent) {
    e.preventDefault();
    if (!supabase) return;
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (err) setError(authErrorMessage(err));
  }

  async function handleForgot(e: FormEvent) {
    e.preventDefault();
    if (!supabase) return;
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + window.location.pathname,
    });
    setBusy(false);
    if (err) {
      setError(authErrorMessage(err));
      return;
    }
    setMode('forgot_sent');
  }

  if (mode === 'forgot_sent') {
    return (
      <div className="editor-page">
        <h1>독서노트</h1>
        <p>비밀번호 재설정 메일을 보냈습니다. 메일함을 확인해 주세요.</p>
        <button
          type="button"
          className="btn"
          onClick={() => {
            setMode('login');
            setError(null);
          }}
        >
          로그인으로 돌아가기
        </button>
      </div>
    );
  }

  if (mode === 'forgot') {
    return (
      <div className="editor-page">
        <h1>독서노트</h1>
        <form onSubmit={handleForgot} noValidate>
          <div className="form-field">
            <label htmlFor={`${idPrefix}-forgot-email`}>가입한 이메일</label>
            <input
              id={`${idPrefix}-forgot-email`}
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          {error && <p className="field-error">{error}</p>}
          <div className="form-actions">
            <button type="button" className="btn" onClick={() => setMode('login')}>
              취소
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              재설정 메일 보내기
            </button>
          </div>
        </form>
      </div>
    );
  }

  return (
    <div className="editor-page">
      <h1>독서노트</h1>
      <form onSubmit={handleLogin} noValidate>
        <div className="form-field">
          <label htmlFor={`${idPrefix}-email`}>이메일</label>
          <input
            id={`${idPrefix}-email`}
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="form-field">
          <label htmlFor={`${idPrefix}-password`}>비밀번호</label>
          <input
            id={`${idPrefix}-password`}
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        {error && <p className="field-error">{error}</p>}
        <div className="form-actions">
          <button
            type="button"
            className="btn"
            onClick={() => {
              setMode('forgot');
              setError(null);
            }}
          >
            비밀번호를 잊으셨나요
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            로그인
          </button>
        </div>
      </form>
    </div>
  );
}

function NewPasswordForm({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const idPrefix = useId();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!supabase) return;
    if (password.length < 6) {
      setError('비밀번호는 6자 이상이어야 합니다.');
      return;
    }
    if (password !== confirm) {
      setError('두 비밀번호가 서로 다릅니다.');
      return;
    }
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (err) {
      setError(authErrorMessage(err));
      return;
    }
    setDone(true);
  }

  if (done) {
    return (
      <div className="editor-page">
        <h1>독서노트</h1>
        <p>비밀번호가 변경되었습니다.</p>
        <button type="button" className="btn btn-primary" onClick={onDone}>
          계속하기
        </button>
      </div>
    );
  }

  return (
    <div className="editor-page">
      <h1>새 비밀번호 설정</h1>
      <form onSubmit={handleSubmit} noValidate>
        <div className="form-field">
          <label htmlFor={`${idPrefix}-new-password`}>새 비밀번호</label>
          <input
            id={`${idPrefix}-new-password`}
            type="password"
            autoComplete="new-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <div className="form-field">
          <label htmlFor={`${idPrefix}-new-password-confirm`}>새 비밀번호 확인</label>
          <input
            id={`${idPrefix}-new-password-confirm`}
            type="password"
            autoComplete="new-password"
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </div>
        {error && <p className="field-error">{error}</p>}
        <div className="form-actions">
          <button type="submit" className="btn btn-primary" disabled={busy}>
            비밀번호 변경
          </button>
        </div>
      </form>
    </div>
  );
}
