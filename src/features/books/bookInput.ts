import type { Book, BookInput, BookStatus } from '../../types';

export interface BookInputRaw {
  title: string;
  author: string;
  status: string;
  rating: string;
  spine_color: string;
  page_count: string;
  cover_url: string;
  tags: string;
  started_on: string;
  finished_on: string;
}

export type BookInputErrors = Partial<Record<keyof BookInputRaw, string>>;

export type BookInputResult =
  | { ok: true; value: BookInput }
  | { ok: false; errors: BookInputErrors };

const STATUSES: BookStatus[] = ['want', 'reading', 'done'];

function isValidDate(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const d = new Date(Date.UTC(year, month - 1, day));
  return (
    d.getUTCFullYear() === year &&
    d.getUTCMonth() === month - 1 &&
    d.getUTCDate() === day
  );
}

export function parseBookInput(raw: BookInputRaw): BookInputResult {
  const errors: BookInputErrors = {};

  const title = raw.title.trim();
  if (!title) errors.title = '제목을 입력해 주세요.';

  const author = raw.author.trim() === '' ? null : raw.author.trim();

  if (!STATUSES.includes(raw.status as BookStatus)) {
    errors.status = '상태를 선택해 주세요.';
  }
  const status = raw.status as BookStatus;

  let rating: number | null = null;
  if (raw.rating.trim() !== '') {
    const n = Number(raw.rating);
    if (!Number.isInteger(n) || n < 1 || n > 5) {
      errors.rating = '별점은 1~5 사이의 정수여야 합니다.';
    } else {
      rating = n;
    }
  }

  const spine_color = raw.spine_color.trim();
  if (!/^#[0-9A-Fa-f]{6}$/.test(spine_color)) {
    errors.spine_color = '색상은 #RRGGBB 형식이어야 합니다.';
  }

  let page_count: number | null = null;
  if (raw.page_count.trim() !== '') {
    const n = Number(raw.page_count);
    if (!Number.isInteger(n) || n <= 0) {
      errors.page_count = '쪽수는 1 이상의 정수여야 합니다.';
    } else {
      page_count = n;
    }
  }

  let cover_url: string | null = null;
  const coverRaw = raw.cover_url.trim();
  if (coverRaw !== '') {
    try {
      const u = new URL(coverRaw);
      if (u.protocol !== 'https:') {
        errors.cover_url = 'https 주소만 입력할 수 있습니다.';
      } else {
        cover_url = coverRaw;
      }
    } catch {
      errors.cover_url = '올바른 URL 형식이 아닙니다.';
    }
  }

  const tags = Array.from(
    new Set(
      raw.tags
        .split(',')
        .map((t) => t.trim())
        .filter((t) => t !== ''),
    ),
  );

  let started_on: string | null = null;
  if (raw.started_on.trim() !== '') {
    if (!isValidDate(raw.started_on.trim())) {
      errors.started_on = '존재하지 않는 날짜입니다.';
    } else {
      started_on = raw.started_on.trim();
    }
  }

  let finished_on: string | null = null;
  if (raw.finished_on.trim() !== '') {
    if (!isValidDate(raw.finished_on.trim())) {
      errors.finished_on = '존재하지 않는 날짜입니다.';
    } else {
      finished_on = raw.finished_on.trim();
    }
  }

  if (
    !errors.started_on &&
    !errors.finished_on &&
    started_on &&
    finished_on &&
    started_on > finished_on
  ) {
    errors.finished_on = '완료일은 시작일보다 빠를 수 없습니다.';
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: {
      title,
      author,
      status,
      rating,
      spine_color,
      page_count,
      cover_url,
      tags,
      started_on,
      finished_on,
    },
  };
}

export function bookInputToRaw(input: BookInput | Book): BookInputRaw {
  return {
    title: input.title,
    author: input.author ?? '',
    status: input.status,
    rating: input.rating === null ? '' : String(input.rating),
    spine_color: input.spine_color,
    page_count: input.page_count === null ? '' : String(input.page_count),
    cover_url: input.cover_url ?? '',
    tags: input.tags.join(', '),
    started_on: input.started_on ?? '',
    finished_on: input.finished_on ?? '',
  };
}
