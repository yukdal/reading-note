import { supabase } from '../../lib/supabase';
import { validateNodes } from '../mindmap/model';
import type { Book, BookStatus, Mindmap, MindmapNode } from '../../types';

// ponytail: 임의의 20MB 상한. 실제 Supabase/PostgREST 요청 크기 한도는 배포 시 확인 필요.
export const MAX_BACKUP_FILE_BYTES = 20 * 1024 * 1024;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX_COLOR_RE = /^#[0-9A-Fa-f]{6}$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const STATUSES: BookStatus[] = ['want', 'reading', 'done'];

function requireClient() {
  if (!supabase) throw new Error('Supabase가 설정되지 않았습니다.');
  return supabase;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isValidDateString(value: string): boolean {
  const m = DATE_RE.exec(value);
  if (!m) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

// ---------------------------------------------------------------------
// 타입
// 파일 형식(앱 내보내기와 Drive 백업 공통):
//   { books: [...books 행...], mindmaps: [{book_id, user_id, data:{nodes:[...]}, version, updated_at}, ...] }
// 파일 안의 user_id/created_at/updated_at/version/shelf_order 는 서버 관리 값이라 신뢰하지 않고,
// 있어도 무시한다(복원 대상은 항상 로그인 사용자, 토큰은 현재 DB 값으로만 비교).
// ---------------------------------------------------------------------

export interface BackupBook {
  id: string;
  title: string;
  author: string | null;
  status: BookStatus;
  rating: number | null;
  spine_color: string;
  page_count: number | null;
  cover_url: string | null;
  tags: string[];
  started_on: string | null;
  finished_on: string | null;
  user_id?: string;
  created_at?: string;
  updated_at?: string;
  shelf_order?: number;
}

export interface BackupMindmap {
  book_id: string;
  data: { nodes: MindmapNode[] };
  user_id?: string;
  version?: number;
  updated_at?: string;
}

export interface Backup {
  books: BackupBook[];
  mindmaps: BackupMindmap[];
}

/** export_snapshot()이 돌려주는 완전한 행. 서버 관리 값이 항상 채워져 있다. */
export interface Snapshot {
  books: Book[];
  mindmaps: Mindmap[];
}

// ---------------------------------------------------------------------
// 1) fetchSnapshot - 한 RPC 호출로 책+맵을 한 시점에 읽는다.
// ---------------------------------------------------------------------

export async function fetchSnapshot(): Promise<Snapshot> {
  const client = requireClient();
  const { data, error } = await client.rpc('export_snapshot');
  if (error) throw error;
  return data as Snapshot;
}

// ---------------------------------------------------------------------
// 2) parseBackupFile - 순수 함수. 신뢰할 수 없는 파일을 검증한다.
// ---------------------------------------------------------------------

function validateBookFields(
  raw: unknown,
  index: number,
): { ok: true; book: BackupBook } | { ok: false; error: string } {
  const titleHint = isPlainObject(raw) && typeof raw.title === 'string' && raw.title.trim() !== '' ? `(${raw.title.trim()})` : '';
  const label = `${index + 1}번째 책${titleHint}`;

  if (!isPlainObject(raw)) {
    return { ok: false, error: `${label} - 책 정보는 JSON 객체여야 합니다.` };
  }
  const b = raw;

  if (typeof b.id !== 'string' || !UUID_RE.test(b.id)) {
    return { ok: false, error: `${label} - id는 uuid 형식의 문자열이어야 합니다.` };
  }
  if (typeof b.title !== 'string' || b.title.trim() === '') {
    return { ok: false, error: `${label} - 제목은 비어 있을 수 없습니다.` };
  }
  if (!(b.author === undefined || b.author === null || typeof b.author === 'string')) {
    return { ok: false, error: `${label} - 저자는 문자열 또는 null이어야 합니다.` };
  }
  if (!STATUSES.includes(b.status as BookStatus)) {
    return { ok: false, error: `${label} - status는 want/reading/done 중 하나여야 합니다.` };
  }
  if (
    !(
      b.rating === null ||
      b.rating === undefined ||
      (typeof b.rating === 'number' && Number.isInteger(b.rating) && b.rating >= 1 && b.rating <= 5)
    )
  ) {
    return { ok: false, error: `${label} - 별점은 null 또는 1~5 사이의 정수여야 합니다.` };
  }
  if (
    !(
      b.page_count === null ||
      b.page_count === undefined ||
      (typeof b.page_count === 'number' && Number.isInteger(b.page_count) && b.page_count > 0)
    )
  ) {
    return { ok: false, error: `${label} - 쪽수는 null 또는 1 이상의 정수여야 합니다.` };
  }
  if (typeof b.spine_color !== 'string' || !HEX_COLOR_RE.test(b.spine_color)) {
    return { ok: false, error: `${label} - 책등 색상은 #RRGGBB 형식이어야 합니다.` };
  }
  if (
    !(
      b.cover_url === null ||
      b.cover_url === undefined ||
      (typeof b.cover_url === 'string' && b.cover_url.startsWith('https://'))
    )
  ) {
    return { ok: false, error: `${label} - 표지 URL은 null 또는 https 주소여야 합니다.` };
  }
  if (!Array.isArray(b.tags) || !b.tags.every((t) => typeof t === 'string')) {
    return { ok: false, error: `${label} - tags는 문자열 배열이어야 합니다.` };
  }
  if (
    !(
      b.started_on === null ||
      b.started_on === undefined ||
      (typeof b.started_on === 'string' && isValidDateString(b.started_on))
    )
  ) {
    return { ok: false, error: `${label} - 읽기 시작일 형식이 올바르지 않습니다.` };
  }
  if (
    !(
      b.finished_on === null ||
      b.finished_on === undefined ||
      (typeof b.finished_on === 'string' && isValidDateString(b.finished_on))
    )
  ) {
    return { ok: false, error: `${label} - 읽기 완료일 형식이 올바르지 않습니다.` };
  }
  const started = (b.started_on as string | null | undefined) ?? null;
  const finished = (b.finished_on as string | null | undefined) ?? null;
  if (started && finished && started > finished) {
    return { ok: false, error: `${label} - 읽기 완료일은 시작일보다 빠를 수 없습니다.` };
  }

  return {
    ok: true,
    book: {
      id: b.id,
      title: b.title.trim(),
      author: (b.author as string | null | undefined) ?? null,
      status: b.status as BookStatus,
      rating: (b.rating as number | null | undefined) ?? null,
      spine_color: b.spine_color,
      page_count: (b.page_count as number | null | undefined) ?? null,
      cover_url: (b.cover_url as string | null | undefined) ?? null,
      tags: b.tags as string[],
      started_on: started,
      finished_on: finished,
      user_id: typeof b.user_id === 'string' ? b.user_id : undefined,
      created_at: typeof b.created_at === 'string' ? b.created_at : undefined,
      updated_at: typeof b.updated_at === 'string' ? b.updated_at : undefined,
      shelf_order: typeof b.shelf_order === 'number' ? b.shelf_order : undefined,
    },
  };
}

function validateMapFields(
  raw: unknown,
  index: number,
): { ok: true; map: BackupMindmap } | { ok: false; error: string } {
  const label = `${index + 1}번째 맵`;
  if (!isPlainObject(raw)) {
    return { ok: false, error: `${label} - 맵 정보는 JSON 객체여야 합니다.` };
  }
  const m = raw;
  if (typeof m.book_id !== 'string' || !UUID_RE.test(m.book_id)) {
    return { ok: false, error: `${label} - book_id는 uuid 형식의 문자열이어야 합니다.` };
  }
  const data = m.data;
  if (!isPlainObject(data) || !Array.isArray(data.nodes)) {
    return { ok: false, error: `${label}(${m.book_id}) - data.nodes 배열이 필요합니다.` };
  }
  return {
    ok: true,
    map: {
      book_id: m.book_id,
      data: { nodes: data.nodes as MindmapNode[] },
      user_id: typeof m.user_id === 'string' ? m.user_id : undefined,
      version: typeof m.version === 'number' ? m.version : undefined,
      updated_at: typeof m.updated_at === 'string' ? m.updated_at : undefined,
    },
  };
}

/** validateNodes는 각 필드 타입이 이미 맞다고 가정하므로, 그 전에 노드 하나하나의 형식을 먼저 본다. */
function validateNodeShapes(nodes: unknown[], mapLabel: string): string | null {
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (!isPlainObject(n)) return `${mapLabel} - ${i + 1}번째 노드가 JSON 객체가 아닙니다.`;
    for (const key of ['id', 'parentId', 'text', 'color', 'collapsed', 'order'] as const) {
      if (!(key in n)) return `${mapLabel} - ${i + 1}번째 노드에 ${key} 값이 없습니다.`;
    }
    if (typeof n.id !== 'string' || n.id.trim() === '') {
      return `${mapLabel} - ${i + 1}번째 노드의 id는 비어 있지 않은 문자열이어야 합니다.`;
    }
    if (!(n.parentId === null || (typeof n.parentId === 'string' && n.parentId.trim() !== ''))) {
      return `${mapLabel} - ${i + 1}번째 노드의 parentId는 null 또는 비어 있지 않은 문자열이어야 합니다.`;
    }
    if (typeof n.text !== 'string') return `${mapLabel} - ${i + 1}번째 노드의 text가 문자열이 아닙니다.`;
    if (typeof n.color !== 'string' || !HEX_COLOR_RE.test(n.color)) {
      return `${mapLabel} - ${i + 1}번째 노드의 color가 #RRGGBB 형식이 아닙니다.`;
    }
    if (typeof n.collapsed !== 'boolean') {
      return `${mapLabel} - ${i + 1}번째 노드의 collapsed가 true/false가 아닙니다.`;
    }
    if (typeof n.order !== 'number' || !Number.isInteger(n.order) || n.order < 0) {
      return `${mapLabel} - ${i + 1}번째 노드의 order가 0 이상의 정수가 아닙니다.`;
    }
  }
  return null;
}

export type ParseResult = { ok: true; backup: Backup } | { ok: false; error: string };

/**
 * 신뢰할 수 없는 백업 파일을 검증한다. 검증 순서:
 * 책 필드 -> 맵 필드 -> 책 id 중복 -> 맵 book_id 중복 -> 책 없는 맵 / 맵 없는 책
 * -> 맵 nodes(validateNodes + 중심 노드 text == 책 제목) -> 소유자(user_id) 모순.
 */
export function parseBackupFile(text: string): ParseResult {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, error: '파일이 올바른 JSON 형식이 아닙니다.' };
  }
  if (!isPlainObject(json) || !Array.isArray(json.books) || !Array.isArray(json.mindmaps)) {
    return { ok: false, error: '백업 파일 형식이 올바르지 않습니다. 최상위에 books, mindmaps 배열이 필요합니다.' };
  }
  const rawBooks: unknown[] = json.books;
  const rawMaps: unknown[] = json.mindmaps;

  const books: BackupBook[] = [];
  for (let i = 0; i < rawBooks.length; i++) {
    const r = validateBookFields(rawBooks[i], i);
    if (!r.ok) return { ok: false, error: r.error };
    books.push(r.book);
  }

  const maps: BackupMindmap[] = [];
  for (let i = 0; i < rawMaps.length; i++) {
    const r = validateMapFields(rawMaps[i], i);
    if (!r.ok) return { ok: false, error: r.error };
    maps.push(r.map);
  }

  const idCounts = new Map<string, number>();
  for (const b of books) idCounts.set(b.id, (idCounts.get(b.id) ?? 0) + 1);
  const dupBookId = [...idCounts.entries()].find(([, c]) => c > 1)?.[0];
  if (dupBookId) return { ok: false, error: `책 id가 중복되었습니다: ${dupBookId}` };

  const mapCounts = new Map<string, number>();
  for (const m of maps) mapCounts.set(m.book_id, (mapCounts.get(m.book_id) ?? 0) + 1);
  const dupMapId = [...mapCounts.entries()].find(([, c]) => c > 1)?.[0];
  if (dupMapId) return { ok: false, error: `같은 책의 맵이 중복되었습니다: ${dupMapId}` };

  const bookIds = new Set(books.map((b) => b.id));
  const orphanMap = maps.find((m) => !bookIds.has(m.book_id));
  if (orphanMap) return { ok: false, error: `책이 없는 맵이 있습니다: ${orphanMap.book_id}` };

  const missingMapBook = books.find((b) => !mapCounts.has(b.id));
  if (missingMapBook) return { ok: false, error: `맵이 없는 책이 있습니다: ${missingMapBook.title}` };

  const mapByBookId = new Map(maps.map((m) => [m.book_id, m] as const));
  for (const book of books) {
    const map = mapByBookId.get(book.id) as BackupMindmap;
    const nodesRaw = map.data.nodes as unknown[];
    const shapeError = validateNodeShapes(nodesRaw, `「${book.title}」의 맵`);
    if (shapeError) return { ok: false, error: shapeError };

    const nodes = nodesRaw as MindmapNode[];
    const result = validateNodes(nodes);
    if (!result.ok) return { ok: false, error: `「${book.title}」의 맵 - ${result.error}` };

    const center = nodes.find((n) => n.parentId === null) as MindmapNode;
    if (center.text.trim() !== book.title.trim()) {
      return { ok: false, error: `「${book.title}」의 맵 - 중심 노드의 text가 책 제목과 다릅니다.` };
    }
  }

  const ownerIds = new Set<string>();
  for (const b of books) if (b.user_id) ownerIds.add(b.user_id);
  for (const m of maps) if (m.user_id) ownerIds.add(m.user_id);
  if (ownerIds.size > 1) {
    return { ok: false, error: '파일에 서로 다른 user_id가 섞여 있습니다 (소유자 모순).' };
  }

  return { ok: true, backup: { books, mindmaps: maps } };
}

