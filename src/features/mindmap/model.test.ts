import { describe, expect, it } from 'vitest';
import type { MindmapNode } from '../../types';
import {
  addChild,
  addSibling,
  countDescendants,
  createInitialNodes,
  deleteBranch,
  needsDeleteConfirm,
  normalizeOrder,
  MAX_NOTE_LENGTH,
  resolveSelectedId,
  setColor,
  setNote,
  setRootText,
  setText,
  setTextColor,
  TEXT_COLORS,
  toggleCollapsed,
  validateNodes,
} from './model';

function node(partial: Partial<MindmapNode> & Pick<MindmapNode, 'id' | 'parentId'>): MindmapNode {
  return {
    text: '',
    color: '#111111',
    collapsed: false,
    order: 0,
    ...partial,
  };
}

function tree(): MindmapNode[] {
  return [
    node({ id: 'root', parentId: null, text: '책 제목', order: 0 }),
    node({ id: 'a', parentId: 'root', text: 'A', order: 0 }),
    node({ id: 'b', parentId: 'root', text: 'B', order: 1 }),
    node({ id: 'a1', parentId: 'a', text: 'A1', order: 0 }),
  ];
}

describe('validateNodes', () => {
  it('정상 트리는 통과', () => {
    expect(validateNodes(tree())).toEqual({ ok: true });
  });

  it('중심 노드가 없으면 거부', () => {
    const nodes = tree().map((n) => (n.id === 'root' ? { ...n, parentId: 'a' } : n));
    const r = validateNodes(nodes);
    expect(r.ok).toBe(false);
  });

  it('중심 노드가 2개면 거부', () => {
    const nodes = [...tree(), node({ id: 'root2', parentId: null, order: 0 })];
    const r = validateNodes(nodes);
    expect(r.ok).toBe(false);
  });

  it('id 중복 거부', () => {
    const nodes = tree();
    nodes.push(node({ id: 'a', parentId: 'root', order: 2 }));
    const r = validateNodes(nodes);
    expect(r.ok).toBe(false);
  });

  it('없는 부모 참조 거부', () => {
    const nodes = tree().map((n) => (n.id === 'a1' ? { ...n, parentId: 'nope' } : n));
    const r = validateNodes(nodes);
    expect(r.ok).toBe(false);
  });

  it('자기 참조 거부', () => {
    const nodes = tree().map((n) => (n.id === 'a' ? { ...n, parentId: 'a' } : n));
    const r = validateNodes(nodes);
    expect(r.ok).toBe(false);
  });

  it('순환 참조 거부', () => {
    const nodes = tree().map((n) => {
      if (n.id === 'a') return { ...n, parentId: 'a1' };
      return n;
    });
    const r = validateNodes(nodes);
    expect(r.ok).toBe(false);
  });

  it('잘못된 색상 형식 거부', () => {
    const nodes = tree().map((n) => (n.id === 'a' ? { ...n, color: 'red' } : n));
    const r = validateNodes(nodes);
    expect(r.ok).toBe(false);
  });

  it('형제 order가 연속되지 않으면 거부', () => {
    const nodes = tree().map((n) => (n.id === 'b' ? { ...n, order: 5 } : n));
    const r = validateNodes(nodes);
    expect(r.ok).toBe(false);
  });
});

describe('normalizeOrder', () => {
  it('형제 순서를 유지하며 0부터 연속되게 다시 매김', () => {
    const nodes = [
      node({ id: 'root', parentId: null, order: 0 }),
      node({ id: 'a', parentId: 'root', order: 7 }),
      node({ id: 'b', parentId: 'root', order: 3 }),
    ];
    const result = normalizeOrder(nodes);
    const a = result.find((n) => n.id === 'a')!;
    const b = result.find((n) => n.id === 'b')!;
    expect(b.order).toBe(0);
    expect(a.order).toBe(1);
  });
});

describe('createInitialNodes', () => {
  it('중심 노드 1개 생성', () => {
    const nodes = createInitialNodes('제목', '#aabbcc');
    expect(nodes).toHaveLength(1);
    expect(nodes[0].parentId).toBeNull();
    expect(nodes[0].text).toBe('제목');
    expect(nodes[0].color).toBe('#aabbcc');
    expect(validateNodes(nodes).ok).toBe(true);
  });
});

