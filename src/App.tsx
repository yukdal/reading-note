import { useCallback, useEffect, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import type { Book, BookInput, EditorMode, MindmapNode } from './types';
import { demoBooks } from './data/demo';
import { DEMO_USER_ID, loadDemoBooks, fetchDemoSnapshot, applyDemoImport, saveDemoBook, deleteDemoBook, saveDemoMap } from './data/demoStorage';
import { xmindExampleBook, xmindExampleNodes } from './data/xmindExample';
import Bookshelf from './features/books/Bookshelf';
import BookDialog from './features/books/BookDialog';
import BookForm from './features/books/BookForm';
import MindmapEditor from './features/mindmap/MindmapEditor';
import OutlineEditor from './features/mindmap/OutlineEditor';
import RealMapEditorScreen from './features/mindmap/RealMapEditorScreen';
import { createInitialNodes, setRootText } from './features/mindmap/model';
import { useAutosave, type SaveFn, type SaveState } from './features/mindmap/useAutosave';
import { clearUser, getCachedMap, listDraftBookIds, getBooksCache, putBooksCache, putDraft, putSaved } from './lib/localCache';
import { supabase } from './lib/supabase';
import {
  classifyError,
  createBook as apiCreateBook,
  deleteBook as apiDeleteBook,
  getMindmap,
  listBooks,
  updateBook as apiUpdateBook,
  type ApiError,
} from './data/api';
import AuthScreen from './features/auth/AuthScreen';
import BackupPanel from './features/backup/BackupPanel';

// 데모 모드(Supabase env 없음)에서만 쓰는 고정 사용자 id. 실제 모드는 session.user.id를 쓴다.

const DEMO_BANNER_TEXT =
  '데모 모드 — 책과 마인드맵은 이 브라우저에 저장됩니다. 다른 기기와는 동기화되지 않습니다.';

type EditingTarget = 'new' | Book | null;
type Route = { name: 'shelf' } | { name: EditorMode; bookId: string };

function parseHash(hash: string): Route {
  const path = hash.replace(/^#/, '');
  const match = /^\/books\/([^/]+)\/(map|outline)$/.exec(path);
  if (match) return { name: match[2] as EditorMode, bookId: match[1] };
  return { name: 'shelf' };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : '알 수 없는 오류가 발생했습니다.';
}

export default function App() {
  // demoMode는 env 유무로만 정해지고 세션 동안 바뀌지 않는다. 분기는 여기 한 곳뿐이고,
  // 아래 모든 상태/핸들러는 이 하나의 App() 안에서 demoMode를 보고 갈라진다
  // (데모용/실제용 컴포넌트를 따로 만들지 않는다).
  const demoMode = supabase === null;

  // ---- 라우팅 (공통) ----
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));
  useEffect(() => {
    const onHashChange = () => setRoute(parseHash(window.location.hash));
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);
  function goTo(hash: string) {
    window.location.hash = hash;
  }

  // ---- 인증 (실제 모드에서만 의미가 있음) ----
  const [session, setSession] = useState<Session | null>(null);
  const [sessionChecked, setSessionChecked] = useState(demoMode);
  const [recoveryMode, setRecoveryMode] = useState(false);

  useEffect(() => {
    if (demoMode || !supabase) return;
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setSessionChecked(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, newSession) => {
      if (!active) return;
      if (event === 'PASSWORD_RECOVERY') setRecoveryMode(true);
      setSession(newSession);
      setSessionChecked(true);
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [demoMode]);

  const userId = demoMode ? DEMO_USER_ID : (session?.user.id ?? null);

  // ---- 책 목록 ----
  const [books, setBooks] = useState<Book[]>([]);
  const [booksError, setBooksError] = useState<ApiError | null>(null);
  const [booksCachedAt, setBooksCachedAt] = useState<string | null>(null);
  const [booksLoading, setBooksLoading] = useState(true);

  const loadBooks = useCallback(async () => {
    if (!userId) return;
    setBooksLoading(true);
    try {
      const list = demoMode ? await loadDemoBooks(demoBooks) : await listBooks();
      setBooks(list);
      setBooksError(null);
      setBooksCachedAt(null);
      if (!demoMode) void putBooksCache(userId, list);
    } catch (err) {
      setBooksError(classifyError(err));
      const cached = await getBooksCache(userId).catch(() => null);
      setBooks(cached?.books ?? []);
      setBooksCachedAt(cached?.cachedAt ?? null);
    } finally {
      setBooksLoading(false);
    }
  }, [demoMode, userId]);

  useEffect(() => {
    if (demoMode || !session || recoveryMode) return;
    void loadBooks();
    // session 객체 참조는 토큰 갱신마다 바뀌므로 user id로만 의존한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demoMode, session?.user.id, recoveryMode]);

  useEffect(() => {
    if (demoMode) void loadBooks();
  }, [demoMode, loadBooks]);

  const isOffline = !demoMode && booksError !== null;

  // 오프라인 상태에서 연결이 돌아오면 책 목록을 한 번만 자동으로 다시 불러온다(주기적 폴링은 하지 않음).
  useEffect(() => {
    if (!isOffline) return;
    function onOnline() {
      void loadBooks();
    }
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [isOffline, loadBooks]);

  // ---- 책 추가/수정/삭제 다이얼로그 ----
  const [selected, setSelected] = useState<{ book: Book; triggerElement: HTMLElement | null } | null>(null);
  const [editing, setEditing] = useState<EditingTarget>(null);
  const [bookActionError, setBookActionError] = useState<string | null>(null);
  const [bookActionBusy, setBookActionBusy] = useState(false);
  // 책 생성 재시도 시 같은 id를 쓰기 위해 보관(네트워크 실패 후 재시도해도 중복 생성되지 않음).
  const newBookIdRef = useRef<string | null>(null);

  function openAdd() {
    setBookActionError(null);
    newBookIdRef.current = null;
    setEditing('new');
  }
  function openEdit(book: Book) {
    setBookActionError(null);
    setSelected(null);
    setEditing(book);
  }
  function closeForm() {
    setEditing(null);
    setBookActionError(null);
    newBookIdRef.current = null;
  }

  // ---- 실제 모드 책 CRUD (Supabase RPC) ----
  async function handleBookFormSubmit(input: BookInput) {
    if (demoMode) {
      setBookActionError(null);
      setBookActionBusy(true);
      try {
        if (!editing) return;
        const current = editing === 'new' ? null : editing;
        const id = current?.id ?? newBookIdRef.current ?? crypto.randomUUID();
        newBookIdRef.current = id;
        setBooks(await saveDemoBook(demoBooks, id, input, current?.updated_at ?? null));
        closeForm();
      } catch (err) {
        setBookActionError(errorMessage(err));
      } finally {
        setBookActionBusy(false);
      }
      return;
    }
    if (!userId) return;
    setBookActionError(null);
    setBookActionBusy(true);
    try {
      if (editing === 'new') {
        const id = newBookIdRef.current ?? crypto.randomUUID();
        newBookIdRef.current = id; // 실패해도 유지 -> 재시도는 같은 id로
        const { book } = await apiCreateBook(id, input);
        setBooks((prev) => {
          const next = [...prev, book];
          void putBooksCache(userId, next);
          return next;
        });
        closeForm();
        return;
      }

      const current = editing as Book;
      const titleChanged = input.title !== current.title;
      let mapVersion: number | null = null;
      if (titleChanged) {
        const cached = await getCachedMap(userId, current.id);
        if (cached.draft) {
          setBookActionError('마인드맵 저장을 먼저 끝내세요.');
          return;
        }
        mapVersion = cached.saved?.version ?? (await getMindmap(current.id)).version;
      }

      const result = await apiUpdateBook(current.id, current.updated_at, input, mapVersion);
      if (result.status === 'conflict') {
        void refreshCachedMap(userId, current.id);
        setBooks((prev) => prev.map((b) => (b.id === current.id ? result.book : b)));
        setEditing(result.book); // 폼의 입력 내용(raw state)은 리마운트되지 않아 그대로 남는다.
        setBookActionError('다른 기기에서 수정되어 최신 내용을 불러왔습니다. 다시 수정해 주세요.');
        return;
      }
      setBooks((prev) => {
        const next = prev.map((b) => (b.id === current.id ? result.book : b));
        void putBooksCache(userId, next);
        return next;
      });
      if (titleChanged) void refreshCachedMap(userId, current.id); // 제목이 바뀌면 서버가 맵 버전을 올린다
      closeForm();
    } catch (err) {
      setBookActionError(classifyError(err).message);
    } finally {
      setBookActionBusy(false);
    }
  }

  /** 서버의 최신 맵 버전으로 캐시를 맞춘다. 실패하면 캐시를 비워 다음에 서버에서 읽게 한다. 절대 throw하지 않는다. */
  async function refreshCachedMap(uid: string, bookId: string) {
    try {
      await putSaved(uid, bookId, await getMindmap(bookId));
    } catch {
      await putSaved(uid, bookId, null).catch(() => {});
    }
  }

  async function handleDeleteBook(id: string) {
    if (demoMode) {
      const book = books.find((b) => b.id === id);
      if (!book) return;
      setBookActionError(null);
      setBookActionBusy(true);
      try {
        setBooks(await deleteDemoBook(demoBooks, book));
        setSelected(null);
      } catch (err) {
        setBookActionError(errorMessage(err));
      } finally {
        setBookActionBusy(false);
      }
      return;
    }
    if (!userId) return;
    const book = books.find((b) => b.id === id);
    if (!book) return;
    setBookActionError(null);
    setBookActionBusy(true);
    try {
      const cached = await getCachedMap(userId, id);
      const mapVersion = cached.saved?.version ?? (await getMindmap(id)).version;
      const result = await apiDeleteBook(id, book.updated_at, mapVersion);
      if (result.status === 'conflict') {
        void refreshCachedMap(userId, id);
        setBooks((prev) => prev.map((b) => (b.id === id ? result.book : b)));
        setSelected((sel) => (sel && sel.book.id === id ? { ...sel, book: result.book } : sel));
        setBookActionError('다른 기기에서 수정되었습니다. 최신 내용을 확인한 뒤 다시 삭제해 주세요.');
        return;
      }
      // result.status === 'ok' (대상이 이미 없던 경우도 api.deleteBook이 여기로 정규화해 돌려준다)
      setBooks((prev) => {
        const next = prev.filter((b) => b.id !== id);
        void putBooksCache(userId, next);
        return next;
      });
      setSelected(null);
      void putSaved(userId, id, null);
      void putDraft(userId, id, null);
    } catch (err) {
      setBookActionError(classifyError(err).message);
    } finally {
      setBookActionBusy(false);
    }
  }

  async function handleLogout() {
    if (demoMode || !supabase || !userId) return;
    const uid = userId;
    const ids = await listDraftBookIds(uid).catch(() => []);
    if (ids.length > 0 && !window.confirm(`저장되지 않은 초안 ${ids.length}권이 이 브라우저에서 지워집니다. 먼저 맵 화면의 '내 초안 내보내기'로 저장할 수 있습니다. 그래도 로그아웃할까요?`)) return;
    await supabase.auth.signOut();
    await clearUser(uid).catch(() => {});
    setBooks([]);
    setBooksError(null);
    setBooksCachedAt(null);
    setSelected(null);
    setEditing(null);
    if (route.name !== 'shelf') goTo('#/');
  }

  if (demoMode && ((booksLoading && books.length === 0) || booksError)) {
    return <div className="editor-page">
      <p>{booksError ? '브라우저 책장을 읽지 못했습니다: ' + booksError.message : '책장을 불러오는 중...'}</p>
      {booksError && <button type="button" className="btn" onClick={() => void loadBooks()}>재시도</button>}
    </div>;
  }

  // ---- 실제 모드: 세션 확인 전/비로그인/비밀번호 재설정 ----
  if (!demoMode) {
    if (!sessionChecked) {
      return (
        <div className="editor-page">
          <p>불러오는 중...</p>
        </div>
      );
    }
    if (!session || recoveryMode) {
      return <AuthScreen recoveryMode={recoveryMode} onRecoveryDone={() => setRecoveryMode(false)} />;
    }
  }

  // ---- 책 상세 화면 (맵/아웃라인) ----
  if (route.name !== 'shelf') {
    const book = books.find((b) => b.id === route.bookId);
    if (!book) {
      // 새로고침으로 바로 이 URL에 들어온 경우 책 목록이 아직 로딩 중일 수 있다 -
      // 그 사이에는 "찾을 수 없음"이 아니라 "불러오는 중"으로 보여준다.
      if (!demoMode && booksLoading && !booksError) {
        return (
          <div className="editor-page">
            <p>불러오는 중...</p>
          </div>
        );
      }
      return (
        <div>
          {demoMode && <div className="app-banner">{DEMO_BANNER_TEXT}</div>}
          <div className="editor-page">
            <p>해당 책을 찾을 수 없습니다.</p>
            <button type="button" className="btn" onClick={() => goTo('#/')}>
              책장으로 돌아가기
            </button>
          </div>
        </div>
      );
    }

    if (demoMode) {
      return (
        <div className="demo-editor-shell">
          <div className="app-banner">{DEMO_BANNER_TEXT}</div>
          <BookEditorPage
            key={book.id}
            book={book}
            mode={route.name}
            onBack={() => goTo('#/')}
            onSwitchMode={(m) => goTo(`#/books/${book.id}/${m}`)}
          />
        </div>
      );
    }

    return (
      <RealMapEditorScreen
        key={book.id}
        book={book}
        mode={route.name}
        userId={userId as string}
        onBack={() => goTo('#/')}
        onSwitchMode={(m) => goTo(`#/books/${book.id}/${m}`)}
        onLogout={() => void handleLogout()}
      />
    );
  }

  // ---- 책장 ----
  return (
    <div>
      {demoMode && <div className="app-banner">{DEMO_BANNER_TEXT}</div>}
      <header className="app-header">
        <h1>독서노트</h1>
        {!demoMode && (
          <button type="button" className="btn" onClick={() => void handleLogout()}>
            로그아웃
          </button>
        )}
      </header>

      <main>
        {isOffline && (
          <div className="app-banner">
            <p className="field-error">
              연결 실패로 마지막으로 불러온 책 목록을 읽기 전용으로 보여줍니다.
              {booksCachedAt && ` (마지막 정상 조회: ${new Date(booksCachedAt).toLocaleString('ko-KR')})`}
            </p>
            <p>
              인터넷 연결을 확인해 주세요. Supabase 무료 플랜은 일주일가량 쓰지 않으면 프로젝트가 일시정지될 수
              있습니다 - 그런 경우 Supabase 대시보드에서 프로젝트를 복구(Restore)한 뒤 다시 시도해 주세요.
            </p>
            <button type="button" className="btn" onClick={() => void loadBooks()}>
              재시도
            </button>
          </div>
        )}

        {!demoMode && booksLoading && books.length === 0 && !booksError ? (
          <p>불러오는 중...</p>
        ) : (
          <Bookshelf
            books={books}
            onAdd={openAdd}
            onOpenBook={(book, triggerElement) => setSelected({ book, triggerElement })}
            addDisabled={isOffline}
          />
        )}

        <BackupPanel
          readOnly={isOffline}
          checkUnsavedChanges={() => (userId ? listDraftBookIds(userId).then((ids) => ids.length > 0) : Promise.resolve(false))}
          onImported={() => void loadBooks()}
          exportEnabled={!demoMode}
          loadSnapshot={demoMode ? () => fetchDemoSnapshot(demoBooks) : undefined}
          importData={demoMode ? (diff) => applyDemoImport(demoBooks, diff) : undefined}
        />
      </main>

      {selected && (
        <BookDialog
          book={selected.book}
          triggerElement={selected.triggerElement}
          onClose={() => {
            setSelected(null);
            setBookActionError(null);
          }}
          onEdit={openEdit}
          onDelete={(id) => void handleDeleteBook(id)}
          onOpenMindmap={(book) => {
            setSelected(null);
            goTo(`#/books/${book.id}/map`);
          }}
          errorMessage={bookActionError}
          disabled={isOffline || bookActionBusy}
        />
      )}

      {editing && (
        <BookForm
          book={editing === 'new' ? undefined : editing}
          onSubmit={(input) => void handleBookFormSubmit(input)}
          onCancel={closeForm}
          errorMessage={bookActionError}
          busy={bookActionBusy}
        />
      )}
    </div>
  );
}

// =====================================================================
// 데모 모드 전용 (2단계 그대로): 로컬 IndexedDB 캐시만 쓰는 맵 편집 화면.
// =====================================================================

interface BookEditorPageProps {
  book: Book;
  mode: EditorMode;
  onBack: () => void;
  onSwitchMode: (mode: EditorMode) => void;
}

function BookEditorPage({ book, mode, onBack, onSwitchMode }: BookEditorPageProps) {
  const [loaded, setLoaded] = useState<{ nodes: MindmapNode[]; version: number; initialDirty?: boolean } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoaded(null);
    setLoadError(null);
    getCachedMap(DEMO_USER_ID, book.id)
      .then((cached) => {
        if (cancelled) return;
        if (cached.draft) {
          setLoaded({ nodes: cached.draft.nodes, version: cached.draft.baseVersion, initialDirty: true });
        } else if (cached.saved) {
          setLoaded({ nodes: cached.saved.nodes, version: cached.saved.version });
        } else {
          setLoaded({
            nodes: book.id === xmindExampleBook.id
              ? setRootText(xmindExampleNodes, book.title)
              : createInitialNodes(book.title, book.spine_color),
            version: 0,
          });
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(errorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [book.id, book.title, book.spine_color]);

  if (loadError) {
    return (
      <div className="editor-page">
        <p className="field-error" role="alert">마인드맵을 불러오지 못했습니다: {loadError}</p>
        <button type="button" className="btn" onClick={onBack}>
          책장으로 돌아가기
        </button>
      </div>
    );
  }

  if (!loaded) {
    return (
      <div className="editor-page">
        <p>불러오는 중...</p>
      </div>
    );
  }

  return (
    <BookMapWorkspace
      key={book.id}
      book={book}
      mode={mode}
      initialNodes={loaded.nodes}
      initialVersion={loaded.version}
      initialDirty={loaded.initialDirty}
      onBack={onBack}
      onSwitchMode={onSwitchMode}
    />
  );
}

interface BookMapWorkspaceProps {
  book: Book;
  mode: EditorMode;
  initialNodes: MindmapNode[];
  initialVersion: number;
  initialDirty?: boolean;
  onBack: () => void;
  onSwitchMode: (mode: EditorMode) => void;
}

const SAVE_STATE_LABEL: Record<SaveState, string> = {
  saved: '저장됨',
  pending: '저장 대기',
  saving: '저장 중',
  error: '저장 실패',
  conflict: '다른 기기에서 수정됨',
};

function BookMapWorkspace({
  book,
  mode,
  initialNodes,
  initialVersion,
  initialDirty = false,
  onBack,
  onSwitchMode,
}: BookMapWorkspaceProps) {
  const [nodes, setNodes] = useState(initialNodes);
  const [draftError, setDraftError] = useState<string | null>(null);

  const saveFn: SaveFn = useRef((toSave: MindmapNode[], expectedVersion: number) =>
    saveDemoMap(demoBooks, book.id, toSave, expectedVersion),
  ).current;

  const { state: saveState, version, retry } = useAutosave(nodes, saveFn, initialVersion, initialDirty);

  // 변경이 생기면 디바운스된 "진짜 저장"(useAutosave)과는 별도로, 새로고침 대비용 임시
  // 초안을 즉시(디바운스 없이) IndexedDB에 기록한다. 최초 마운트 시의 초기값은 이미
  // 캐시에 있던 내용이므로 건너뛴다.
  const lastDraftNodesRef = useRef(nodes);
  useEffect(() => {
    if (lastDraftNodesRef.current === nodes) return;
    lastDraftNodesRef.current = nodes;
    putDraft(DEMO_USER_ID, book.id, { nodes, baseVersion: version, edited_at: new Date().toISOString() }).catch(
      (err: unknown) => setDraftError(errorMessage(err)),
    );
    // version은 저장 성공 시에만 바뀌고, 그 순간 saveFn이 이미 draft를 지우므로
    // version 변화만으로 다시 쓸 필요는 없다. nodes가 바뀔 때만 기록한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes]);

  function handleChange(newNodes: MindmapNode[]) {
    setDraftError(null);
    setNodes(newNodes);
  }

  return (
    <div className="editor-page">
      <div className="editor-header">
        <h1>{book.title}</h1>
        <button type="button" className="btn" onClick={onBack}>
          책장으로 돌아가기
        </button>
        <div className="editor-tabs" role="tablist" aria-label="마인드맵 보기 전환">
          <button
            type="button"
            className={`btn${mode === 'map' ? ' active' : ''}`}
            role="tab"
            aria-selected={mode === 'map'}
            onClick={() => onSwitchMode('map')}
          >
            맵
          </button>
          <button
            type="button"
            className={`btn${mode === 'outline' ? ' active' : ''}`}
            role="tab"
            aria-selected={mode === 'outline'}
            onClick={() => onSwitchMode('outline')}
          >
            아웃라인
          </button>
        </div>
        <div
          className={`save-status${saveState === 'error' ? ' is-error' : ''}${
            saveState === 'conflict' ? ' is-conflict' : ''
          }`}
          role="status"
        >
          {SAVE_STATE_LABEL[saveState]}
          {saveState === 'error' && (
            <button type="button" className="btn" onClick={retry}>
              재시도
            </button>
          )}
        </div>
      </div>

      {draftError && <p className="field-error" role="alert">이 브라우저에 임시 저장하지 못했습니다: {draftError}</p>}

      {mode === 'map' ? (
        <MindmapEditor nodes={nodes} onChange={handleChange} />
      ) : (
        <OutlineEditor nodes={nodes} onChange={handleChange} />
      )}
    </div>
  );
}
