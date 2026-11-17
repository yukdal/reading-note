import type { MindmapNode } from '../../types';

export type ValidationResult = { ok: true } | { ok: false; error: string };

const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;

export const MAX_NOTE_LENGTH = 2000;

/** 글씨색은 자유 색상표 대신 밝은 노드 배경에서 잘 읽히는 정해진 색만 고른다. */
export const TEXT_COLORS: { label: string; value: string }[] = [
  { label: '검정', value: '#222222' },
  { label: '진회색', value: '#555555' },
  { label: '빨강', value: '#c62828' },
  { label: '주황', value: '#b45309' },
  { label: '초록', value: '#2e7d32' },
  { label: '파랑', value: '#1d4ed8' },
  { label: '남색', value: '#283593' },
  { label: '보라', value: '#6a1b9a' },
  { label: '갈색', value: '#6d4c41' },
];

/**
 * nodes가 하나의 마인드맵으로서 올바른 구조인지 검사한다.
 * (중심 노드 1개, id 중복 없음, 부모 참조 유효, 순환 없음, 중심에 연결됨, 형제 order 0부터 연속)
 */
export function validateNodes(nodes: MindmapNode[]): ValidationResult {
  const centers = nodes.filter((n) => n.parentId === null);
  if (centers.length !== 1) {
    return { ok: false, error: '중심 노드는 정확히 1개여야 합니다.' };
  }
  const center = centers[0];

  const ids = new Set<string>();
  for (const n of nodes) {
    if (ids.has(n.id)) {
      return { ok: false, error: '노드 id가 중복되었습니다.' };
    }
    ids.add(n.id);
  }

  for (const n of nodes) {
    if (!HEX_COLOR.test(n.color)) {
      return { ok: false, error: '색상은 #RRGGBB 형식이어야 합니다.' };
    }
    if (n.note !== undefined && (typeof n.note !== 'string' || n.note.length > MAX_NOTE_LENGTH)) {
      return { ok: false, error: `메모는 ${MAX_NOTE_LENGTH}자 이하의 글이어야 합니다.` };
    }
    if (n.textColor !== undefined && (typeof n.textColor !== 'string' || !HEX_COLOR.test(n.textColor))) {
      return { ok: false, error: '글씨색은 #RRGGBB 형식이어야 합니다.' };
    }
    if (n.parentId !== null) {
      if (n.id === n.parentId) {
        return { ok: false, error: '노드가 자기 자신을 부모로 가질 수 없습니다.' };
      }
      if (!ids.has(n.parentId)) {
        return { ok: false, error: '존재하지 않는 부모를 참조하는 노드가 있습니다.' };
      }
    }
  }

  const parentOf = new Map(nodes.map((n) => [n.id, n.parentId] as const));
  for (const n of nodes) {
    const seen = new Set<string>();
    let cur: string | null = n.id;
    while (cur !== null) {
      if (seen.has(cur)) {
        return { ok: false, error: '부모-자식 관계에 순환이 있습니다.' };
      }
      seen.add(cur);
      cur = parentOf.get(cur) ?? null;
    }
  }

  const childrenOf = new Map<string, string[]>();
  for (const n of nodes) {
    if (n.parentId === null) continue;
    const arr = childrenOf.get(n.parentId) ?? [];
    arr.push(n.id);
    childrenOf.set(n.parentId, arr);
  }
  const visited = new Set<string>([center.id]);
  const queue = [center.id];
  while (queue.length > 0) {
    const cur = queue.shift() as string;
    for (const childId of childrenOf.get(cur) ?? []) {
      if (!visited.has(childId)) {
        visited.add(childId);
        queue.push(childId);
      }
    }
  }
  if (visited.size !== nodes.length) {
    return { ok: false, error: '중심 노드와 연결되지 않은 가지가 있습니다.' };
  }

  const siblingsByParent = new Map<string | null, MindmapNode[]>();
  for (const n of nodes) {
    const arr = siblingsByParent.get(n.parentId) ?? [];
    arr.push(n);
    siblingsByParent.set(n.parentId, arr);
  }
  for (const siblings of siblingsByParent.values()) {
    const orders = siblings.map((s) => s.order).sort((a, b) => a - b);
    for (let i = 0; i < orders.length; i++) {
      if (orders[i] !== i) {
        return { ok: false, error: '같은 부모를 가진 노드의 순서(order)가 0부터 연속되지 않습니다.' };
      }
    }
  }

  return { ok: true };
}