describe('addChild', () => {
  it('맨 끝에 빈 텍스트, 부모 색 상속으로 추가', () => {
    const nodes = addChild(tree(), 'root');
    expect(validateNodes(nodes).ok).toBe(true);
    const added = nodes.find((n) => n.parentId === 'root' && n.order === 2)!;
    expect(added.text).toBe('');
    expect(added.color).toBe(tree()[0].color);
  });

  it('부모가 접혀 있으면 펼침', () => {
    const base = tree().map((n) => (n.id === 'a' ? { ...n, collapsed: true } : n));
    const nodes = addChild(base, 'a');
    expect(nodes.find((n) => n.id === 'a')!.collapsed).toBe(false);
  });

  it('존재하지 않는 부모는 그대로 반환', () => {
    const base = tree();
    expect(addChild(base, 'nope')).toBe(base);
  });
});

describe('addSibling', () => {
  it('바로 다음 순서에 추가', () => {
    const nodes = addSibling(tree(), 'a');
    expect(validateNodes(nodes).ok).toBe(true);
    const a = nodes.find((n) => n.id === 'a')!;
    const b = nodes.find((n) => n.id === 'b')!;
    const added = nodes.find((n) => n.parentId === 'root' && n.id !== 'a' && n.id !== 'b')!;
    expect(added.order).toBe(a.order + 1);
    expect(b.order).toBe(added.order + 1);
  });

  it('중심 노드는 거부(원본 그대로)', () => {
    const base = tree();
    expect(addSibling(base, 'root')).toBe(base);
  });
});

describe('setText', () => {
  it('일반 노드는 수정됨', () => {
    const nodes = setText(tree(), 'a', '바뀐 텍스트');
    expect(nodes.find((n) => n.id === 'a')!.text).toBe('바뀐 텍스트');
  });

  it('중심 노드는 거부(원본 그대로)', () => {
    const base = tree();
    expect(setText(base, 'root', '다른 제목')).toBe(base);
  });

  it('줄바꿈이 든 글을 넣었다 꺼내도 그대로 보존됨', () => {
    const multiline = '1장 멀티플과 시대정신\n : 세상은 어디로 가는가';
    const nodes = setText(tree(), 'a', multiline);
    expect(nodes.find((n) => n.id === 'a')!.text).toBe(multiline);
  });
});

describe('setColor', () => {
  it('색상 변경', () => {
    const nodes = setColor(tree(), 'a', '#ffffff');
    expect(nodes.find((n) => n.id === 'a')!.color).toBe('#ffffff');
  });
});

describe('toggleCollapsed', () => {
  it('접기/펼치기 토글', () => {
    const once = toggleCollapsed(tree(), 'a');
    expect(once.find((n) => n.id === 'a')!.collapsed).toBe(true);
    const twice = toggleCollapsed(once, 'a');
    expect(twice.find((n) => n.id === 'a')!.collapsed).toBe(false);
  });
});

describe('deleteBranch', () => {
  it('하위 전체를 포함해 삭제', () => {
    const nodes = deleteBranch(tree(), 'a');
    expect(nodes.find((n) => n.id === 'a')).toBeUndefined();
    expect(nodes.find((n) => n.id === 'a1')).toBeUndefined();
    expect(validateNodes(nodes).ok).toBe(true);
  });

  it('중심 노드는 거부(원본 그대로)', () => {
    const base = tree();
    expect(deleteBranch(base, 'root')).toBe(base);
  });
});

describe('countDescendants', () => {
  it('하위 노드 수를 센다', () => {
    expect(countDescendants(tree(), 'a')).toBe(1);
    expect(countDescendants(tree(), 'root')).toBe(3);
    expect(countDescendants(tree(), 'b')).toBe(0);
  });
});

