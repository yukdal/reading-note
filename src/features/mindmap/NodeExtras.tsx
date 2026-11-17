import { useId, useState } from 'react';
import { MAX_NOTE_LENGTH, TEXT_COLORS } from './model';

interface NoteEditorProps {
  /** 편집할 항목 글(제목 표시용). */
  label: string;
  note: string;
  readOnly?: boolean;
  /** 빈 글이면 메모 삭제로 처리된다(setNote 규칙). */
  onSave: (note: string) => void;
  onClose: () => void;
}

/** 항목 메모 보기·편집 창. 메모는 글자로만 보여준다(HTML로 넣지 않음). 맵·아웃라인이 함께 쓴다. */
export function NoteEditor({ label, note, readOnly = false, onSave, onClose }: NoteEditorProps) {
  const [draft, setDraft] = useState(note);
  const id = useId();

  return (
    <div className="note-panel" role="group" aria-label="메모">
      <label htmlFor={id} className="note-panel-title">
        「{label || '(빈 항목)'}」 메모
      </label>
      <textarea
        id={id}
        value={draft}
        maxLength={MAX_NOTE_LENGTH}
        readOnly={readOnly}
        rows={5}
        onChange={(e) => setDraft(e.target.value)}
      />
      <p className="note-count">
        {draft.length} / {MAX_NOTE_LENGTH}자
      </p>
      <div className="note-actions">
        {!readOnly && (
          <button type="button" className="btn btn-primary" onClick={() => onSave(draft)}>
            저장
          </button>
        )}
        {!readOnly && note !== '' && (
          <button type="button" className="btn btn-danger" onClick={() => onSave('')}>
            메모 삭제
          </button>
        )}
        <button type="button" className="btn" onClick={onClose}>
          {readOnly ? '닫기' : '취소'}
        </button>
      </div>
    </div>
  );
}

interface TextColorPickerProps {
  value: string | undefined;
  disabled?: boolean;
  /** null이면 기본 글씨색으로 되돌린다. */
  onChange: (color: string | null) => void;
}

/** 정해진 글씨색 중에서 고르는 버튼 줄. 자유 색상표는 쓰지 않는다(읽기 어려운 색 방지). */
export function TextColorPicker({ value, disabled = false, onChange }: TextColorPickerProps) {
  return (
    <div className="text-color-picker" role="group" aria-label="글씨색">
      <span className="text-color-label" aria-hidden="true">
        글씨색
      </span>
      <button
        type="button"
        className="btn"
        aria-pressed={value === undefined}
        onClick={() => onChange(null)}
        disabled={disabled}
      >
        기본
      </button>
      {TEXT_COLORS.map((c) => (
        <button
          key={c.value}
          type="button"
          className={`color-swatch${value === c.value ? ' active' : ''}`}
          style={{ background: c.value }}
          aria-label={`글씨색 ${c.label}`}
          aria-pressed={value === c.value}
          title={c.label}
          onClick={() => onChange(c.value)}
          disabled={disabled}
        />
      ))}
    </div>
  );
}