// ---------------------------------------------------------------------
// 3) diffBackup - 순수 함수. 서버 관리 값은 비교에서 뺀다.
// ---------------------------------------------------------------------

interface ComparableBook {
  title: string;
  author: string | null;
  status: BookStatus;
  rating: number | null;
  spine_color: string;
  page_count: number | null;
  cover_url: string | null;
  tags: string[];
  started_on: string | null;
  finished_on: string | null;
}

function sameBookContent(a: ComparableBook, b: ComparableBook): boolean {
  return (
    a.title === b.title &&
    a.author === b.author &&
    a.status === b.status &&
    a.rating === b.rating &&
    a.spine_color === b.spine_color &&
    a.page_count === b.page_count &&
    a.cover_url === b.cover_url &&
    a.tags.length === b.tags.length &&
    a.tags.every((t, i) => t === b.tags[i]) &&
    a.started_on === b.started_on &&
    a.finished_on === b.finished_on
  );
}

function sortedForCompare(nodes: MindmapNode[]): MindmapNode[] {
  return [...nodes].sort((x, y) => x.order - y.order || x.id.localeCompare(y.id));
}

function sameNodes(a: MindmapNode[], b: MindmapNode[]): boolean {
  if (a.length !== b.length) return false;
  const sa = sortedForCompare(a);
  const sb = sortedForCompare(b);
  return sa.every((n, i) => {
    const m = sb[i];
    return (
      n.id === m.id &&
      n.parentId === m.parentId &&
      n.text === m.text &&
      n.color === m.color &&
      n.collapsed === m.collapsed &&
      n.order === m.order
    );
  });
}

