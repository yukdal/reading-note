import { useEffect, useRef, useState } from 'react';
import type { Book } from '../../types';
import { spineTextColor } from './Bookshelf';

interface BookDialogProps {
  book: Book;
  triggerElement: HTMLElement | null;
  onClose: () => void;
  onEdit: (book: Book) => void;
  onDelete: (bookId: string) => void;
  onOpenMindmap: (book: Book) => void;
  /** 삭제 실패/충돌 등 서버 오류(실제 모드). 값이 바뀌면 재확인을 다시 받도록 확인 단계를 접는다. */
  errorMessage?: string | null;
  disabled?: boolean;
}

const STATUS_LABEL: Record<Book['status'], string> = {
  want: '읽고 싶은',
  reading: '읽는 중',
  done: '완독',
};

export default function BookDialog({
  book,
  triggerElement,
  onClose,
  onEdit,
  onDelete,
  onOpenMindmap,
  errorMessage = null,
  disabled = false,
}: BookDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [coverFailed, setCoverFailed] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // 삭제 충돌/오류를 받으면 재확인을 다시 받도록 확인 단계를 접는다(최신 정보를 보고 다시 판단).
  useEffect(() => {
    if (errorMessage) setConfirmingDelete(false);
  }, [errorMessage]);

  // onClose를 ref로 받아 최신 값을 쓰면서도 마운트할 때 한 번만 showModal()을 부른다.
  // (실제 모드에서는 삭제 충돌/오류로 App이 다시 그려질 때마다 onClose가 새 함수가 되는데,
  // 의존성으로 두면 이미 열린 dialog에 showModal()을 또 호출해 예외가 난다.)
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.showModal();
    const handleClose = () => onCloseRef.current();
    dialog.addEventListener('close', handleClose);
    return () => {
      dialog.removeEventListener('close', handleClose);
      triggerElement?.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <dialog ref={dialogRef} aria-label={`${book.title} 상세 정보`}>
      <div className="dialog-body">
        <div className="book-dialog-inner" key={book.id}>
          {book.cover_url && !coverFailed ? (
            <img
              className="book-cover"
              src={book.cover_url}
              alt={`${book.title} 표지`}
              onError={() => setCoverFailed(true)}
            />
          ) : (
            <div
              className="book-cover-fallback"
              style={{ background: book.spine_color, color: spineTextColor(book.spine_color) }}
            >
              {book.title}
            </div>
          )}

          <div className="book-info">
            <dl>
              <dt>제목</dt>
              <dd>{book.title}</dd>
              <dt>저자</dt>
              <dd>{book.author ?? '정보 없음'}</dd>
              <dt>상태</dt>
              <dd>{STATUS_LABEL[book.status]}</dd>
              <dt>별점</dt>
              <dd>{book.rating ? `${'★'.repeat(book.rating)}${'☆'.repeat(5 - book.rating)}` : '없음'}</dd>
              <dt>쪽수</dt>
              <dd>{book.page_count ? `${book.page_count}쪽` : '정보 없음'}</dd>
              <dt>태그</dt>
              <dd>{book.tags.length > 0 ? book.tags.join(', ') : '없음'}</dd>
              <dt>읽기 시작일</dt>
              <dd>{book.started_on ?? '없음'}</dd>
              <dt>읽기 완료일</dt>
              <dd>{book.finished_on ?? '없음'}</dd>
            </dl>
          </div>

          <div className="book-actions">
            <button type="button" className="btn" onClick={() => onEdit(book)} disabled={disabled}>
              수정
            </button>
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => setConfirmingDelete(true)}
              disabled={disabled}
            >
              삭제
            </button>
            {/* 오프라인이어도 마인드맵은 읽기 전용으로라도 열 수 있어야 하므로 disabled를 걸지 않는다. */}
            <button type="button" className="btn" onClick={() => onOpenMindmap(book)}>
              마인드맵 열기
            </button>
            <button type="button" className="btn" onClick={onClose}>
              닫기
            </button>
          </div>

          {errorMessage && <p className="field-error" role="alert">{errorMessage}</p>}

          {confirmingDelete && (
            <div className="confirm-delete">
              <p>「{book.title}」을(를) 삭제할까요? 이 작업은 되돌릴 수 없습니다.</p>
              <button type="button" className="btn btn-danger" onClick={() => onDelete(book.id)} disabled={disabled}>
                삭제 확정
              </button>
              <button type="button" className="btn" onClick={() => setConfirmingDelete(false)}>
                취소
              </button>
            </div>
          )}
        </div>
      </div>
    </dialog>
  );
}
