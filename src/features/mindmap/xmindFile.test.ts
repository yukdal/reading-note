import { describe, expect, it } from 'vitest';
import { unzipSync } from 'fflate';
import { toXmindArchive, xmindFileName } from './xmindFile';
import { xmindExampleNodes } from '../../data/xmindExample';
import type { MindmapNode } from '../../types';

function decode(bytes: Uint8Array): unknown {
  return JSON.parse(new TextDecoder().decode(bytes));
}

describe('toXmindArchive', () => {
  it('멤버가 정확히 content.json, metadata.json, manifest.json 3개다', () => {
    const bytes = toXmindArchive([{ title: 'Central Topic', nodes: xmindExampleNodes }]);
    const files = unzipSync(bytes);
    expect(Object.keys(files).sort()).toEqual(['content.json', 'manifest.json', 'metadata.json']);
  });

  it('content.json은 배열이고 시트 수가 맞는다', () => {
    const bytes = toXmindArchive([
      { title: '책1', nodes: xmindExampleNodes },
      { title: '책2', nodes: xmindExampleNodes },
    ]);
    const files = unzipSync(bytes);
    const content = decode(files['content.json']) as unknown[];
    expect(Array.isArray(content)).toBe(true);
    expect(content).toHaveLength(2);
  });

  it('트리가 제대로 복원되고, children.attached 순서가 order 순서와 같다(깊이 2단 이상)', () => {
    const bytes = toXmindArchive([{ title: 'Central Topic', nodes: xmindExampleNodes }]);
    const files = unzipSync(bytes);
    const content = decode(files['content.json']) as {
      title: string;
      rootTopic: {
        title: string;
        structureClass: string;
        children: { attached: { id: string; title: string; children?: { attached: unknown[] } }[] };
      };
    }[];

    const root = content[0].rootTopic;
    expect(root.title).toBe('Central Topic');
    expect(root.structureClass).toBe('org.xmind.ui.map.unbalanced');
    // order 0~4인 x-root의 자식들이 그 순서대로 들어있어야 한다.
    expect(root.children.attached.map((t) => t.id)).toEqual(['x-m1', 'x-m2', 'x-m3', 'x-m4', 'x-m5']);

    const m5 = root.children.attached.find((t) => t.id === 'x-m5') as {
      children?: { attached: { id: string }[] };
    };
    expect(m5.children?.attached.map((t) => t.id)).toEqual(['x-m5-s1', 'x-m5-s2']);
  });

  it('자식이 없는 노드에는 children 키가 없다', () => {
    const bytes = toXmindArchive([{ title: 'Central Topic', nodes: xmindExampleNodes }]);
    const files = unzipSync(bytes);
    const content = decode(files['content.json']) as {
      rootTopic: { children: { attached: Record<string, unknown>[] } };
    }[];
    const m1 = content[0].rootTopic.children.attached.find((t) => t.id === 'x-m1') as Record<string, unknown>;
    expect('children' in m1).toBe(false);
  });

  it('메모는 notes.plain.content로 들어가고, 메모가 없는 노드에는 notes 키가 없다', () => {
    const nodes: MindmapNode[] = [
      { id: 'a', parentId: null, text: 'A', color: '#111111', collapsed: false, order: 0, note: '메모 내용' },
      { id: 'b', parentId: 'a', text: 'B', color: '#222222', collapsed: false, order: 0 },
    ];
    const files = unzipSync(toXmindArchive([{ title: '제목', nodes }]));
    const content = decode(files['content.json']) as {
      rootTopic: Record<string, unknown> & { children: { attached: Record<string, unknown>[] } };
    }[];
    expect(content[0].rootTopic.notes).toEqual({ plain: { content: '메모 내용' } });
    expect('notes' in content[0].rootTopic.children.attached[0]).toBe(false);
  });

  it('metadata.json의 activeSheetId가 첫 시트의 id와 같다', () => {
    const bytes = toXmindArchive([{ title: 'Central Topic', nodes: xmindExampleNodes }]);
    const files = unzipSync(bytes);
    const content = decode(files['content.json']) as { id: string }[];
    const metadata = decode(files['metadata.json']) as { activeSheetId: string };
    expect(metadata.activeSheetId).toBe(content[0].id);
  });

  it('중심 노드가 2개인 입력에서는 오류가 난다', () => {
    const twoCenters: MindmapNode[] = [
      { id: 'a', parentId: null, text: 'A', color: '#111111', collapsed: false, order: 0 },
      { id: 'b', parentId: null, text: 'B', color: '#222222', collapsed: false, order: 0 },
    ];
    expect(() => toXmindArchive([{ title: '제목', nodes: twoCenters }])).toThrow();
  });

  it('시트가 0개면 오류가 난다', () => {
    expect(() => toXmindArchive([])).toThrow();
  });
});

describe('xmindFileName', () => {
  it('YYYY-MM-DD-reading-note.xmind 형식이다', () => {
    expect(xmindFileName(new Date(2026, 10, 18))).toBe('2026-11-18-reading-note.xmind');
  });
});
