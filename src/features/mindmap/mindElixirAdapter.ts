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
      color: node.parentId === null ? readableTextColor(node.color) : '#18212f',
      border: node.parentId === null ? 'none' : '1px solid ' + node.color,
      fontWeight: node.parentId === null ? '700' : '500',
    },
  };
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

function flatten(obj: NodeObj, parentId: string | null, order: number, out: MindmapNode[]): void {
  if (typeof obj.id !== 'string' || typeof obj.topic !== 'string') {
    throw new Error('마인드맵 데이터 변환 중 손실이 감지되었습니다(id 또는 글자 없음).');
  }
  if (typeof obj.branchColor !== 'string') {
    throw new Error('마인드맵 데이터 변환 중 손실이 감지되었습니다(색상 없음).');
  }
  out.push({
    id: obj.id,
    parentId,
    text: obj.topic,
    color: obj.branchColor,
    collapsed: obj.expanded === false,
    order,
  });
  (obj.children ?? []).forEach((child, i) => flatten(child, obj.id, i, out));
}

/** Mind Elixir 데이터를 평평한 MindmapNode[]로 되돌린다. */
export function fromMindElixir(data: MindElixirData): MindmapNode[] {
  const out: MindmapNode[] = [];
  flatten(data.nodeData, null, 0, out);
  return out;
}
