import type { MindmapNode } from '../../types';
import type { CachedMap } from '../../lib/localCache';
import { sameNodeExtras } from './model';

export type ReconcileAction =
  | { kind: 'use_server' }
  | { kind: 'offer_recover' }
  | { kind: 'draft_matches_server' }
  | { kind: 'conflict' };

export interface LocalDraft {
  nodes: MindmapNode[];
  baseVersion: number;
}

export interface ServerMap {
  nodes: MindmapNode[];
  version: number;
}

export function sameNodes(a: MindmapNode[], b: MindmapNode[]): boolean {
  if (a.length !== b.length) return false;
  const byId = new Map(b.map((node) => [node.id, node]));
  return a.every((node) => {
    const other = byId.get(node.id);
    return other !== undefined && node.parentId === other.parentId && node.text === other.text
      && node.color === other.color && node.collapsed === other.collapsed && node.order === other.order
      && sameNodeExtras(node, other);
  });
}

/**
 * 마인드맵 편집기 진입 시 로컬 초안과 서버본을 대조해 다음 행동을 고른다. 순수 함수.
 * - 초안 없음 -> 서버본 사용
 * - 노드 내용이 서버와 같음 -> 버전과 관계없이 저장 완료로 보고 초안 정리
 * - 내용은 다르고 초안.baseVersion === 서버 version -> 복구 여부를 물음
 * - 그 외 -> 충돌
 */
export function reconcileDraft(draft: LocalDraft | null, server: ServerMap): ReconcileAction {
  if (!draft) return { kind: 'use_server' };
  if (sameNodes(draft.nodes, server.nodes)) return { kind: 'draft_matches_server' };
  if (draft.baseVersion === server.version) return { kind: 'offer_recover' };
  return { kind: 'conflict' };
}

/** 저장 완료 시에도 요청 이후 작성한 새 초안은 보존한다. */
export function acknowledgeSave(
  current: CachedMap,
  saved: NonNullable<CachedMap['saved']>,
  expectedVersion: number,
): CachedMap {
  if (current.saved && current.saved.version > saved.version) return current;
  let draft = current.draft;
  if (draft && sameNodes(draft.nodes, saved.nodes)) draft = null;
  else if (draft?.baseVersion === expectedVersion) draft = { ...draft, baseVersion: saved.version };
  return { saved, draft };
}