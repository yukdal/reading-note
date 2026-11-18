import { zipSync } from 'fflate';
import type { MindmapNode } from '../../types';
import { validateNodes } from './model';

// XMind 앱이 읽는 .xmind 포맷(ZIP, 무압축) 중 공식 샘플 파일에서 확인된 최소 구조만 쓴다.
// 메모(note)·가지색(color)·글씨색(textColor)·접힘(collapsed)의 .xmind 쪽 필드 이름은
// 확인되지 않았으므로 추측해서 넣지 않는다 — 이 네 가지는 내보낼 때 사라진다(손실 변환).

interface XmindTopic {
  id: string;
  class: 'topic';
  title: string;
  structureClass?: string;
  children?: { attached: XmindTopic[] };
}

function buildTopic(childrenOf: Map<string, MindmapNode[]>, node: MindmapNode, isRoot: boolean): XmindTopic {
  const kids = childrenOf.get(node.id) ?? [];
  const topic: XmindTopic = { id: node.id, class: 'topic', title: node.text };
  if (isRoot) topic.structureClass = 'org.xmind.ui.map.unbalanced';
  if (kids.length > 0) {
    topic.children = { attached: kids.map((k) => buildTopic(childrenOf, k, false)) };
  }
  return topic;
}

/** 책 한 권(시트 하나)을 .xmind가 요구하는 중첩 구조로 바꾼다. nodes는 validateNodes를 통과한 상태여야 한다. */
function buildSheet(title: string, nodes: MindmapNode[]) {
  const center = nodes.find((n) => n.parentId === null) as MindmapNode;
  const childrenOf = new Map<string, MindmapNode[]>();
  for (const n of nodes) {
    if (n.parentId === null) continue;
    const arr = childrenOf.get(n.parentId) ?? [];
    arr.push(n);
    childrenOf.set(n.parentId, arr);
  }
  for (const arr of childrenOf.values()) arr.sort((a, b) => a.order - b.order);

  return {
    id: crypto.randomUUID(),
    class: 'sheet',
    title,
    topicPositioning: 'fixed',
    rootTopic: buildTopic(childrenOf, center, true),
  };
}

/** 책 목록을 XMind 앱이 열 수 있는 .xmind 파일(ZIP, 무압축) 바이트로 만든다. 책 한 권 = 시트 하나. */
export function toXmindArchive(sheets: { title: string; nodes: MindmapNode[] }[]): Uint8Array {
  if (sheets.length === 0) {
    throw new Error('내보낼 책이 없습니다.');
  }

  const content = sheets.map((sheet) => {
    const result = validateNodes(sheet.nodes);
    if (!result.ok) {
      throw new Error(`「${sheet.title}」 - ${result.error}`);
    }
    return buildSheet(sheet.title, sheet.nodes);
  });

  const manifest = { 'file-entries': { 'content.json': {}, 'metadata.json': {} } };
  const metadata = { activeSheetId: content[0].id };

  const encoder = new TextEncoder();
  return zipSync(
    {
      'content.json': encoder.encode(JSON.stringify(content)),
      'metadata.json': encoder.encode(JSON.stringify(metadata)),
      'manifest.json': encoder.encode(JSON.stringify(manifest)),
    },
    { level: 0 }, // XMind 자신이 만든 파일도 무압축(store)이었다.
  );
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** YYYY-MM-DD-reading-note.xmind (로컬 날짜) */
export function xmindFileName(now: Date = new Date()): string {
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}-reading-note.xmind`;
}

export function downloadXmind(filename: string, bytes: Uint8Array): void {
  // shortcut: 매번 바이트를 복사해 느리지만(zipSync 결과 타입이 BlobPart와 안 맞아서), 백업 파일은 작아 문제 없다. 느려지면 타입 단언으로 교체.
  const blob = new Blob([bytes.slice()], { type: 'application/vnd.xmind.workbook' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