/** 같은 부모를 가진 형제들의 order를 현재 순서를 유지한 채 0부터 연속되게 다시 매긴다. */
export function normalizeOrder(nodes: MindmapNode[]): MindmapNode[] {
  const groups = new Map<string | null, MindmapNode[]>();
  for (const n of nodes) {
    const arr = groups.get(n.parentId) ?? [];
    arr.push(n);
    groups.set(n.parentId, arr);
  }
  const orderMap = new Map<string, number>();
  for (const siblings of groups.values()) {
    const sorted = [...siblings].sort((a, b) => a.order - b.order);
    sorted.forEach((n, i) => orderMap.set(n.id, i));
  }
  return nodes.map((n) => ({ ...n, order: orderMap.get(n.id) as number }));
}

export function createInitialNodes(title: string, color: string): MindmapNode[] {
  return [{ id: crypto.randomUUID(), parentId: null, text: title, color, collapsed: false, order: 0 }];
}

/** parentId 노드의 맨 끝 자식으로 빈 텍스트 노드를 추가한다. 부모가 접혀 있으면 펼친다. */
export function addChild(nodes: MindmapNode[], parentId: string): MindmapNode[] {
  const parent = nodes.find((n) => n.id === parentId);
  if (!parent) return nodes;
  const siblingCount = nodes.filter((n) => n.parentId === parentId).length;
  const child: MindmapNode = {
    id: crypto.randomUUID(),
    parentId,
    text: '',
    color: parent.color,
    collapsed: false,
    order: siblingCount,
  };
  const withExpandedParent = nodes.map((n) =>
    n.id === parentId && n.collapsed ? { ...n, collapsed: false } : n,
  );
  return normalizeOrder([...withExpandedParent, child]);
}

/** nodeId 바로 다음 순서에 형제 노드를 추가한다. 중심 노드는 거부(원본 그대로 반환). */
export function addSibling(nodes: MindmapNode[], nodeId: string): MindmapNode[] {
  const target = nodes.find((n) => n.id === nodeId);
  if (!target || target.parentId === null) return nodes;
  const sibling: MindmapNode = {
    id: crypto.randomUUID(),
    parentId: target.parentId,
    text: '',
    color: target.color,
    collapsed: false,
    order: target.order + 0.5, // normalizeOrder가 정수로 다시 매길 때까지만 쓰는 임시 값
  };
  return normalizeOrder([...nodes, sibling]);
}

/** 중심 노드는 글 수정 거부(책 제목과 같아야 하므로 setRootText로만 바뀜). */
export function setText(nodes: MindmapNode[], nodeId: string, text: string): MindmapNode[] {
  const target = nodes.find((n) => n.id === nodeId);
  if (!target || target.parentId === null) return nodes;
  return nodes.map((n) => (n.id === nodeId ? { ...n, text } : n));
}

export function setColor(nodes: MindmapNode[], nodeId: string, color: string): MindmapNode[] {
  return nodes.map((n) => (n.id === nodeId ? { ...n, color } : n));
}

/** 메모를 바꾼다. 공백뿐이면 note 키를 지우고, 너무 길면 상한까지만 남긴다. */
export function setNote(nodes: MindmapNode[], nodeId: string, note: string): MindmapNode[] {
  const value = note.trim() === '' ? null : note.slice(0, MAX_NOTE_LENGTH);
  return nodes.map((n) => {
    if (n.id !== nodeId) return n;
    const { note: _old, ...rest } = n;
    return value === null ? rest : { ...rest, note: value };
  });
}

