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
