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