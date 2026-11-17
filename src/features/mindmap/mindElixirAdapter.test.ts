import { describe, expect, it } from 'vitest';
import type { MindElixirData } from 'mind-elixir';
import type { MindmapNode } from '../../types';
import { fromMindElixir, toMindElixir } from './mindElixirAdapter';

function tree(): MindmapNode[] {
  return [
    { id: 'root', parentId: null, text: '책 제목', color: '#112233', collapsed: false, order: 0 },
    { id: 'a', parentId: 'root', text: 'A', color: '#aabbcc', collapsed: false, order: 0 },
    { id: 'b', parentId: 'root', text: 'B', color: '#ddeeff', collapsed: true, order: 1 },
    { id: 'a1', parentId: 'a', text: 'A1', color: '#aabbcc', collapsed: false, order: 0 },
    { id: 'a2', parentId: 'a', text: 'A2', color: '#aabbcc', collapsed: false, order: 1 },
  ];
}

describe('toMindElixir / fromMindElixir 왕복', () => {
  it('id·text·color·collapsed·order가 모두 동일하게 복원된다', () => {
    const original = tree();
    const data = toMindElixir(original);
    const restored = fromMindElixir(data);

    expect(restored).toHaveLength(original.length);
    for (const node of original) {
      const found = restored.find((n) => n.id === node.id);
      expect(found).toEqual(node);
    }
  });

  it('중심 노드의 topic/branchColor를 반영한다', () => {
    const data = toMindElixir(tree());
    expect(data.nodeData.id).toBe('root');
    expect(data.nodeData.topic).toBe('책 제목');
    expect(data.nodeData.branchColor).toBe('#112233');
    expect(data.nodeData.expanded).toBe(true);
  });

  it('중심 노드가 없으면 예외를 던진다', () => {
    const noCenter = tree().map((n) => (n.id === 'root' ? { ...n, parentId: 'a' } : n));
    expect(() => toMindElixir(noCenter)).toThrow();
  });

  it('id가 없는 노드를 역변환하면 예외를 던진다(손실 감지)', () => {
    const data = toMindElixir(tree());
    const broken: MindElixirData = {
      nodeData: { ...data.nodeData, id: undefined as unknown as string },
    };
    expect(() => fromMindElixir(broken)).toThrow();
  });

  it('branchColor가 없는 노드를 역변환하면 예외를 던진다(손실 감지)', () => {
    const data = toMindElixir(tree());
    const broken: MindElixirData = {
      nodeData: { ...data.nodeData, branchColor: undefined },
    };
    expect(() => fromMindElixir(broken)).toThrow();
  });
});

describe('노드 색상 표시', () => {
  it('중심 노드는 채운 색, 일반 노드는 같은 색의 옅은 배경과 테두리를 사용한다', () => {
    const data = toMindElixir(tree());
    expect(data.nodeData.style?.background).toBe('#112233');
    expect(data.nodeData.style?.color).toBe('#ffffff');
    expect(data.nodeData.children?.[0].style?.background).toBe('color-mix(in srgb, #aabbcc 14%, #ffffff)');
    expect(data.nodeData.children?.[0].style?.border).toBe('1px solid #aabbcc');
  });

  it('밝은 중심 노드에는 대비가 높은 검정 글자를 사용한다', () => {
    const nodes = tree().map((node) => node.parentId === null ? { ...node, color: '#ffffff' } : node);
    expect(toMindElixir(nodes).nodeData.style?.color).toBe('#000000');
  });

  it('색을 바꿔 다시 그려도 구조와 접힘 상태를 보존한다', () => {
    const nodes = tree().map((node) => node.id === 'b' ? { ...node, color: '#f0605a' } : node);
    const data = toMindElixir(nodes);
    expect(data.nodeData.children?.[1].style?.border).toBe('1px solid #f0605a');
    expect(fromMindElixir(data).find((node) => node.id === 'b')).toEqual(nodes.find((node) => node.id === 'b'));
  });
});
describe('메모·글씨색 왕복', () => {
  it('메모·글씨색이 있는 노드를 바꿨다 되돌려도 그대로 남는다', () => {
    const original = tree().map((n) =>
      n.id === 'a1'
        ? { ...n, note: '첫 줄\n<b>둘째</b>', textColor: '#c62828' }
        : n.id === 'root'
          ? { ...n, textColor: '#222222' }
          : n,
    );
    const restored = fromMindElixir(toMindElixir(original), original);
    for (const node of original) expect(restored.find((n) => n.id === node.id)).toEqual(node);
  });

  it('메모 본문은 Mind Elixir에 넘기지 않고 📝 표시만 넘긴다', () => {
    const original = tree().map((n) => (n.id === 'a' ? { ...n, note: '메모 본문' } : n));
    const data = toMindElixir(original);
    expect(JSON.stringify(data)).not.toContain('메모 본문');
    const a = data.nodeData.children!.find((c) => c.id === 'a')!;
    expect(a.icons).toEqual(['📝']);
    expect(a.note).toBeUndefined();
  });

  it('글씨색은 style.color로 넘기고, 없으면 기존 자동 색을 쓴다', () => {
    const original = tree().map((n) => (n.id === 'b' ? { ...n, textColor: '#2e7d32' } : n));
    const kids = toMindElixir(original).nodeData.children!;
    expect(kids.find((c) => c.id === 'b')!.style!.color).toBe('#2e7d32');
    expect(kids.find((c) => c.id === 'a')!.style!.color).toBe('#18212f');
  });

  it('칸이 없는 기존 데이터에는 새 키가 생기지 않는다', () => {
    const original = tree();
    for (const n of fromMindElixir(toMindElixir(original), original)) {
      expect('note' in n).toBe(false);
      expect('textColor' in n).toBe(false);
    }
  });
});
