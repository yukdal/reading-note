import { describe, expect, it } from 'vitest';
import { xmindExampleBook, xmindExampleNodes } from './xmindExample';
import { parseBackupFile } from '../features/backup/backup';
import { fromMindElixir, toMindElixir } from '../features/mindmap/mindElixirAdapter';

describe('XMind 참고 예제', () => {
  it('앱 가져오기 형식으로 검증되고 5개의 주요 가지와 2개의 하위 주제를 보존한다', () => {
    const parsed = parseBackupFile(JSON.stringify({
      books: [xmindExampleBook],
      mindmaps: [{ book_id: xmindExampleBook.id, data: { nodes: xmindExampleNodes } }],
    }));
    expect(parsed.ok).toBe(true);
    expect(xmindExampleNodes.filter((node) => node.parentId === 'x-root')).toHaveLength(5);
    expect(xmindExampleNodes.filter((node) => node.parentId === 'x-m5')).toHaveLength(2);
    const restored = fromMindElixir(toMindElixir(xmindExampleNodes));
    expect(new Map(restored.map((node) => [node.id, node]))).toEqual(
      new Map(xmindExampleNodes.map((node) => [node.id, node])),
    );
  });
});