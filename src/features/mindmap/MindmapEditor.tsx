import { useEffect, useRef, useState } from 'react';
import MindElixir from 'mind-elixir';
import { ko } from 'mind-elixir/i18n';
import 'mind-elixir/style.css';
import type { MindmapNode } from '../../types';
import { fromMindElixir, toMindElixir } from './mindElixirAdapter';
import {
  addChild as addChildNode,
  addSibling as addSiblingNode,
  deleteBranch,
  deleteConfirmMessage,
  needsDeleteConfirm,
  setColor as setColorNode,
  toggleCollapsed,
  validateNodes,
} from './model';

interface MindmapEditorProps {
  nodes: MindmapNode[];
  onChange: (nodes: MindmapNode[]) => void;
  readOnly?: boolean;
}

const ZOOM_STEP = 0.1;

export default function MindmapEditor({ nodes, onChange, readOnly = false }: MindmapEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mindRef = useRef<MindElixir | null>(null);
  // MindmapEditor가 마지막으로 화면에 반영한 nodes. 내가 onChange로 올려보낸 참조가
  // 그대로 props.nodes로 돌아오면 이미 화면이 그 상태이므로 다시 그리지 않는다
  // (무한 루프 방지 + 드래그/편집 중 선택이 리셋되는 것을 막는다).
  const lastSyncedRef = useRef<MindmapNode[]>(nodes);
  const [ready, setReady] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return undefined;
    const rootId = nodes.find((n) => n.parentId === null)?.id;

    const mind = new MindElixir({
      el,
      direction: MindElixir.SIDE,
      theme: {
        ...MindElixir.THEME,
        name: 'Reading Note',
        cssVar: {
          ...MindElixir.THEME.cssVar,
          '--bgcolor': '#fafbfd',
          '--root-radius': '18px',
          '--main-radius': '12px',
          '--node-gap-x': '40px',
          '--node-gap-y': '16px',
          '--main-gap-x': '70px',
          '--main-gap-y': '24px',
          '--selected': '#2563eb',
        },
      },
      editable: !readOnly,
      toolBar: false, // 자체 버튼 툴바를 따로 둔다
      newTopicName: '', // 라이브러리가 만드는 새 노드도 빈 글로 시작(모델 규칙과 통일)
      contextMenu: { locale: ko },
      before: {
        // 중심 노드는 책 제목과 같아야 하므로 inline 편집기를 열지 않는다.
        beginEdit: (target) => target?.nodeObj.id !== rootId,
      },
    });

    mind.bus.addListener('operation', () => {
      let converted: MindmapNode[] | null = null;
      try {
        converted = fromMindElixir(mind.getData());
      } catch {
        converted = null;
      }
      if (converted && validateNodes(converted).ok) {
        lastSyncedRef.current = converted;
        onChange(converted);
      } else {
        // 검증 실패(예: 중심 노드 삭제 시도) → 마지막 정상 상태로 화면을 되돌림
        mind.diffRefresh(toMindElixir(lastSyncedRef.current));
      }
    });
    mind.bus.addListener('selectNodes', (selected) => setSelectedId(selected[0]?.id ?? null));
    mind.bus.addListener('unselectNodes', () => setSelectedId(null));
    mind.bus.addListener('selectNewNode', (newNode) => setSelectedId(newNode.id));

    mindRef.current = mind;
    lastSyncedRef.current = nodes;
    mind.init(toMindElixir(nodes)).then(() => {
      setReady(true);
      // 레이아웃이 끝난 뒤 한 박자 늦춰 전체 가지가 보이게 화면 맞춤(기존 "화면 맞춤" 버튼과 동일한 함수).
      requestAnimationFrame(() => mind.scaleFit());
    });

    return () => {
      mind.destroy();
      mindRef.current = null;
      setReady(false);
    };
    // 마운트당 한 번만 초기화한다. nodes의 이후 변화는 아래 별도 effect가 diffRefresh로 반영한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const mind = mindRef.current;
    if (!mind || nodes === lastSyncedRef.current) return;
    lastSyncedRef.current = nodes;
    mind.diffRefresh(toMindElixir(nodes));
  }, [nodes]);

  function applyNodes(newNodes: MindmapNode[]) {
    lastSyncedRef.current = newNodes;
    mindRef.current?.diffRefresh(toMindElixir(newNodes));
    onChange(newNodes);
  }

  const selected = nodes.find((n) => n.id === selectedId) ?? null;
  const isRoot = selected !== null && selected.parentId === null;
  const hasChildren = selected !== null && nodes.some((n) => n.parentId === selected.id);
  const disabled = !ready || readOnly;

  function handleAddChild() {
    if (!selected) return;
    applyNodes(addChildNode(nodes, selected.id));
  }
  function handleAddSibling() {
    if (!selected || isRoot) return;
    applyNodes(addSiblingNode(nodes, selected.id));
  }
  function handleEditText() {
    const mind = mindRef.current;
    if (!selected || isRoot || !mind) return;
    const topic = mind.findEle(selected.id);
    if (topic) mind.beginEdit(topic);
  }
  function handleToggleCollapsed() {
    if (!selected) return;
    applyNodes(toggleCollapsed(nodes, selected.id));
  }
  function handleColorChange(color: string) {
    if (!selected) return;
    applyNodes(setColorNode(nodes, selected.id, color));
  }
  function handleDeleteClick() {
    if (!selected || isRoot) return;
    if (needsDeleteConfirm(nodes, selected.id)) {
      setPendingDeleteId(selected.id);
    } else {
      applyNodes(deleteBranch(nodes, selected.id));
    }
  }
  function confirmDelete() {
    if (!pendingDeleteId) return;
    applyNodes(deleteBranch(nodes, pendingDeleteId));
    setPendingDeleteId(null);
    setSelectedId(null);
  }
  function handleZoomIn() {
    const mind = mindRef.current;
    if (!mind) return;
    mind.scale(Math.min(mind.scaleMax, mind.scaleVal + ZOOM_STEP));
  }
  function handleZoomOut() {
    const mind = mindRef.current;
    if (!mind) return;
    mind.scale(Math.max(mind.scaleMin, mind.scaleVal - ZOOM_STEP));
  }
  function handleFit() {
    mindRef.current?.scaleFit();
  }

  return (
    <div className="mindmap-editor">
      <p className="mindmap-hint">두 손가락으로 확대·축소할 수 없습니다 — 아래 버튼을 사용하세요.</p>
      <div className="mindmap-toolbar" role="toolbar" aria-label="마인드맵 편집 도구">
        <button type="button" className="btn" onClick={handleAddChild} disabled={disabled || !selected}>
          자식 추가
        </button>
        <button
          type="button"
          className="btn"
          onClick={handleAddSibling}
          disabled={disabled || !selected || isRoot}
        >
          형제 추가
        </button>
        <button type="button" className="btn" onClick={handleEditText} disabled={disabled || !selected || isRoot}>
          글 수정
        </button>
        <button
          type="button"
          className="btn btn-danger"
          onClick={handleDeleteClick}
          disabled={disabled || !selected || isRoot}
        >
          삭제
        </button>
        <button
          type="button"
          className="btn"
          onClick={handleToggleCollapsed}
          disabled={disabled || !selected || !hasChildren}
        >
          {selected?.collapsed ? '펼치기' : '접기'}
        </button>
        <label className="color-field">
          색상
          <input
            type="color"
            value={selected?.color ?? '#000000'}
            onChange={(e) => handleColorChange(e.target.value)}
            disabled={disabled || !selected}
            aria-label="선택한 노드 색상"
          />
        </label>
        <button type="button" className="btn" onClick={handleZoomIn} disabled={!ready} aria-label="확대">
          확대
        </button>
        <button type="button" className="btn" onClick={handleZoomOut} disabled={!ready} aria-label="축소">
          축소
        </button>
        <button type="button" className="btn" onClick={handleFit} disabled={!ready}>
          화면 맞춤
        </button>
      </div>

      {pendingDeleteId && (
        <div className="confirm-delete">
          <p>{deleteConfirmMessage(nodes, pendingDeleteId)}</p>
          <button type="button" className="btn btn-danger" onClick={confirmDelete}>
            삭제 확정
          </button>
          <button type="button" className="btn" onClick={() => setPendingDeleteId(null)}>
            취소
          </button>
        </div>
      )}

      {/* 두 손가락 확대/이동(핀치 줌) 제스처: 설치된 mind-elixir-core 6.0.1 번들에는 터치 이벤트
          처리가 없어 미지원으로 확인됨. 위 확대/축소/화면 맞춤 버튼으로 대체 제공.
          ponytail: 터치 핀치가 꼭 필요해지면 별도 제스처 라이브러리 없이 pointer 이벤트 2개를
          직접 추적해 scale()을 호출하는 방식으로 추가. */}
      <div ref={containerRef} className="mindmap-canvas" aria-label="마인드맵" />
    </div>
  );
}
