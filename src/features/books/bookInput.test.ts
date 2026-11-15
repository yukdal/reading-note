import { describe, expect, it } from 'vitest';
import { parseBookInput, type BookInputRaw } from './bookInput';

function raw(overrides: Partial<BookInputRaw> = {}): BookInputRaw {
  return {
    title: '제목',
    author: '',
    status: 'want',
    rating: '',
    spine_color: '#A0522D',
    page_count: '',
    cover_url: '',
    tags: '',
    started_on: '',
    finished_on: '',
    ...overrides,
  };
}

describe('parseBookInput', () => {
  it('제목이 비면 거부', () => {
    const r = parseBookInput(raw({ title: '   ' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.title).toBeDefined();
  });

  it('제목 trim 후 통과', () => {
    const r = parseBookInput(raw({ title: '  책 제목  ' }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.title).toBe('책 제목');
  });

  it('선택 텍스트 빈 값은 null로 정규화', () => {
    const r = parseBookInput(raw({ author: '  ', cover_url: '', started_on: '', finished_on: '' }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.author).toBeNull();
      expect(r.value.cover_url).toBeNull();
      expect(r.value.started_on).toBeNull();
      expect(r.value.finished_on).toBeNull();
    }
  });

  it('page_count 양의 정수 통과', () => {
    const r = parseBookInput(raw({ page_count: '320' }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.page_count).toBe(320);
  });

  it('page_count 0 이하 거부', () => {
    const r = parseBookInput(raw({ page_count: '0' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.page_count).toBeDefined();
  });

  it('page_count 소수 거부', () => {
    const r = parseBookInput(raw({ page_count: '3.5' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.page_count).toBeDefined();
  });

  it('rating 1~5 통과', () => {
    const r = parseBookInput(raw({ rating: '5' }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.rating).toBe(5);
  });

  it('rating 범위 밖 거부', () => {
    const r = parseBookInput(raw({ rating: '6' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.rating).toBeDefined();
  });

  it('존재하지 않는 날짜 거부 (2026-02-30)', () => {
    const r = parseBookInput(raw({ started_on: '2026-02-30' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.started_on).toBeDefined();
  });

  it('존재하는 날짜 통과', () => {
    const r = parseBookInput(raw({ started_on: '2026-02-28' }));
    expect(r.ok).toBe(true);
  });

  it('시작일 > 완료일 거부', () => {
    const r = parseBookInput(raw({ started_on: '2026-05-10', finished_on: '2026-05-01' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.finished_on).toBeDefined();
  });

  it('시작일 == 완료일 통과', () => {
    const r = parseBookInput(raw({ started_on: '2026-05-10', finished_on: '2026-05-10' }));
    expect(r.ok).toBe(true);
  });

  it('cover_url https 통과', () => {
    const r = parseBookInput(raw({ cover_url: 'https://example.com/a.jpg' }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.cover_url).toBe('https://example.com/a.jpg');
  });

  it('cover_url http 거부', () => {
    const r = parseBookInput(raw({ cover_url: 'http://example.com/a.jpg' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.cover_url).toBeDefined();
  });

  it('cover_url javascript: 거부', () => {
    const r = parseBookInput(raw({ cover_url: 'javascript:alert(1)' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.cover_url).toBeDefined();
  });

  it('cover_url 파싱 불가 거부', () => {
    const r = parseBookInput(raw({ cover_url: 'not a url' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.cover_url).toBeDefined();
  });

  it('spine_color 올바른 HEX 통과', () => {
    const r = parseBookInput(raw({ spine_color: '#123abc' }));
    expect(r.ok).toBe(true);
  });

  it('spine_color 잘못된 형식 거부', () => {
    const r = parseBookInput(raw({ spine_color: 'red' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.spine_color).toBeDefined();
  });

  it('tags 쉼표 분리, trim, 빈 값 제거, 중복 제거', () => {
    const r = parseBookInput(raw({ tags: ' 소설, 추리 ,소설,,  SF ' }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.tags).toEqual(['소설', '추리', 'SF']);
  });

  it('tags 빈 입력은 빈 배열', () => {
    const r = parseBookInput(raw({ tags: '' }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.tags).toEqual([]);
  });

  it('status 잘못된 값 거부', () => {
    const r = parseBookInput(raw({ status: 'unknown' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.status).toBeDefined();
  });

  it('status 세 값 모두 통과', () => {
    for (const s of ['want', 'reading', 'done']) {
      const r = parseBookInput(raw({ status: s }));
      expect(r.ok).toBe(true);
    }
  });
});
