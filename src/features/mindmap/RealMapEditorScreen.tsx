import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Book, EditorMode, MindmapNode } from '../../types';
import MindmapEditor from './MindmapEditor';
import OutlineEditor from './OutlineEditor';
import { useAutosave, type SaveState } from './useAutosave';
import { reconcileDraft } from './draftReconcile';
import { getMindmap, makeSaveMindmap, classifyError, type ApiErrorKind } from '../../data/api';
import { getCachedMap, putSaved, putDraft, clearDraft, commitSavedMap } from '../../lib/localCache';

interface RealMapEditorScreenProps {
  book: Book;
  mode: EditorMode;
  userId: string;
  onBack: () => void;
  onSwitchMode: (mode: EditorMode) => void;
  onLogout: () => void;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : '알 수 없는 오류가 발생했습니다.';
}

function downloadDraftExport(bookId: string, nodes: MindmapNode[], baseVersion: number): void {
  const payload = {
    type: 'reading-note-draft',
    book_id: bookId,
    nodes,
    base_version: baseVersion,
    exported_at: new Date().toISOString(),
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `reading-note-draft-${bookId}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

type Phase =
  | { kind: 'loading' }
  | { kind: 'offline_unavailable' }
  | { kind: 'offline_readonly'; nodes: MindmapNode[]; lastGoodAt: string }
  | { kind: 'auth_error' }
  | { kind: 'load_error'; message: string }
  | { kind: 'conflict' }
  | { kind: 'ready'; nodes: MindmapNode[]; version: number; recoveredDraft: MindmapNode[] | null };

/**
 * 실제(Supabase) 모드의 맵 편집 화면. 진입 시 서버-초안 대조, 오프라인/인증 실패/충돌을
 * 모두 이 화면에서 처리하고, 정상일 때만 안쪽의 AutosavingWorkspace를 마운트한다
 * (useAutosave는 마운트 시점의 initialVersion을 그대로 고정해 쓰므로, 기준이 바뀔 때는
 * key를 바꿔 다시 마운트해야 한다 - reloadToken).
 */
export default function RealMapEditorScreen({ book, mode, userId, onBack, onSwitchMode, onLogout }: RealMapEditorScreenProps) {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [reloadToken, setReloadToken] = useState(0);
  const loadRequestRef = useRef(0);

  const load = useCallback(async () => {
    const requestId = ++loadRequestRef.current;
    const updatePhase = (next: Phase) => {
      if (requestId === loadRequestRef.current) setPhase(next);
    };
    updatePhase({ kind: 'loading' });
    try {
      const server = await getMindmap(book.id);
      const cached = await getCachedMap(userId, book.id);
      if (requestId !== loadRequestRef.current) return;
      const draft = cached.draft ? { nodes: cached.draft.nodes, baseVersion: cached.draft.baseVersion } : null;
      const action = reconcileDraft(draft, server);

      switch (action.kind) {
        case 'use_server':
          await putSaved(userId, book.id, server);
          updatePhase({ kind: 'ready', nodes: server.nodes, version: server.version, recoveredDraft: null });
          return;
        case 'draft_matches_server':
          await clearDraft(userId, book.id);
          await putSaved(userId, book.id, server);
          updatePhase({ kind: 'ready', nodes: server.nodes, version: server.version, recoveredDraft: null });
          return;
        case 'offer_recover': {
          const recover = window.confirm('저장되지 않은 편집이 있습니다. 복구할까요?');
          if (!recover) await clearDraft(userId, book.id);
          await putSaved(userId, book.id, server);
          updatePhase({
            kind: 'ready',
            nodes: server.nodes,
            version: server.version,
            recoveredDraft: recover ? (draft?.nodes ?? null) : null,
          });
          return;
        }
        case 'conflict':
          updatePhase({ kind: 'conflict' });
          return;
      }
    } catch (err) {
      if (requestId !== loadRequestRef.current) return;
      const classified = classifyError(err);
      if (classified.kind === 'auth') {
        updatePhase({ kind: 'auth_error' });
        return;
      }
      // 네트워크 등: 캐시가 있으면 읽기 전용으로 보여준다.
      const cached = await getCachedMap(userId, book.id).catch(() => null);
      if (cached?.saved) {
        updatePhase({
          kind: 'offline_readonly',
          nodes: cached.draft?.nodes ?? cached.saved.nodes,
          lastGoodAt: cached.saved.updated_at,
        });
      } else if (classified.kind === 'network' || classified.kind === 'unknown') {
        updatePhase({ kind: 'offline_unavailable' });
      } else {
        updatePhase({ kind: 'load_error', message: classified.message });
      }
    }
  }, [book.id, userId]);

  useEffect(() => {
    void load();
    return () => { loadRequestRef.current += 1; };
  }, [load, reloadToken]);

  function handleReloadLatest() {
    if (!window.confirm('초안을 버리고 최신본을 불러올까요? 이 작업은 되돌릴 수 없습니다.')) return;
    void clearDraft(userId, book.id).then(() => {
      setReloadToken((t) => t + 1);
    });
  }

  async function handleExportDraft() {
    const cached = await getCachedMap(userId, book.id);
    if (!cached.draft) return;
    downloadDraftExport(book.id, cached.draft.nodes, cached.draft.baseVersion);
  }

  // 로그아웃 버튼은 여기 넣지 않는다. AutosavingWorkspace가 마운트되면(= 'ready' 단계) 그
  // 안에서 미저장 변경을 확인하는 guarded 버전을 따로 그리므로, 여기서 unguarded 버튼을
  // 같이 두면 두 버튼이 겹치고 저장 확인 없이 바로 로그아웃될 수 있다.
  const header = (
    <div className="editor-header">
      <h1>{book.title}</h1>
      <button type="button" className="btn" onClick={onBack}>
        책장으로 돌아가기
      </button>
    </div>
  );
  // 'ready'가 아닌 단계는 미저장 변경이 있을 수 없으므로(AutosavingWorkspace가 아예 없음)
  // 곧바로 로그아웃해도 안전하다.
  const simpleLogoutButton = (
    <button type="button" className="btn" onClick={onLogout}>
      로그아웃
    </button>
  );

  if (phase.kind === 'loading') {
    return (
      <div className="editor-page">
        {header}
        {simpleLogoutButton}
        <p>불러오는 중...</p>
      </div>
    );
  }

  if (phase.kind === 'auth_error') {
    return (
      <div className="editor-page">
        {header}
        {simpleLogoutButton}
        <p className="field-error">
          로그인이 만료되었습니다. 다시 로그인해 주세요. (편집 중이던 내용은 이 브라우저에 보존됩니다)
        </p>
      </div>
    );
  }

  if (phase.kind === 'load_error') {
    return (
      <div className="editor-page">
        {header}
        {simpleLogoutButton}
        <p className="field-error" role="alert">마인드맵을 불러오지 못했습니다: {phase.message}</p>
        <button type="button" className="btn" onClick={() => void load()}>
          재시도
        </button>
      </div>
    );
  }

  if (phase.kind === 'offline_unavailable') {
    return (
      <div className="editor-page">
        {header}
        {simpleLogoutButton}
        <p className="field-error">오프라인에서는 읽을 수 없습니다. (이 책의 마인드맵을 아직 불러온 적이 없습니다)</p>
        <p>인터넷 연결을 확인해 주세요. Supabase 무료 플랜은 일주일가량 쓰지 않으면 프로젝트가 일시정지될 수 있습니다 -
          그런 경우 Supabase 대시보드에서 프로젝트를 복구(Restore)한 뒤 다시 시도해 주세요.</p>
        <button type="button" className="btn" onClick={() => void load()}>
          재시도
        </button>
      </div>
    );
  }

  if (phase.kind === 'offline_readonly') {
    return (
      <div className="editor-page">
        {header}
        {simpleLogoutButton}
        <p className="field-error">
          연결 실패로 읽기 전용으로 표시합니다. 마지막 정상 저장: {new Date(phase.lastGoodAt).toLocaleString('ko-KR')}
        </p>
        <p>인터넷 연결을 확인해 주세요. Supabase 무료 플랜은 일주일가량 쓰지 않으면 프로젝트가 일시정지될 수 있습니다 -
          그런 경우 Supabase 대시보드에서 프로젝트를 복구(Restore)한 뒤 다시 시도해 주세요.</p>
        <button type="button" className="btn" onClick={() => void load()}>
          재시도
        </button>
        {mode === 'map' ? (
          <MindmapEditor nodes={phase.nodes} onChange={() => {}} readOnly />
        ) : (
          <OutlineEditor nodes={phase.nodes} onChange={() => {}} readOnly />
        )}
      </div>
    );
  }

  if (phase.kind === 'conflict') {
    return (
      <div className="editor-page">
        {header}
        {simpleLogoutButton}
        <p className="field-error">다른 기기에서 수정되어 자동 저장을 멈췄습니다. 초안은 이 브라우저에 보존되어 있습니다.</p>
        <div className="form-actions">
          <button type="button" className="btn btn-danger" onClick={handleReloadLatest}>
            최신본 불러오기
          </button>
          <button type="button" className="btn" onClick={() => void handleExportDraft()}>
            내 초안 내보내기
          </button>
        </div>
      </div>
    );
  }

  return (
    <AutosavingWorkspace
      key={reloadToken}
      book={book}
      userId={userId}
      mode={mode}
      initialNodes={phase.nodes}
      initialVersion={phase.version}
      recoveredDraft={phase.recoveredDraft}
      onSwitchMode={onSwitchMode}
      onConflict={() => setPhase({ kind: 'conflict' })}
      onSilentServerUpdate={() => setReloadToken((t) => t + 1)}
      header={header}
      onLogout={onLogout}
    />
  );
}

const SAVE_STATE_LABEL: Record<SaveState, string> = {
  saved: '저장됨',
  pending: '저장 대기',
  saving: '저장 중',
  error: '저장 실패',
  conflict: '다른 기기에서 수정됨',
};

interface AutosavingWorkspaceProps {
  book: Book;
  userId: string;
  mode: EditorMode;
  initialNodes: MindmapNode[];
  initialVersion: number;
  recoveredDraft: MindmapNode[] | null;
  onSwitchMode: (mode: EditorMode) => void;
  onConflict: () => void;
  onSilentServerUpdate: () => void;
  header: ReactNode;
  onLogout: () => void;
}

function AutosavingWorkspace({
  book,
  userId,
  mode,
  initialNodes,
  initialVersion,
  recoveredDraft,
  onSwitchMode,
  onConflict,
  onSilentServerUpdate,
  header,
  onLogout,
}: AutosavingWorkspaceProps) {
  const [nodes, setNodes] = useState(recoveredDraft ?? initialNodes);
  const [lastErrorKind, setLastErrorKind] = useState<ApiErrorKind | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;

  const rawSave = useRef(makeSaveMindmap(book.id)).current;
  const saveFn = useRef(async (toSave: MindmapNode[], expectedVersion: number) => {
    try {
      const result = await rawSave(toSave, expectedVersion);
      if (result.status === 'ok') {
        await commitSavedMap(userId, book.id,
          { nodes: toSave, version: result.version, updated_at: result.updated_at }, expectedVersion);
      }
      setLastErrorKind(null);
      return result;
    } catch (err) {
      setLastErrorKind(classifyError(err).kind);
      throw err;
    }
  }).current;

  const { state: saveState, version, retry } = useAutosave(nodes, saveFn, initialVersion, recoveredDraft !== null);

  // 새로고침 대비 임시 초안(디바운스 없이 즉시 기록). 최초 마운트 값은 건너뛴다.
  const lastDraftNodesRef = useRef(nodes);
  useEffect(() => {
    if (lastDraftNodesRef.current === nodes) return;
    lastDraftNodesRef.current = nodes;
    putDraft(userId, book.id, { nodes, baseVersion: version, edited_at: new Date().toISOString() }).catch(
      (err: unknown) => setDraftError(errorMessage(err)),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes]);

  useEffect(() => {
    if (saveState === 'conflict') onConflict();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saveState]);

  /** 서버본을 조회해 대조 규칙으로 판단한다. 에러 상태의 재시도, 탭 복귀 때 모두 쓴다. */
  const checkServerAndReconcile = useCallback(async () => {
    setChecking(true);
    try {
      const server = await getMindmap(book.id);
      const hasUnsaved = saveState !== 'saved';
      const draft = hasUnsaved ? { nodes: nodesRef.current, baseVersion: version } : null;
      const action = reconcileDraft(draft, server);
      if (action.kind === 'use_server') {
        if (server.version !== version) onSilentServerUpdate();
      } else if (action.kind === 'draft_matches_server') {
        await clearDraft(userId, book.id);
        onSilentServerUpdate();
      } else if (action.kind === 'offer_recover') {
        retry();
      } else {
        onConflict();
      }
    } catch (err) {
      setLastErrorKind(classifyError(err).kind);
    } finally {
      setChecking(false);
    }
  }, [book.id, userId, version, saveState, retry, onConflict, onSilentServerUpdate]);

  useEffect(() => {
    function onVisible() {
      if (document.visibilityState !== 'visible') return;
      void checkServerAndReconcile();
    }
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [checkServerAndReconcile]);

  const hasUnsaved = saveState !== 'saved';
  useEffect(() => {
    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (!hasUnsaved) return;
      e.preventDefault();
      e.returnValue = '';
    }
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [hasUnsaved]);

  function guardedNav(action: () => void) {
    if (!hasUnsaved) {
      action();
      return;
    }
    if (window.confirm('아직 저장되지 않은 편집이 있습니다. 초안은 이 브라우저에 보존됩니다. 그래도 이동할까요?')) {
      action();
    }
  }

  // ponytail: 3지선다를 커스텀 모달 대신 window.prompt로 구현. 되돌릴 수 없는 작업이
  // 아니라서(취소/재시도 가능) 네이티브 prompt로 충분하다고 판단. 더 나은 UX가 필요해지면
  // 작은 다이얼로그 컴포넌트로 교체.
  function handleLogoutClick() {
    if (!hasUnsaved) {
      onLogout();
      return;
    }
    const choice = window.prompt(
      '저장되지 않은 편집이 있습니다.\n1) 저장 후 로그아웃\n2) 초안 내보내기\n3) 취소\n번호를 입력하세요 (1/2/3)',
      '3',
    );
    if (choice === '1') {
      retry();
      window.alert('저장을 시도합니다. 완료 후 다시 로그아웃을 눌러주세요.');
    } else if (choice === '2') {
      // ponytail: 초안은 지우지 않는다 - 내보내기는 백업일 뿐, 복구 가능성을 남겨 둔다.
      void getCachedMap(userId, book.id).then((cached) => {
        if (cached.draft) downloadDraftExport(book.id, cached.draft.nodes, cached.draft.baseVersion);
      });
    }
  }

  function handleChange(newNodes: MindmapNode[]) {
    setDraftError(null);
    setNodes(newNodes);
  }

  // 'conflict'은 onConflict 이펙트가 부모를 충돌 화면으로 바꿔주기 전 한 프레임 동안도
  // 편집 가능 상태로 보이지 않도록 미리 읽기 전용으로 둔다(Autosaver는 이미 멈춰 있음).
  const readOnly = saveState === 'error' || saveState === 'conflict';
  const errorLabel =
    saveState === 'error'
      ? lastErrorKind === 'auth'
        ? '다시 로그인해 주세요'
        : lastErrorKind === 'network'
          ? '연결 실패'
          : '저장 실패'
      : SAVE_STATE_LABEL[saveState];

  return (
    <div className="editor-page">
      {header}
      <div className="editor-header">
        <div className="editor-tabs" role="tablist" aria-label="마인드맵 보기 전환">
          <button
            type="button"
            className={`btn${mode === 'map' ? ' active' : ''}`}
            role="tab"
            aria-selected={mode === 'map'}
            onClick={() => guardedNav(() => onSwitchMode('map'))}
          >
            맵
          </button>
          <button
            type="button"
            className={`btn${mode === 'outline' ? ' active' : ''}`}
            role="tab"
            aria-selected={mode === 'outline'}
            onClick={() => guardedNav(() => onSwitchMode('outline'))}
          >
            아웃라인
          </button>
        </div>
        <div className={`save-status${saveState === 'error' ? ' is-error' : ''}`} role="status">
          {errorLabel}
          {saveState === 'error' && (
            <button type="button" className="btn" onClick={() => void checkServerAndReconcile()} disabled={checking}>
              재시도
            </button>
          )}
        </div>
        <button type="button" className="btn" onClick={handleLogoutClick}>
          로그아웃
        </button>
      </div>

      {draftError && <p className="field-error" role="alert">이 브라우저에 임시 저장하지 못했습니다: {draftError}</p>}

      {mode === 'map' ? (
        <MindmapEditor nodes={nodes} onChange={handleChange} readOnly={readOnly} />
      ) : (
        <OutlineEditor nodes={nodes} onChange={handleChange} readOnly={readOnly} />
      )}
    </div>
  );
}
