import type { Book, MindmapNode } from '../types';
import { acknowledgeSave } from '../features/mindmap/draftReconcile';

export interface CachedMap {
  saved: { nodes: MindmapNode[]; version: number; updated_at: string } | null;
  draft: { nodes: MindmapNode[]; baseVersion: number; edited_at: string } | null;
}

export interface CachedBooks {
  books: Book[];
  cachedAt: string;
}

const DB_NAME = 'reading-note';
const DB_VERSION = 2;
const STORE = 'mindmaps';
const BOOKS_STORE = 'books';

function recordKey(userId: string, bookId: string): string {
  return `${userId}:${bookId}`;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      if (!db.objectStoreNames.contains(BOOKS_STORE)) db.createObjectStore(BOOKS_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('마인드맵 저장소를 열 수 없습니다.'));
  });
}

async function getRecord(userId: string, bookId: string): Promise<CachedMap> {
  const db = await openDb();
  try {
    return await new Promise<CachedMap>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(recordKey(userId, bookId));
      req.onsuccess = () => resolve((req.result as CachedMap | undefined) ?? { saved: null, draft: null });
      req.onerror = () => reject(req.error ?? new Error('마인드맵 캐시를 읽을 수 없습니다.'));
    });
  } finally {
    db.close();
  }
}

async function putRecord(userId: string, bookId: string, update: (current: CachedMap) => CachedMap): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      const key = recordKey(userId, bookId);
      const req = store.get(key);
      req.onsuccess = () => {
        store.put(update((req.result as CachedMap | undefined) ?? { saved: null, draft: null }), key);
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('마인드맵 캐시에 쓸 수 없습니다. 저장 공간을 확인해 주세요.'));
      tx.onabort = () => reject(tx.error ?? new Error('마인드맵 캐시 쓰기가 중단되었습니다.'));
    });
  } finally {
    db.close();
  }
}

export async function getCachedMap(userId: string, bookId: string): Promise<CachedMap> {
  return getRecord(userId, bookId);
}

export async function putSaved(userId: string, bookId: string, saved: CachedMap['saved']): Promise<void> {
  await putRecord(userId, bookId, (current) => ({ ...current, saved }));
}

export async function putDraft(userId: string, bookId: string, draft: CachedMap['draft']): Promise<void> {
  await putRecord(userId, bookId, (current) => ({ ...current, draft }));
}

export async function clearDraft(userId: string, bookId: string): Promise<void> {
  await putDraft(userId, bookId, null);
}

/** 해당 사용자의 모든 책 마인드맵 캐시와 책 목록 캐시를 지운다(로그아웃 시). */
export async function clearUser(userId: string): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([STORE, BOOKS_STORE], 'readwrite');
      const range = IDBKeyRange.bound(`${userId}:`, `${userId}:￿`);
      tx.objectStore(STORE).delete(range);
      tx.objectStore(BOOKS_STORE).delete(userId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('캐시 삭제에 실패했습니다.'));
      tx.onabort = () => reject(tx.error ?? new Error('캐시 삭제가 중단되었습니다.'));
    });
  } finally {
    db.close();
  }
}

/** 오프라인 읽기용 책 목록 캐시. 사용자별로 통째로 덮어쓴다. */
export async function putBooksCache(userId: string, books: Book[]): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(BOOKS_STORE, 'readwrite');
      const value: CachedBooks = { books, cachedAt: new Date().toISOString() };
      tx.objectStore(BOOKS_STORE).put(value, userId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('책 목록 캐시에 쓸 수 없습니다.'));
      tx.onabort = () => reject(tx.error ?? new Error('책 목록 캐시 쓰기가 중단되었습니다.'));
    });
  } finally {
    db.close();
  }
}

