import { useMemo, useState, type CSSProperties } from 'react';
import type { Book, BookStatus } from '../../types';

interface BookshelfProps {
  books: Book[];
  onAdd: () => void;
  onOpenBook: (book: Book, triggerElement: HTMLElement) => void;
  /** 오프라인 읽기 전용일 때 "책 추가"를 막는다. 목록 열람·책 열기는 그대로 둔다. */
  addDisabled?: boolean;
}

type Filter = 'all' | BookStatus;

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: '전체' },
  { value: 'want', label: '읽고 싶은' },
  { value: 'reading', label: '읽는 중' },
  { value: 'done', label: '완독' },
];

function sortBooks(books: Book[]): Book[] {
  return [...books].sort((a, b) => {
    if (a.shelf_order !== b.shelf_order) return a.shelf_order - b.shelf_order;
    if (a.created_at !== b.created_at) return a.created_at < b.created_at ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

function spineWidth(pageCount: number | null): number {
  if (pageCount === null) return 40;
  const scaled = 24 + (pageCount / 1200) * 40;
  return Math.round(Math.min(64, Math.max(24, scaled)));
}

export function spineTextColor(hex: string): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return '#ffffff';
  const [r, g, b] = [m[1], m[2], m[3]].map((h) => parseInt(h, 16));
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? '#2b1d10' : '#ffffff';
}

export default function Bookshelf({ books, onAdd, onOpenBook, addDisabled = false }: BookshelfProps) {
  const [filter, setFilter] = useState<Filter>('all');

  const sorted = useMemo(() => sortBooks(books), [books]);
  const filtered = useMemo(
    () => (filter === 'all' ? sorted : sorted.filter((b) => b.status === filter)),
    [sorted, filter],
  );

  return (
    <div>
      <div className="toolbar">
        <div className="filter-bar" role="group" aria-label="상태 필터">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              className={`btn filter-btn${filter === f.value ? ' active' : ''}`}
              aria-pressed={filter === f.value}
              onClick={() => setFilter(f.value)}
            >
              {f.label}
            </button>
          ))}
        </div>
        <button type="button" className="btn btn-primary" onClick={onAdd} disabled={addDisabled}>
          책 추가
        </button>
      </div>

      {books.length === 0 ? (
        <div className="shelf-empty">
          <p>아직 등록된 책이 없습니다.</p>
          <button type="button" className="btn btn-primary" onClick={onAdd} disabled={addDisabled}>
            책 추가
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="shelf-empty">
          <p>이 상태에 해당하는 책이 없습니다.</p>
        </div>
      ) : (
        <div className="shelf-wrap">
          {filtered.map((book) => (
            <button
              key={book.id}
              type="button"
              className="book-spine"
              style={
                {
                  '--spine-width': `${spineWidth(book.page_count)}px`,
                  '--spine-color': book.spine_color,
                  '--spine-text-color': spineTextColor(book.spine_color),
                } as CSSProperties
              }
              aria-label={`${book.title}${book.author ? `, ${book.author}` : ''}`}
              onClick={(e) => onOpenBook(book, e.currentTarget)}
            >
              <span className="spine-title">{book.title}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