describe('needsDeleteConfirm', () => {
  it('하위가 있으면 확인 필요', () => {
    expect(needsDeleteConfirm(tree(), 'a')).toBe(true);
  });

  it('하위가 없고 글이 비어있으면 확인 불필요', () => {
    const nodes = tree().map((n) => (n.id === 'b' ? { ...n, text: '' } : n));
    expect(needsDeleteConfirm(nodes, 'b')).toBe(false);
  });

  it('하위가 없어도 글이 비어있지 않으면 확인 필요', () => {
    expect(needsDeleteConfirm(tree(), 'b')).toBe(true);
  });
});

describe('resolveSelectedId', () => {
  it('선택한 줄이 보이면 그대로 둔다', () => {
    expect(resolveSelectedId(['root', 'a', 'b'], 'a')).toBe('a');
  });

  it('선택한 줄이 접혔거나 삭제되면 첫 줄(중심 노드)로', () => {
    expect(resolveSelectedId(['root', 'a'], 'a1')).toBe('root');
    expect(resolveSelectedId(['root', 'a'], null)).toBe('root');
  });

  it('줄이 하나도 없으면 null', () => {
    expect(resolveSelectedId([], 'a')).toBeNull();
  });
});

describe('setRootText', () => {
  it('중심 노드 글을 바꾼다', () => {
    const nodes = setRootText(tree(), '새 제목');
    expect(nodes.find((n) => n.parentId === null)!.text).toBe('새 제목');
  });
});

describe('메모·글씨색', () => {
  it('setNote: 메모를 넣고, 공백뿐이면 note 키를 없앤다', () => {
    const withNote = setNote(tree(), 'a', '중요한 문장');
    expect(withNote.find((n) => n.id === 'a')!.note).toBe('중요한 문장');
    const cleared = setNote(withNote, 'a', '   ');
    expect('note' in cleared.find((n) => n.id === 'a')!).toBe(false);
  });

  it('setNote: 상한을 넘는 메모는 상한까지만 남긴다', () => {
    const nodes = setNote(tree(), 'a', 'x'.repeat(MAX_NOTE_LENGTH + 50));
    expect(nodes.find((n) => n.id === 'a')!.note).toHaveLength(MAX_NOTE_LENGTH);
  });

  it('setTextColor: 색을 넣고, null이면 키를 없애고, 형식이 틀리면 그대로', () => {
    const colored = setTextColor(tree(), 'b', TEXT_COLORS[2].value);
    expect(colored.find((n) => n.id === 'b')!.textColor).toBe(TEXT_COLORS[2].value);
    expect('textColor' in setTextColor(colored, 'b', null).find((n) => n.id === 'b')!).toBe(false);
    const base = tree();
    expect(setTextColor(base, 'b', 'red')).toBe(base);
  });

  it('validateNodes: 칸이 없는 기존 노드는 통과, 잘못된 값은 거부', () => {
    expect(validateNodes(tree())).toEqual({ ok: true });
    const longNote = tree().map((n) => (n.id === 'a' ? { ...n, note: 'x'.repeat(MAX_NOTE_LENGTH + 1) } : n));
    expect(validateNodes(longNote).ok).toBe(false);
    const badColor = tree().map((n) => (n.id === 'a' ? { ...n, textColor: 'blue' } : n));
    expect(validateNodes(badColor).ok).toBe(false);
    const badType = tree().map((n) => (n.id === 'a' ? { ...n, note: 3 as unknown as string } : n));
    expect(validateNodes(badType).ok).toBe(false);
  });

  it('다른 편집(글·색·접기·추가·삭제·정렬)을 해도 메모·글씨색이 남는다', () => {
    let nodes = setTextColor(setNote(tree(), 'a', '메모'), 'a', '#222222');
    nodes = setText(nodes, 'a', '새 글');
    nodes = setColor(nodes, 'a', '#123456');
    nodes = toggleCollapsed(nodes, 'a');
    nodes = addChild(nodes, 'root');
    nodes = addSibling(nodes, 'b');
    nodes = deleteBranch(nodes, 'b');
    nodes = setRootText(normalizeOrder(nodes), '다른 제목');
    const a = nodes.find((n) => n.id === 'a')!;
    expect(a.note).toBe('메모');
    expect(a.textColor).toBe('#222222');
  });
});
