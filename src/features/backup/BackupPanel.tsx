import { useId, useState } from 'react';
import type { ChangeEvent } from 'react';
import {
  applyImport,
  diffBackup,
  exportFileName,
  downloadJson,
  fetchSnapshot,
  parseBackupFile,
  MAX_BACKUP_FILE_BYTES,
} from './backup';
import type { Backup, DiffResult, ImportResult, Snapshot } from './backup';

export interface BackupPanelProps {
  readOnly: boolean; // 연결 장애 시 true → 가져오기 비활성
  hasUnsavedChanges: boolean; // 미저장 맵 편집이 있으면 true
  onImported: () => void;
  loadSnapshot?: () => Promise<Snapshot>;
  importData?: (diff: DiffResult) => Promise<ImportResult>;
  exportEnabled?: boolean;
}

type ExportState =
  | { kind: 'idle' }
  | { kind: 'busy' }
  | { kind: 'error'; message: string }
  | { kind: 'done' };

type ImportPhase =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'preview'; backup: Backup; diff: DiffResult }
  | { kind: 'applying'; backup: Backup; diff: DiffResult }
  | { kind: 'done'; added: number; changed: number };

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : '알 수 없는 오류가 발생했습니다.';
}

function importStatusText(phase: ImportPhase, error: string | null): string {
  if (error) return error;
  switch (phase.kind) {
    case 'idle':
      return '가져올 백업 파일을 선택하세요.';
    case 'checking':
      return '파일을 확인하는 중입니다...';
    case 'preview': {
      const total = phase.diff.added.length + phase.diff.changed.length;
      const base = `추가 ${phase.diff.added.length}권, 변경 ${phase.diff.changed.length}권, 동일 ${phase.diff.sameCount}권. 파일에 없는 기존 책은 그대로 유지됩니다.`;
      return total === 0 ? `${base} 바뀌는 내용이 없습니다.` : base;
    }
    case 'applying':
      return '적용하는 중입니다...';
    case 'done':
      return `가져오기 완료: 추가 ${phase.added}권, 변경 ${phase.changed}권.`;
  }
}