export async function getBooksCache(userId: string): Promise<CachedBooks | null> {
  const db = await openDb();
  try {
    return await new Promise<CachedBooks | null>((resolve, reject) => {
      const tx = db.transaction(BOOKS_STORE, 'readonly');
      const req = tx.objectStore(BOOKS_STORE).get(userId);
      req.onsuccess = () => resolve((req.result as CachedBooks | undefined) ?? null);
      req.onerror = () => reject(req.error ?? new Error('책 목록 캐시를 읽을 수 없습니다.'));
    });
  } finally {
    db.close();
  }
}

export interface LocalLibrary {
  books: Book[];
  maps: Map<string, CachedMap>;
}

/** 책과 맵을 같은 트랜잭션에서 읽고 변경해 부분 적용과 미리보기 이후 덮어쓰기를 막는다. */
export async function editLocalLibrary<T>(
  userId: string,
  initialBooks: Book[],
  edit: (library: LocalLibrary) => T,
): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction([BOOKS_STORE, STORE], 'readwrite');
      const bookStore = tx.objectStore(BOOKS_STORE);
      const mapStore = tx.objectStore(STORE);
      const range = IDBKeyRange.bound(userId + ':', userId + ':￿');
      const booksReq = bookStore.get(userId);
      const keysReq = mapStore.getAllKeys(range);
      const mapsReq = mapStore.getAll(range);
      let remaining = 3;
      let result: T;
      let failure: unknown;
      function loaded() {
        remaining -= 1;
        if (remaining !== 0) return;
        try {
          const maps = new Map<string, CachedMap>(keysReq.result.map((key, i) => [
            String(key).slice(userId.length + 1), mapsReq.result[i] as CachedMap,
          ]));
          const library: LocalLibrary = {
            books: (booksReq.result as CachedBooks | undefined)?.books ?? initialBooks,
            maps,
          };
          result = edit(library);
          bookStore.put({ books: library.books, cachedAt: new Date().toISOString() }, userId);
          for (const key of keysReq.result) {
            if (!maps.has(String(key).slice(userId.length + 1))) mapStore.delete(key);
          }
          for (const [bookId, cached] of maps) mapStore.put(cached, recordKey(userId, bookId));
        } catch (err) {
          failure = err;
          tx.abort();
        }
      }
      booksReq.onsuccess = loaded;
      keysReq.onsuccess = loaded;
      mapsReq.onsuccess = loaded;
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(failure ?? tx.error ?? new Error('책장 저장에 실패했습니다.'));
      tx.onabort = () => reject(failure ?? tx.error ?? new Error('책장 저장이 취소되었습니다.'));
    });
  } finally {
    db.close();
  }
}
export async function commitSavedMap(
  userId: string,
  bookId: string,
  saved: NonNullable<CachedMap['saved']>,
  expectedVersion: number,
): Promise<void> {
  await putRecord(userId, bookId, (current) => acknowledgeSave(current, saved, expectedVersion));
}

/** 저장되지 않은 초안이 남아 있는 책 id 목록. */
export async function listDraftBookIds(userId: string): Promise<string[]> {
  const db = await openDb();
  try {
    return await new Promise<string[]>((resolve, reject) => {
      const range = IDBKeyRange.bound(`${userId}:`, `${userId}:￿`);
      const store = db.transaction(STORE, 'readonly').objectStore(STORE);
      const keysReq = store.getAllKeys(range);
      const valsReq = store.getAll(range);
      let remaining = 2;
      const done = () => {
        if (--remaining !== 0) return;
        resolve(keysReq.result
          .filter((_, i) => (valsReq.result[i] as CachedMap | undefined)?.draft)
          .map((key) => String(key).slice(userId.length + 1)));
      };
      keysReq.onsuccess = done;
      valsReq.onsuccess = done;
      keysReq.onerror = () => reject(keysReq.error ?? new Error('초안 목록을 읽을 수 없습니다.'));
      valsReq.onerror = () => reject(valsReq.error ?? new Error('초안 목록을 읽을 수 없습니다.'));
    });
  } finally {
    db.close();
  }
}