/** added/changed 항목은 그대로 import_backup에 보낼 수 있는 책 데이터(book)와 맵 nodes를 담는다. */
export interface DiffItem {
  book_id: string;
  title: string;
  book: BackupBook;
  nodes: MindmapNode[];
  expected?: { book_id: string; updated_at: string; map_version: number };
}

export interface DiffResult {
  added: DiffItem[];
  changed: DiffItem[];
  sameCount: number;
}

/** backup은 parseBackupFile의 결과, current는 fetchSnapshot()의 결과. 파일에 없는 기존 책은 결과에 포함하지 않는다. */
export function diffBackup(backup: Backup, current: Snapshot): DiffResult {
  const currentBookById = new Map(current.books.map((b) => [b.id, b] as const));
  const currentMapByBookId = new Map(current.mindmaps.map((m) => [m.book_id, m] as const));
  const fileMapByBookId = new Map(backup.mindmaps.map((m) => [m.book_id, m] as const));

  const added: DiffItem[] = [];
  const changed: DiffItem[] = [];
  let sameCount = 0;

  for (const book of backup.books) {
    const fileMap = fileMapByBookId.get(book.id);
    const nodes = fileMap?.data.nodes ?? [];
    const curBook = currentBookById.get(book.id);
    const curMap = currentMapByBookId.get(book.id);

    if (!curBook || !curMap) {
      added.push({ book_id: book.id, title: book.title, book, nodes });
      continue;
    }

    const same = sameBookContent(book, curBook) && sameNodes(nodes, curMap.data.nodes);
    if (same) {
      sameCount += 1;
    } else {
      changed.push({
        book_id: book.id,
        title: book.title,
        book,
        nodes,
        expected: { book_id: book.id, updated_at: curBook.updated_at, map_version: curMap.version },
      });
    }
  }

  return { added, changed, sameCount };
}

// ---------------------------------------------------------------------
// 4) applyImport
// ---------------------------------------------------------------------

export type ImportResult = { status: 'ok'; added: number; changed: number } | { status: 'conflict'; book_ids: string[] };

export async function applyImport(diff: DiffResult): Promise<ImportResult> {
  const targets = [...diff.added, ...diff.changed];
  if (targets.length === 0) {
    return { status: 'ok', added: 0, changed: 0 };
  }

  const client = requireClient();
  const p_books = targets.map((t) => t.book);
  const p_mindmaps = targets.map((t) => ({ book_id: t.book_id, data: { nodes: t.nodes } }));
  const p_expected = diff.changed
    .map((t) => t.expected)
    .filter((e): e is NonNullable<typeof e> => e != null);

  const { data, error } = await client.rpc('import_backup', { p_books, p_mindmaps, p_expected });
  if (error) throw error;
  return data as ImportResult;
}

// ---------------------------------------------------------------------
// 5) downloadJson
// ---------------------------------------------------------------------

export function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** YYYY-MM-DD-reading-note-backup.json (로컬 날짜) */
export function exportFileName(now: Date = new Date()): string {
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}-reading-note-backup.json`;
}