export default function BackupPanel({
  readOnly, hasUnsavedChanges, onImported,
  loadSnapshot = fetchSnapshot, importData = applyImport, exportEnabled = true,
}: BackupPanelProps) {
  const fileInputId = useId();
  const [exportState, setExportState] = useState<ExportState>({ kind: 'idle' });
  const [importPhase, setImportPhase] = useState<ImportPhase>({ kind: 'idle' });
  const [importError, setImportError] = useState<string | null>(null);

  async function handleExport() {
    if (hasUnsavedChanges) {
      setExportState({ kind: 'error', message: '저장되지 않은 편집이 있습니다. 저장이 끝난 뒤 내보내 주세요.' });
      return;
    }
    setExportState({ kind: 'busy' });
    try {
      const snapshot = await loadSnapshot();
      downloadJson(exportFileName(), snapshot);
      setExportState({ kind: 'done' });
    } catch (err) {
      setExportState({ kind: 'error', message: errorText(err) });
    }
  }

  async function loadPreview(backup: Backup, message: string | null = null) {
    setImportPhase({ kind: 'checking' });
    try {
      const snapshot = await loadSnapshot();
      const diff = diffBackup(backup, snapshot);
      setImportError(message);
      setImportPhase({ kind: 'preview', backup, diff });
    } catch (err) {
      setImportError(errorText(err));
      setImportPhase({ kind: 'idle' });
    }
  }

  async function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // 같은 파일을 다시 선택할 수 있게
    if (!file) return;

    setImportError(null);
    if (file.size > MAX_BACKUP_FILE_BYTES) {
      setImportPhase({ kind: 'idle' });
      setImportError(`파일이 너무 큽니다 (최대 ${Math.floor(MAX_BACKUP_FILE_BYTES / (1024 * 1024))}MB).`);
      return;
    }

    setImportPhase({ kind: 'checking' });
    let text: string;
    try {
      text = await file.text();
    } catch {
      setImportPhase({ kind: 'idle' });
      setImportError('파일을 읽을 수 없습니다.');
      return;
    }

    const parsed = parseBackupFile(text);
    if (!parsed.ok) {
      setImportPhase({ kind: 'idle' });
      setImportError(parsed.error);
      return;
    }
    await loadPreview(parsed.backup);
  }

  async function handleApply() {
    if (importPhase.kind !== 'preview') return;
    const { backup, diff } = importPhase;
    setImportPhase({ kind: 'applying', backup, diff });
    try {
      const result = await importData(diff);
      if (result.status === 'conflict') {
        await loadPreview(backup, '미리보기 이후 다른 곳에서 수정되었습니다. 새 미리보기를 확인해 주세요.');
        return;
      }
      setImportError(null);
      setImportPhase({ kind: 'done', added: result.added, changed: result.changed });
      onImported();
    } catch (err) {
      setImportError(`아무것도 변경되지 않았습니다. ${errorText(err)}`);
      setImportPhase({ kind: 'preview', backup, diff });
    }
  }

  function handleCancelPreview() {
    setImportPhase({ kind: 'idle' });
    setImportError(null);
  }

  function handleReset() {
    setImportPhase({ kind: 'idle' });
    setImportError(null);
  }

  const importBusy = importPhase.kind === 'checking' || importPhase.kind === 'applying';
  const importDisabled = readOnly || importBusy;

  return (
    <section className="backup-panel" aria-label="백업 내보내기·가져오기">
      <h2>{exportEnabled ? '백업' : 'JSON 가져오기'}</h2>

      {exportEnabled && (
        <div className="backup-section">
          <h3>내보내기</h3>
          <button type="button" className="btn" onClick={handleExport} disabled={exportState.kind === 'busy'}>
            앱 안의 JSON으로 내보내기
          </button>
          <p className="backup-status" aria-live="polite">
            {exportState.kind === 'error'
              ? exportState.message
              : exportState.kind === 'busy'
                ? '내보내는 중입니다...'
                : exportState.kind === 'done'
                  ? '내보내기가 완료되었습니다.'
                  : ''}
          </p>
        </div>
      )}

      <div className="backup-section">
        <h3>가져오기</h3>

        {readOnly && <p className="field-error">연결이 불안정하여 가져오기를 사용할 수 없습니다.</p>}

        <div className="form-field">
          <label htmlFor={fileInputId}>백업 파일 선택</label>
          <input
            id={fileInputId}
            type="file"
            accept="application/json,.json"
            onChange={handleFileChange}
            disabled={importDisabled}
          />
        </div>

        <p className="backup-status" aria-live="polite">
          {importStatusText(importPhase, importError)}
        </p>

        {importPhase.kind === 'preview' && (
          <div className="backup-preview">
            {importPhase.diff.added.length > 0 && (
              <>
                <p>추가될 책</p>
                <ul>
                  {importPhase.diff.added.map((item) => (
                    <li key={item.book_id}>{item.title}</li>
                  ))}
                </ul>
              </>
            )}
            {importPhase.diff.changed.length > 0 && (
              <>
                <p>변경될 책</p>
                <ul>
                  {importPhase.diff.changed.map((item) => (
                    <li key={item.book_id}>{item.title}</li>
                  ))}
                </ul>
              </>
            )}

            <div className="form-actions">
              {importPhase.diff.added.length + importPhase.diff.changed.length > 0 && (
                <button type="button" className="btn btn-primary" onClick={handleApply}>
                  적용
                </button>
              )}
              <button type="button" className="btn" onClick={handleCancelPreview}>
                취소
              </button>
            </div>
          </div>
        )}

        {importPhase.kind === 'done' && (
          <button type="button" className="btn" onClick={handleReset}>
            새로 가져오기
          </button>
        )}
      </div>
    </section>
  );
}
