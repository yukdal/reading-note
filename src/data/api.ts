import { supabase } from '../lib/supabase';
import type { SaveFn, SaveResult } from '../features/mindmap/useAutosave';
import type { Book, BookInput, MindmapNode } from '../types';

export type { SaveFn, SaveResult };

// ---------------------------------------------------------------------
// 오류 분류 (순수 함수) - supabase-js 가 던지거나 돌려주는 오류를
// 화면에서 다룰 수 있는 종류로 정규화한다. network/auth 는 HTTP 레벨,
// forbidden/validation/not_found 는 RPC 함수가 던지는 Postgres 오류 코드.
// ---------------------------------------------------------------------

export type ApiErrorKind = 'network' | 'auth' | 'forbidden' | 'not_found' | 'validation' | 'unknown';

export interface ApiError {
  kind: ApiErrorKind;
  message: string;
}

const KOREAN_MESSAGE: Record<ApiErrorKind, string> = {
  network: '인터넷 연결을 확인하고 다시 시도해 주세요.',
  auth: '로그인이 만료되었습니다. 다시 로그인해 주세요.',
  forbidden: '이 작업을 수행할 권한이 없습니다.',
  not_found: '대상을 찾을 수 없습니다.',
  validation: '입력값을 확인해 주세요.',
  unknown: '알 수 없는 오류가 발생했습니다.',
};

/** supabase-js 가 던지거나(error 필드로) 돌려주는 값을 받아 종류를 가린다. 순수 함수. */
export function classifyError(err: unknown): ApiError {
  if (err instanceof TypeError) {
    // 브라우저 fetch가 네트워크 문제로 reject할 때의 전형적인 형태.
    return { kind: 'network', message: KOREAN_MESSAGE.network };
  }
  if (err instanceof DOMException && err.name === 'AbortError') {
    return { kind: 'network', message: KOREAN_MESSAGE.network };
  }

  const obj = (err ?? {}) as { code?: string; status?: number; name?: string; message?: string };

  if (
    obj.status === 401 ||
    obj.name === 'AuthSessionMissingError' ||
    obj.name === 'AuthRetryableFetchError' ||
    obj.code === 'PGRST301'
  ) {
    return { kind: obj.name === 'AuthRetryableFetchError' ? 'network' : 'auth', message: KOREAN_MESSAGE.auth };
  }
  if (obj.code === '42501') return { kind: 'forbidden', message: KOREAN_MESSAGE.forbidden };
  if (obj.code === '22023' || obj.code === '23514') return { kind: 'validation', message: KOREAN_MESSAGE.validation };
  if (obj.code === 'P0002') return { kind: 'not_found', message: KOREAN_MESSAGE.not_found };
  if (
    obj.message &&
    /network|fetch|failed to fetch|internet/i.test(obj.message) &&
    !('code' in obj)
  ) {
    return { kind: 'network', message: KOREAN_MESSAGE.network };
  }

  return { kind: 'unknown', message: obj.message || KOREAN_MESSAGE.unknown };
}

function requireClient() {
  if (!supabase) throw new Error('Supabase가 설정되지 않았습니다.');
  return supabase;
}

// ---------------------------------------------------------------------
// 조회/쓰기 래퍼
// ---------------------------------------------------------------------

const LIST_PAGE_SIZE = 500;

/** shelf_order, created_at, id 순. 맵 데이터는 가져오지 않는다. 500개씩 끝까지 페이지 반복. */
export async function listBooks(): Promise<Book[]> {
  const client = requireClient();
  const all: Book[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await client
      .from('books')
      .select('*')
      .order('shelf_order', { ascending: true })
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + LIST_PAGE_SIZE - 1);
    if (error) throw error;
    const rows = (data ?? []) as Book[];
    all.push(...rows);
    if (rows.length < LIST_PAGE_SIZE) break;
    from += LIST_PAGE_SIZE;
  }
  return all;
}

export interface MindmapRecord {
  nodes: MindmapNode[];
  version: number;
  updated_at: string;
}

export async function getMindmap(bookId: string): Promise<MindmapRecord> {
  const client = requireClient();
  const { data, error } = await client
    .from('mindmaps')
    .select('data, version, updated_at')
    .eq('book_id', bookId)
    .single();
  if (error) throw error;
  const row = data as { data: { nodes: MindmapNode[] }; version: number; updated_at: string };
  return { nodes: row.data.nodes, version: row.version, updated_at: row.updated_at };
}

export interface CreateBookResult {
  book: Book;
  map_version: number;
}

/** 같은 p_id 로 재시도해도 안전(서버가 기존 행을 그대로 돌려줌). */
export async function createBook(id: string, input: BookInput): Promise<CreateBookResult> {
  const client = requireClient();
  const { data, error } = await client.rpc('create_book', { p_id: id, p_book: input });
  if (error) throw error;
  const result = data as { status: 'ok'; book: Book; map_version: number };
  return { book: result.book, map_version: result.map_version };
}

/** useAutosave의 SaveFn 시그니처((nodes, expectedVersion) => ...)에 맞춰 bookId로 묶어 준다. */
export function makeSaveMindmap(bookId: string): SaveFn {
  return async (nodes, expectedVersion) => {
    const client = requireClient();
    const { data, error } = await client.rpc('save_mindmap', {
      p_book_id: bookId,
      p_expected_version: expectedVersion,
      p_nodes: nodes,
    });
    if (error) throw error;
    return data as SaveResult;
  };
}

// map_version은 SQL에서 항상 채워진 정수로 돌려준다(mindmaps.version은 not null) - 두 상태 모두 number.
export type UpdateBookResult =
  | { status: 'ok'; book: Book; map_version: number }
  | { status: 'conflict'; book: Book; map_version: number };

/**
 * updated_at은 서버가 준 문자열을 그대로 넘겨야 한다(new Date()로 왕복하면 마이크로초가
 * 잘려 항상 충돌로 처리됨). 제목이 바뀌지 않아도 expectedMapVersion을 보냈으면 서버가 그 값도 비교한다.
 */
export async function updateBook(
  bookId: string,
  expectedUpdatedAt: string,
  input: BookInput,
  expectedMapVersion: number | null = null,
): Promise<UpdateBookResult> {
  const client = requireClient();
  const { data, error } = await client.rpc('update_book', {
    p_book_id: bookId,
    p_expected_updated_at: expectedUpdatedAt,
    p_book: input,
    p_expected_map_version: expectedMapVersion,
  });
  if (error) throw error;
  return data as UpdateBookResult;
}

export type DeleteBookResult = { status: 'ok' } | { status: 'conflict'; book: Book; map_version: number };

/** 대상이 이미 없으면(P0002) 예외 대신 성공(이미 삭제됨)으로 돌려준다. */
export async function deleteBook(
  bookId: string,
  expectedUpdatedAt: string,
  expectedMapVersion: number,
): Promise<DeleteBookResult> {
  const client = requireClient();
  const { data, error } = await client.rpc('delete_book', {
    p_book_id: bookId,
    p_expected_updated_at: expectedUpdatedAt,
    p_expected_map_version: expectedMapVersion,
  });
  if (error) {
    if (classifyError(error).kind === 'not_found') return { status: 'ok' };
    throw error;
  }
  return data as DeleteBookResult;
}
