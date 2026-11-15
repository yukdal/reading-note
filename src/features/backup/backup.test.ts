import { describe, expect, it } from 'vitest';
import type { Book, Mindmap, MindmapNode } from '../../types';
import { diffBackup, parseBackupFile, type Backup, type Snapshot } from './backup';

function rawBook(partial: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    title: '책 제목',
    author: '작가',
    status: 'reading',
    rating: null,
    spine_color: '#8b5e3c',
    page_count: null,
    cover_url: null,
    tags: ['tag1'],
    started_on: null,
    finished_on: null,
    ...partial,
  };
}

function rawNode(partial: Partial<MindmapNode> & Pick<MindmapNode, 'id' | 'parentId'>): MindmapNode {
  return { text: '', color: '#111111', collapsed: false, order: 0, ...partial };
}

function rawMap(bookId: string, title: string, extraNodes: MindmapNode[] = []): Record<string, unknown> {
  return {
    book_id: bookId,
    data: { nodes: [rawNode({ id: `${bookId}-root`, parentId: null, text: title }), ...extraNodes] },
    version: 1,
    updated_at: '2024-01-01T00:00:00Z',
  };
}

function validFile(): { books: unknown[]; mindmaps: unknown[] } {
  return { books: [rawBook()], mindmaps: [rawMap('11111111-1111-1111-1111-111111111111', '책 제목')] };
}

describe('parseBackupFile', () => {
  it('정상 파일은 통과', () => {
    const r = parseBackupFile(JSON.stringify(validFile()));
    expect(r.ok).toBe(true);
  });

  it('잘못된 JSON은 거부', () => {
    const r = parseBackupFile('{ 이건 json 아님');
    expect(r.ok).toBe(false);
  });

  it('최상위가 객체가 아니면 거부', () => {
    expect(parseBackupFile('[]').ok).toBe(false);
    expect(parseBackupFile('"문자열"').ok).toBe(false);
  });

  it('books/mindmaps 배열이 없으면 거부', () => {
    const r = parseBackupFile(JSON.stringify({ books: [] }));
    expect(r.ok).toBe(false);
  });

  it('책 필드 오류(색상 형식)를 거부하고 어느 책인지 알려준다', () => {
    const file = { books: [rawBook({ spine_color: 'red' })], mindmaps: validFile().mindmaps };
    const r = parseBackupFile(JSON.stringify(file));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('책등 색상');
  });

  it('중복된 책 id는 거부', () => {
    const file = {
      books: [rawBook(), rawBook()],
      mindmaps: [rawMap('11111111-1111-1111-1111-111111111111', '책 제목')],
    };
    const r = parseBackupFile(JSON.stringify(file));
    expect(r.ok).toBe(false);
  });

  it('같은 책의 맵이 중복되면 거부', () => {
    const file = {
      books: [rawBook()],
      mindmaps: [
        rawMap('11111111-1111-1111-1111-111111111111', '책 제목'),
        rawMap('11111111-1111-1111-1111-111111111111', '책 제목'),
      ],
    };
    const r = parseBackupFile(JSON.stringify(file));
    expect(r.ok).toBe(false);
  });

  it('맵이 없는 책은 거부', () => {
    const file = { books: [rawBook()], mindmaps: [] };
    const r = parseBackupFile(JSON.stringify(file));
    expect(r.ok).toBe(false);
  });

  it('책 없는(참조가 끊긴) 맵은 거부', () => {
    const file = {
      books: [],
      mindmaps: [rawMap('22222222-2222-2222-2222-222222222222', '다른 책')],
    };
    const r = parseBackupFile(JSON.stringify(file));
    expect(r.ok).toBe(false);
  });

  it('노드 순환은 거부', () => {
    const bookId = '11111111-1111-1111-1111-111111111111';
    const nodes = [
      rawNode({ id: 'root', parentId: null, text: '책 제목' }),
      rawNode({ id: 'a', parentId: 'b', text: 'A' }),
      rawNode({ id: 'b', parentId: 'a', text: 'B' }),
    ];
    const file = {
      books: [rawBook({ id: bookId })],
      mindmaps: [{ book_id: bookId, data: { nodes } }],
    };
    const r = parseBackupFile(JSON.stringify(file));
    expect(r.ok).toBe(false);
  });

  it('소유자(user_id)가 서로 다른 값으로 섞여 있으면 거부', () => {
    const file = {
      books: [rawBook({ user_id: 'user-a' })],
      mindmaps: [
        { ...rawMap('11111111-1111-1111-1111-111111111111', '책 제목'), user_id: 'user-b' },
      ],
    };
    const r = parseBackupFile(JSON.stringify(file));
    expect(r.ok).toBe(false);
  });

  it('user_id가 아예 없는 것은 허용', () => {
    const r = parseBackupFile(JSON.stringify(validFile()));
    expect(r.ok).toBe(true);
  });

  it('중심 노드 text가 책 제목과 다르면 거부', () => {
    const bookId = '11111111-1111-1111-1111-111111111111';
    const file = {
      books: [rawBook({ id: bookId, title: '진짜 제목' })],
      mindmaps: [rawMap(bookId, '다른 제목')],
    };
    const r = parseBackupFile(JSON.stringify(file));
    expect(r.ok).toBe(false);
  });
});

