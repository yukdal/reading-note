import type { Book, BookInput, MindmapNode } from '../types';
import { editLocalLibrary, type LocalLibrary } from '../lib/localCache';
import { createInitialNodes, setRootText } from '../features/mindmap/model';
import type { DiffResult, ImportResult, Snapshot } from '../features/backup/backup';
import { xmindExampleBook, xmindExampleNodes } from './xmindExample';

export const DEMO_USER_ID = 'demo';

function snapshotOf(library: LocalLibrary): Snapshot {
  const mindmaps = library.books.map((book) => {
    let cached = library.maps.get(book.id);
    if (!cached?.saved) {
      const nodes = book.id === xmindExampleBook.id
        ? setRootText(xmindExampleNodes, book.title)
        : createInitialNodes(book.title, book.spine_color);
      cached = { saved: { nodes, version: 0, updated_at: book.updated_at }, draft: cached?.draft ?? null };
      library.maps.set(book.id, cached);
    }
    const saved = cached.saved!;
    return { book_id: book.id, user_id: DEMO_USER_ID, data: { nodes: saved.nodes },
      version: saved.version, updated_at: saved.updated_at };
  });
  return { books: library.books, mindmaps };
}

export function loadDemoBooks(initialBooks: Book[]): Promise<Book[]> {
  return editLocalLibrary(DEMO_USER_ID, initialBooks, (library) => library.books);
}

export function fetchDemoSnapshot(initialBooks: Book[]): Promise<Snapshot> {
  return editLocalLibrary(DEMO_USER_ID, initialBooks, (library) => {
    if (library.books.some((book) => library.maps.get(book.id)?.draft)) {
      throw new Error('저장되지 않은 마인드맵 초안이 있습니다. 해당 책에서 저장을 마친 뒤 가져와 주세요.');
    }
    return snapshotOf(library);
  });
}

export function mergeLocalImport(current: Snapshot, diff: DiffResult, now: string):
  { status: 'ok'; snapshot: Snapshot } | { status: 'conflict'; book_ids: string[] } {
  const conflicts = diff.added.filter((item) => current.books.some((book) => book.id === item.book_id))
    .map((item) => item.book_id);
  for (const item of diff.changed) {
    const book = current.books.find((b) => b.id === item.book_id);
    const map = current.mindmaps.find((m) => m.book_id === item.book_id);
    if (!item.expected || book?.updated_at !== item.expected.updated_at || map?.version !== item.expected.map_version) {
      conflicts.push(item.book_id);
    }
  }
  if (conflicts.length) return { status: 'conflict', book_ids: conflicts };
  const books = [...current.books];
  const mindmaps = [...current.mindmaps];
  let nextOrder = Math.max(-1, ...books.map((book) => book.shelf_order)) + 1;
  for (const item of [...diff.added, ...diff.changed]) {
    const index = books.findIndex((book) => book.id === item.book_id);
    const existing = books[index];
    const file = item.book;
    const book: Book = {
      id: item.book_id, user_id: DEMO_USER_ID, title: file.title, author: file.author,
      status: file.status, rating: file.rating, spine_color: file.spine_color,
      page_count: file.page_count, cover_url: file.cover_url, tags: file.tags,
      started_on: file.started_on, finished_on: file.finished_on,
      shelf_order: existing?.shelf_order ?? nextOrder++,
      created_at: existing?.created_at ?? now, updated_at: now,
    };
    if (index < 0) books.push(book);
    else books[index] = book;
    const mapIndex = mindmaps.findIndex((map) => map.book_id === item.book_id);
    const map = { book_id: item.book_id, user_id: DEMO_USER_ID, data: { nodes: item.nodes },
      version: (mindmaps[mapIndex]?.version ?? 0) + 1, updated_at: now };
    if (mapIndex < 0) mindmaps.push(map);
    else mindmaps[mapIndex] = map;
  }
  return { status: 'ok', snapshot: { books, mindmaps } };
}

export function applyDemoImport(initialBooks: Book[], diff: DiffResult): Promise<ImportResult> {
  return editLocalLibrary(DEMO_USER_ID, initialBooks, (library) => {
    if (library.books.some((book) => library.maps.get(book.id)?.draft)) {
      throw new Error('미저장 초안이 있어 가져오기를 중단했습니다. 초안을 먼저 저장해 주세요.');
    }
    const result = mergeLocalImport(snapshotOf(library), diff, new Date().toISOString());
    if (result.status === 'conflict') return result;
    library.books = result.snapshot.books;
    for (const item of [...diff.added, ...diff.changed]) {
      const map = result.snapshot.mindmaps.find((m) => m.book_id === item.book_id)!;
      library.maps.set(item.book_id, { saved: { nodes: map.data.nodes, version: map.version, updated_at: map.updated_at }, draft: null });
    }
    return { status: 'ok', added: diff.added.length, changed: diff.changed.length };
  });
}

export function saveDemoBook(initialBooks: Book[], id: string, input: BookInput, expected: string | null): Promise<Book[]> {
  return editLocalLibrary(DEMO_USER_ID, initialBooks, (library) => {
    const existing = library.books.find((book) => book.id === id);
    if (expected !== null && existing?.updated_at !== expected) {
      throw new Error('책이 다른 창에서 바뀌었습니다. 새로고침 후 다시 수정해 주세요.');
    }
    if (expected === null && existing) throw new Error('같은 책이 이미 있습니다.');
    const now = new Date().toISOString();
    const book: Book = { ...input, id, user_id: DEMO_USER_ID,
      shelf_order: existing?.shelf_order ?? Math.max(-1, ...library.books.map((b) => b.shelf_order)) + 1,
      created_at: existing?.created_at ?? now, updated_at: now };
    library.books = existing ? library.books.map((b) => b.id === id ? book : b) : [...library.books, book];
    const cached = library.maps.get(id);
    if (cached && existing?.title !== input.title) {
      if (cached.draft) throw new Error('마인드맵 초안을 먼저 저장한 뒤 제목을 변경해 주세요.');
      if (cached.saved) library.maps.set(id, { ...cached, saved: { ...cached.saved,
        nodes: setRootText(cached.saved.nodes, input.title), version: cached.saved.version + 1, updated_at: now } });
    }
    return library.books;
  });
}

export function deleteDemoBook(initialBooks: Book[], book: Book): Promise<Book[]> {
  return editLocalLibrary(DEMO_USER_ID, initialBooks, (library) => {
    if (library.books.find((b) => b.id === book.id)?.updated_at !== book.updated_at) {
      throw new Error('책이 다른 창에서 바뀌었습니다. 새로고침 후 다시 삭제해 주세요.');
    }
    library.books = library.books.filter((b) => b.id !== book.id);
    library.maps.delete(book.id);
    return library.books;
  });
}

export function saveDemoMap(initialBooks: Book[], bookId: string, nodes: MindmapNode[], expectedVersion: number) {
  return editLocalLibrary(DEMO_USER_ID, initialBooks, (library) => {
    if (!library.books.some((book) => book.id === bookId)) throw new Error('책이 삭제되었습니다.');
    const cached = library.maps.get(bookId);
    const version = cached?.saved?.version ?? 0;
    const updated_at = new Date().toISOString();
    if (version !== expectedVersion) return { status: 'conflict' as const, version, updated_at };
    const draft = cached?.draft && JSON.stringify(cached.draft.nodes) !== JSON.stringify(nodes)
      ? { ...cached.draft, baseVersion: version + 1 } : null;
    library.maps.set(bookId, { saved: { nodes, version: version + 1, updated_at }, draft });
    return { status: 'ok' as const, version: version + 1, updated_at };
  });
}