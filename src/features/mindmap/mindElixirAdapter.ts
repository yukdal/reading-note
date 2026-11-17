import type { MindElixirData, NodeObj } from 'mind-elixir';
import type { MindmapNode } from '../../types';

// ponytail: 노드마다 nodes.filter()를 돌리면 O(n²)이라 부모→자식 맵을 한 번만 만들어 쓴다(300개 노드 기준).
function buildChildrenMap(nodes: MindmapNode[]): Map<string, MindmapNode[]> {
  const map = new Map<string, MindmapNode[]>();
  for (const n of nodes) {
    if (n.parentId === null) continue;
    const arr = map.get(n.parentId) ?? [];
    arr.push(n);
    map.set(n.parentId, arr);
  }
  for (const arr of map.values()) arr.sort((a, b) => a.order - b.order);
  return map;
}

function readableTextColor(color: string): string {
  const rgb = [1, 3, 5].map((offset) => parseInt(color.slice(offset, offset + 2), 16) / 255);
  const linear = rgb.map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  const luminance = 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
  return luminance > 0.179 ? '#000000' : '#ffffff';
}

function buildNodeObj(childrenOf: Map<string, MindmapNode[]>, node: MindmapNode): NodeObj {
  const children = (childrenOf.get(node.id) ?? []).map((child) => buildNodeObj(childrenOf, child));
  const obj: NodeObj = {
    id: node.id,
    topic: node.text,
    branchColor: node.color,
    expanded: !node.collapsed,
    style: {
      background: node.parentId === null ? node.color : 'color-mix(in srgb, ' + node.color + ' 14%, #ffffff)',
      color: node.textColor ?? (node.parentId === null ? readableTextColor(node.color) : '#18212f'),
      border: node.parentId === null ? 'none' : '1px solid ' + node.color,
      fontWeight: node.parentId === null ? '700' : '500',
    },
  };
  // 메모 본문은 Mind Elixir에 넘기지 않는다(맵에는 표시만). 📝은 icons로 넣으며 Mind Elixir가 글자로 이스케이프한다.
  if (node.note) obj.icons = ['📝'];
  if (children.length > 0) obj.children = children;
  return obj;
}

/** 평평한 MindmapNode[]를 Mind Elixir가 요구하는 중첩 데이터로 변환한다. */
export function toMindElixir(nodes: MindmapNode[]): MindElixirData {
  const center = nodes.find((n) => n.parentId === null);
  if (!center) {
    throw new Error('중심 노드가 없어 마인드맵 데이터로 변환할 수 없습니다.');
  }
  return { nodeData: buildNodeObj(buildChildrenMap(nodes), center) };
}

function flatten(
  obj: NodeObj,
  parentId: string | null,
  order: number,
  out: MindmapNode[],
  prevById: Map<string, MindmapNode>,
): void {
  if (typeof obj.id !== 'string' || typeof obj.topic !== 'string') {
    throw new Error('마인드맵 데이터 변환 중 손실이 감지되었습니다(id 또는 글자 없음).');
  }
  if (typeof obj.branchColor !== 'string') {
    throw new Error('마인드맵 데이터 변환 중 손실이 감지되었습니다(색상 없음).');
  }
  const node: MindmapNode = {
    id: obj.id,
    parentId,
    text: obj.topic,
    color: obj.branchColor,
    collapsed: obj.expanded === false,
    order,
  };
  // 메모·글씨색은 Mind Elixir 쪽에서 바뀌지 않으므로 직전 nodes에서 id로 다시 붙인다(값이 없으면 키도 두지 않음).
  const prev = prevById.get(obj.id);
  if (prev?.note) node.note = prev.note;
  if (prev?.textColor) node.textColor = prev.textColor;
  out.push(node);
  (obj.children ?? []).forEach((child, i) => flatten(child, obj.id, i, out, prevById));
}

/** Mind Elixir 데이터를 평평한 MindmapNode[]로 되돌린다. prev는 메모·글씨색을 되살릴 직전 nodes. */
export function fromMindElixir(data: MindElixirData, prev: MindmapNode[] = []): MindmapNode[] {
  const out: MindmapNode[] = [];
  flatten(data.nodeData, null, 0, out, new Map(prev.map((n) => [n.id, n] as const)));
  return out;
}
