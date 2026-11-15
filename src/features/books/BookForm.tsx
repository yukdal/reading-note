import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import type { Book, BookInput, BookStatus } from '../../types';
import { bookInputToRaw, parseBookInput, type BookInputErrors, type BookInputRaw } from './bookInput';

interface BookFormProps {
  book?: Book;
  onSubmit: (value: BookInput) => void;
  onCancel: () => void;
  /** 서버 오류 등 폼 바깥에서 들어오는 오류(실제 모드). 입력 내용은 그대로 유지된다. */
  errorMessage?: string | null;
  busy?: boolean;
}

const EMPTY_RAW: BookInputRaw = {
  title: '',
  author: '',
  status: 'want',
  rating: '',
  spine_color: '#8b4513',
  page_count: '',
  cover_url: '',
  tags: '',
  started_on: '',
  finished_on: '',
};

const STATUS_LABEL: Record<BookStatus, string> = {
  want: '읽고 싶은',
  reading: '읽는 중',
  done: '완독',
};

export default function BookForm({ book, onSubmit, onCancel, errorMessage = null, busy = false }: BookFormProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [raw, setRaw] = useState<BookInputRaw>(() => (book ? bookInputToRaw(book) : EMPTY_RAW));
  const [errors, setErrors] = useState<BookInputErrors>({});
  const idPrefix = useId();

  // onCancel을 ref로 받아 최신 값을 쓰면서도, 마운트할 때 한 번만 showModal()을 부른다.
  // (실제 모드에서는 충돌/오류로 App이 다시 그려질 때마다 onCancel이 새 함수가 되는데,
  // 의존성으로 두면 이미 열린 dialog에 showModal()을 또 호출해 예외가 난다.)
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.showModal();
    const handleClose = () => onCancelRef.current();
    dialog.addEventListener('close', handleClose);
    return () => dialog.removeEventListener('close', handleClose);
  }, []);

  function set<K extends keyof BookInputRaw>(key: K, value: BookInputRaw[K]) {
    setRaw((prev) => ({ ...prev, [key]: value }));
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const result = parseBookInput(raw);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    onSubmit(result.value);
  }

  function errorId(field: keyof BookInputRaw) {
    return errors[field] ? `${idPrefix}-${field}-error` : undefined;
  }

  return (
    <dialog ref={dialogRef} aria-label={book ? '책 수정' : '책 추가'}>
      <div className="dialog-body">
        <h2>{book ? '책 수정' : '책 추가'}</h2>
        <form onSubmit={handleSubmit} noValidate>
          <div className="form-field">
            <label htmlFor={`${idPrefix}-title`}>제목</label>
            <input
              id={`${idPrefix}-title`}
              type="text"
              value={raw.title}
              onChange={(e) => set('title', e.target.value)}
              aria-invalid={!!errors.title}
              aria-describedby={errorId('title')}
            />
            {errors.title && (
              <span className="field-error" id={errorId('title')}>
                {errors.title}
              </span>
            )}
          </div>

          <div className="form-field">
            <label htmlFor={`${idPrefix}-author`}>저자</label>
            <input
              id={`${idPrefix}-author`}
              type="text"
              value={raw.author}
              onChange={(e) => set('author', e.target.value)}
            />
          </div>

          <div className="form-field">
            <label htmlFor={`${idPrefix}-status`}>상태</label>
            <select
              id={`${idPrefix}-status`}
              value={raw.status}
              onChange={(e) => set('status', e.target.value)}
            >
              {(Object.keys(STATUS_LABEL) as BookStatus[]).map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </div>

          <div className="form-field">
            <label htmlFor={`${idPrefix}-rating`}>별점</label>
            <select
              id={`${idPrefix}-rating`}
              value={raw.rating}
              onChange={(e) => set('rating', e.target.value)}
              aria-invalid={!!errors.rating}
              aria-describedby={errorId('rating')}
            >
              <option value="">없음</option>
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
            {errors.rating && (
              <span className="field-error" id={errorId('rating')}>
                {errors.rating}
              </span>
            )}
          </div>

          <div className="form-field">
            <label htmlFor={`${idPrefix}-page_count`}>쪽수</label>
            <input
              id={`${idPrefix}-page_count`}
              type="number"
              min={1}
              step={1}
              value={raw.page_count}
              onChange={(e) => set('page_count', e.target.value)}
              aria-invalid={!!errors.page_count}
              aria-describedby={errorId('page_count')}
            />
            {errors.page_count && (
              <span className="field-error" id={errorId('page_count')}>
                {errors.page_count}
              </span>
            )}
          </div>

          <div className="form-field">
            <label htmlFor={`${idPrefix}-spine_color`}>책등 색</label>
            <input
              id={`${idPrefix}-spine_color`}
              type="color"
              value={raw.spine_color}
              onChange={(e) => set('spine_color', e.target.value)}
              aria-invalid={!!errors.spine_color}
              aria-describedby={errorId('spine_color')}
            />
            {errors.spine_color && (
              <span className="field-error" id={errorId('spine_color')}>
                {errors.spine_color}
              </span>
            )}
          </div>

          <div className="form-field">
            <label htmlFor={`${idPrefix}-cover_url`}>표지 URL</label>
            <input
              id={`${idPrefix}-cover_url`}
              type="text"
              value={raw.cover_url}
              onChange={(e) => set('cover_url', e.target.value)}
              aria-invalid={!!errors.cover_url}
              aria-describedby={errorId('cover_url')}
              placeholder="https://..."
            />
            {errors.cover_url && (
              <span className="field-error" id={errorId('cover_url')}>
                {errors.cover_url}
              </span>
            )}
          </div>

          <div className="form-field">
            <label htmlFor={`${idPrefix}-tags`}>태그 (쉼표로 구분)</label>
            <input
              id={`${idPrefix}-tags`}
              type="text"
              value={raw.tags}
              onChange={(e) => set('tags', e.target.value)}
              placeholder="소설, 추리"
            />
          </div>

          <div className="form-field">
            <label htmlFor={`${idPrefix}-started_on`}>읽기 시작일</label>
            <input
              id={`${idPrefix}-started_on`}
              type="date"
              value={raw.started_on}
              onChange={(e) => set('started_on', e.target.value)}
              aria-invalid={!!errors.started_on}
              aria-describedby={errorId('started_on')}
            />
            {errors.started_on && (
              <span className="field-error" id={errorId('started_on')}>
                {errors.started_on}
              </span>
            )}
          </div>

          <div className="form-field">
            <label htmlFor={`${idPrefix}-finished_on`}>읽기 완료일</label>
            <input
              id={`${idPrefix}-finished_on`}
              type="date"
              value={raw.finished_on}
              onChange={(e) => set('finished_on', e.target.value)}
              aria-invalid={!!errors.finished_on}
              aria-describedby={errorId('finished_on')}
            />
            {errors.finished_on && (
              <span className="field-error" id={errorId('finished_on')}>
                {errors.finished_on}
              </span>
            )}
          </div>

          {errorMessage && <p className="field-error">{errorMessage}</p>}

          <div className="form-actions">
            <button type="button" className="btn" onClick={onCancel} disabled={busy}>
              취소
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              저장
            </button>
          </div>
        </form>
      </div>
    </dialog>
  );
}
