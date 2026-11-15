import { describe, expect, it } from 'vitest';
import { reconcileDraft, acknowledgeSave } from './draftReconcile';
import type { MindmapNode } from '../../types';

function node(id: string, text: string): MindmapNode {
  return { id, parentId: null, text, color: '#111111', collapsed: false, order: 0 };
}

describe('reconcileDraft', () => {
  it('초안이 없으면 서버본 사용', () => {
    expect(reconcileDraft(null, { nodes: [node('a', 'x')], version: 3 })).toEqual({ kind: 'use_server' });
  });

  it('초안의 baseVersion이 서버 version과 같으면 복구를 물어야 함', () => {
    const draft = { nodes: [node('a', '편집중')], baseVersion: 3 };
    expect(reconcileDraft(draft, { nodes: [node('a', '서버')], version: 3 })).toEqual({ kind: 'offer_recover' });
  });

  it('버전이 다르지만 노드 내용이 서버와 같으면(응답 유실) 초안 정리', () => {
    const nodes = [node('a', '제목')];
    const draft = { nodes, baseVersion: 3 };
    expect(reconcileDraft(draft, { nodes: [...nodes], version: 4 })).toEqual({ kind: 'draft_matches_server' });
  });

  it('노드 순서만 다르면 같은 내용으로 본다', () => {
    const draft = { nodes: [node('b', '2'), node('a', '1')], baseVersion: 3 };
    const server = { nodes: [node('a', '1'), node('b', '2')], version: 4 };
    expect(reconcileDraft(draft, server)).toEqual({ kind: 'draft_matches_server' });
  });

  it('버전도 다르고 내용도 다르면 충돌', () => {
    const draft = { nodes: [node('a', '내 편집')], baseVersion: 3 };
    const server = { nodes: [node('a', '다른 기기 편집')], version: 4 };
    expect(reconcileDraft(draft, server)).toEqual({ kind: 'conflict' });
  });
});

describe('실제 서버의 JSON과 저장 완료 대조', () => {
  it('Postgres가 JSON 필드 순서를 바꿔도 같은 노드로 본다', () => {
    const original = node('a', '제목');
    const reordered = { order: original.order, text: original.text, id: original.id,
      collapsed: original.collapsed, color: original.color, parentId: original.parentId };
    expect(reconcileDraft({ nodes: [original], baseVersion: 3 },
      { nodes: [reordered], version: 4 })).toEqual({ kind: 'draft_matches_server' });
  });

  it('버전과 내용이 모두 같으면 복구를 묻지 않는다', () => {
    const nodes = [node('a', '제목')];
    expect(reconcileDraft({ nodes, baseVersion: 3 }, { nodes, version: 3 }))
      .toEqual({ kind: 'draft_matches_server' });
  });

  it('저장한 초안은 지우고 확정 저장본을 갱신한다', () => {
    const nodes = [node('a', '완료')];
    const saved = { nodes, version: 4, updated_at: 'now' };
    expect(acknowledgeSave({ saved: null, draft: { nodes, baseVersion: 3, edited_at: 'before' } }, saved, 3))
      .toEqual({ saved, draft: null });
  });

  it('저장 중 생긴 새 편집은 다음 기준 버전과 함께 유지한다', () => {
    const draft = { nodes: [node('a', '계속 작성')], baseVersion: 3, edited_at: 'later' };
    const saved = { nodes: [node('a', '먼저 저장')], version: 4, updated_at: 'now' };
    expect(acknowledgeSave({ saved: null, draft }, saved, 3))
      .toEqual({ saved, draft: { ...draft, baseVersion: 4 } });
  });

  it('늦게 도착한 옛 응답으로 최신 저장본을 되돌리지 않는다', () => {
    const current = { saved: { nodes: [node('a', '최신')], version: 5, updated_at: 'later' }, draft: null };
    expect(acknowledgeSave(current, { nodes: [node('a', '이전')], version: 4, updated_at: 'old' }, 3))
      .toBe(current);
  });
});