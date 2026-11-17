export type BookStatus = 'want' | 'reading' | 'done';

export type EditorMode = 'map' | 'outline';

export interface Book {
  id: string; // uuid, crypto.randomUUID()
  user_id: string;
  title: string;
  author: string | null;
  status: BookStatus;
  rating: number | null; // 1~5 정수
  spine_color: string; // #RRGGBB
  page_count: number | null; // 양의 정수
  cover_url: string | null; // https URL
  tags: string[];
  shelf_order: number;
  started_on: string | null; // YYYY-MM-DD
  finished_on: string | null;
  created_at: string; // 서버 문자열 그대로
  updated_at: string;
}

export type BookInput = Pick<
  Book,
  | 'title'
  | 'author'
  | 'status'
  | 'rating'
  | 'spine_color'
  | 'page_count'
  | 'cover_url'
  | 'tags'
  | 'started_on'
  | 'finished_on'
>;

export interface MindmapNode {
  id: string;
  parentId: string | null;
  text: string;
  color: string;
  collapsed: boolean;
  order: number;
  /** 항목 메모(글자만, 최대 2000자). 비어 있으면 키 자체를 두지 않는다. */
  note?: string;
  /** 글씨색 #RRGGBB(정해진 색 중 하나). 기본색이면 키 자체를 두지 않는다. */
  textColor?: string;
}

export interface MindmapData {
  nodes: MindmapNode[];
}

export interface Mindmap {
  book_id: string;
  user_id: string;
  data: MindmapData;
  version: number;
  updated_at: string;
}