/** 글씨색을 바꾼다. null이면 기본색(키 삭제), 형식이 틀리면 원본 그대로. */
export function setTextColor(nodes: MindmapNode[], nodeId: string, color: string | null): MindmapNode[] {
  if (color !== null && !HEX_COLOR.test(color)) return nodes;
  return nodes.map((n) => {
    if (n.id !== nodeId) return n;
    const { textColor: _old, ...rest } = n;
    return color === null ? rest : { ...rest, textColor: color };
  });
}

/** 비교용: 메모·글씨색이 같은지(없는 것과 빈 것은 같게 본다). */
export function sameNodeExtras(a: MindmapNode, b: MindmapNode): boolean {
  return (a.note ?? '') === (b.note ?? '') && (a.textColor ?? '') === (b.textColor ?? '');
}

export function toggleCollapsed(nodes: MindmapNode[], nodeId: string): MindmapNode[] {
  return nodes.map((n) => (n.id === nodeId ? { ...n, collapsed: !n.collapsed } : n));
}

/** nodeId와 그 하위 전체를 삭제한다. 중심 노드는 거부(원본 그대로 반환). */
export function deleteBranch(nodes: MindmapNode[], nodeId: string): MindmapNode[] {
  const target = nodes.find((n) => n.id === nodeId);
  if (!target || target.parentId === null) return nodes;
  const toRemove = new Set<string>([nodeId]);
  // ponytail: 트리가 작아서(개인 독서노트 마인드맵) 고정점 반복으로 충분. 수천 노드 규모면 자식 맵으로 교체.
  let changed = true;
  while (changed) {
    changed = false;
    for (const n of nodes) {
      if (n.parentId !== null && toRemove.has(n.parentId) && !toRemove.has(n.id)) {
        toRemove.add(n.id);
        changed = true;
      }
    }
  }
  return normalizeOrder(nodes.filter((n) => !toRemove.has(n.id)));
}

/** 삭제 전 확인이 필요한지 판단한다: 하위가 있거나 글이 비어 있지 않으면 확인이 필요하다. */
export function needsDeleteConfirm(nodes: MindmapNode[], nodeId: string): boolean {
  const target = nodes.find((n) => n.id === nodeId);
  if (!target) return false;
  return countDescendants(nodes, nodeId) > 0 || target.text.trim() !== '';
}

/** 삭제 확인 대화상자에 보여줄 문구. 하위가 있으면 개수를, 없으면 글 내용을 보여준다. */
export function deleteConfirmMessage(nodes: MindmapNode[], nodeId: string): string {
  const count = countDescendants(nodes, nodeId);
  if (count > 0) {
    return `하위 ${count}개 포함 삭제할까요? 이 작업은 되돌릴 수 없습니다.`;
  }
  const target = nodes.find((n) => n.id === nodeId);
  return `'${target?.text ?? ''}' 노드를 삭제할까요? 이 작업은 되돌릴 수 없습니다.`;
}

/** 아웃라인에서 버튼을 보여줄 줄: 선택한 줄이 화면에 있으면 그 줄, 없으면 첫 줄(중심 노드). */
export function resolveSelectedId(visibleIds: string[], selectedId: string | null): string | null {
  if (selectedId !== null && visibleIds.includes(selectedId)) return selectedId;
  return visibleIds[0] ?? null;
}

export function countDescendants(nodes: MindmapNode[], nodeId: string): number {
  let count = 0;
  const queue = [nodeId];
  while (queue.length > 0) {
    const cur = queue.shift() as string;
    for (const n of nodes) {
      if (n.parentId === cur) {
        count++;
        queue.push(n.id);
      }
    }
  }
  return count;
}

/** 책 제목 변경을 중심 노드 글에 반영한다(setText와 달리 중심 노드를 바꾸는 전용 함수). */
export function setRootText(nodes: MindmapNode[], title: string): MindmapNode[] {
  return nodes.map((n) => (n.parentId === null ? { ...n, text: title } : n));
}