describe('diffBackup', () => {
  const bookId = '11111111-1111-1111-1111-111111111111';

  function backupOf(bookOverrides: Partial<Record<string, unknown>> = {}, nodes?: MindmapNode[]): Backup {
    const parsed = parseBackupFile(
      JSON.stringify({
        books: [rawBook({ id: bookId, ...bookOverrides })],
        mindmaps: [
          nodes
            ? { book_id: bookId, data: { nodes } }
            : rawMap(bookId, (bookOverrides.title as string) ?? '책 제목'),
        ],
      }),
    );
    if (!parsed.ok) throw new Error('테스트 fixture가 유효하지 않음: ' + parsed.error);
    return parsed.backup;
  }

  function currentBook(overrides: Partial<Book> = {}): Book {
    return {
      id: bookId,
      user_id: 'user-a',
      title: '책 제목',
      author: '작가',
      status: 'reading',
      rating: null,
      spine_color: '#8b5e3c',
      page_count: null,
      cover_url: null,
      tags: ['tag1'],
      shelf_order: 0,
      started_on: null,
      finished_on: null,
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
      ...overrides,
    };
  }

  function currentMap(nodes: MindmapNode[], overrides: Partial<Mindmap> = {}): Mindmap {
    return {
      book_id: bookId,
      user_id: 'user-a',
      data: { nodes },
      version: 1,
      updated_at: '2024-01-01T00:00:00Z',
      ...overrides,
    };
  }

  it('현재 DB에 없는 책은 added로 분류', () => {
    const backup = backupOf();
    const current: Snapshot = { books: [], mindmaps: [] };
    const diff = diffBackup(backup, current);
    expect(diff.added).toHaveLength(1);
    expect(diff.changed).toHaveLength(0);
    expect(diff.sameCount).toBe(0);
  });

  it('서버 관리 값(updated_at 등)만 다르면 동일로 분류', () => {
    const backup = backupOf();
    const current: Snapshot = {
      books: [currentBook({ updated_at: '2099-01-01T00:00:00Z', shelf_order: 5 })],
      mindmaps: [currentMap(backup.mindmaps[0].data.nodes, { version: 9 })],
    };
    const diff = diffBackup(backup, current);
    expect(diff.sameCount).toBe(1);
    expect(diff.added).toHaveLength(0);
    expect(diff.changed).toHaveLength(0);
  });

  it('태그가 하나만 달라도 변경으로 분류', () => {
    const backup = backupOf({ tags: ['다른태그'] });
    const current: Snapshot = {
      books: [currentBook()],
      mindmaps: [currentMap(backup.mindmaps[0].data.nodes)],
    };
    const diff = diffBackup(backup, current);
    expect(diff.changed).toHaveLength(1);
    expect(diff.changed[0].expected).toEqual({
      book_id: bookId,
      updated_at: '2024-01-01T00:00:00Z',
      map_version: 1,
    });
  });

  it('노드 글(text)이 하나만 달라도 변경으로 분류', () => {
    const nodes = [rawNode({ id: 'root', parentId: null, text: '책 제목' })];
    const backup = backupOf({}, nodes);
    const changedNodes = [rawNode({ id: 'root', parentId: null, text: '바뀐 글' })];
    const current: Snapshot = {
      books: [currentBook()],
      mindmaps: [currentMap(changedNodes)],
    };
    const diff = diffBackup(backup, current);
    expect(diff.changed).toHaveLength(1);
  });

  it('파일에 없는 기존 책은 결과에 포함되지 않음', () => {
    const backup: Backup = { books: [], mindmaps: [] };
    const current: Snapshot = {
      books: [currentBook()],
      mindmaps: [currentMap([rawNode({ id: 'root', parentId: null, text: '책 제목' })])],
    };
    const diff = diffBackup(backup, current);
    expect(diff.added).toHaveLength(0);
    expect(diff.changed).toHaveLength(0);
    expect(diff.sameCount).toBe(0);
  });
});
