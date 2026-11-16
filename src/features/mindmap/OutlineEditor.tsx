import { useState, type ChangeEvent } from 'react';
import type { MindmapNode } from '../../types';
import {
  addChild,
  addSibling,
  deleteBranch,
  deleteConfirmMessage,
  needsDeleteConfirm,
  setColor,
  setText,
  toggleCollapsed,
} from './model';

interface OutlineEditorProps {
  nodes: MindmapNode[];
  onChange: (nodes: MindmapNode[]) => void;
  readOnly?: boolean;
}

interface Row {
  node: MindmapNode;
  depth: number;
  hasChildren: boolean;
}

// 깊은 들여쓰기가 360px 화면을 밀어내지 않도록 들여쓰기 폭에 상한을 둔다.
const MAX_INDENT_DEPTH = 8;
const INDENT_PX = 16;

function buildRows(nodes: MindmapNode[]): Row[] {
  const childrenOf = new Map<string, MindmapNode[]>();
  for (const n of nodes) {
    if (n.parentId === null) continue;
    const arr = childrenOf.get(n.parentId) ?? [];
    arr.push(n);
    childrenOf.set(n.parentId, arr);
  }
  for (const arr of childrenOf.values()) arr.sort((a, b) => a.order - b.order);

  const root = nodes.find((n) => n.parentId === null);
  const rows: Row[] = [];
  if (!root) return rows;

  function visit(node: MindmapNode, depth: number) {
    const kids = childrenOf.get(node.id) ?? [];
    rows.push({ node, depth, hasChildren: kids.length > 0 });
    if (node.collapsed) return;
    for (const kid of kids) visit(kid, depth + 1);
  }
  visit(root, 0);
  return rows;
}

export default function OutlineEditor({ nodes, onChange, readOnly = false }: OutlineEditorProps) {
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const rows = buildRows(nodes);

  function handleTextChange(id: string, value: string) {
    onChange(setText(nodes, id, value));
  }
  function handleToggle(id: string) {
    onChange(toggleCollapsed(nodes, id));
  }
  function handleAddChild(id: string) {
    onChange(addChild(nodes, id));
  }
  function handleAddSibling(id: string) {
    onChange(addSibling(nodes, id));
  }
  function handleColor(id: string, color: string) {
    onChange(setColor(nodes, id, color));
  }
  function handleDeleteClick(id: string) {
    if (needsDeleteConfirm(nodes, id)) {
      setPendingDeleteId(id);
    } else {
      onChange(deleteBranch(nodes, id));
    }
  }
  function confirmDelete() {
    if (!pendingDeleteId) return;
    onChange(deleteBranch(nodes, pendingDeleteId));
    setPendingDeleteId(null);
  }

  return (
    <div className="outline-editor">
      <ul className="outline-list">
        {rows.map(({ node, depth, hasChildren }) => {
          const isRoot = node.parentId === null;
          return (
            <li
              key={node.id}
              className="outline-row"
              style={{ paddingLeft: `${Math.min(depth, MAX_INDENT_DEPTH) * INDENT_PX}px` }}
            >
              <button
                type="button"
                className="btn outline-toggle"
                onClick={() => handleToggle(node.id)}
                disabled={readOnly || !hasChildren}
                aria-label={node.collapsed ? '펼치기' : '접기'}
              >
                {hasChildren ? (node.collapsed ? '▶' : '▼') : '·'}
              </button>
              <label className="outline-text-field">
                <span className="visually-hidden">{isRoot ? '중심 노드 글(책 제목)' : '노드 글'}</span>
                <textarea
                  value={node.text}
                  readOnly={isRoot || readOnly}
                  rows={Math.max(1, node.text.split('\n').length)}
                  onChange={(e: ChangeEvent<HTMLTextAreaElement>) => handleTextChange(node.id, e.target.value)}
                  onFocus={(e) => e.currentTarget.scrollIntoView({ block: 'nearest' })}
                  style={{ borderColor: node.color }}
                />
              </label>
              <div className="outline-row-actions">
                <input
                  type="color"
                  value={node.color}
                  onChange={(e) => handleColor(node.id, e.target.value)}
                  disabled={readOnly}
                  aria-label={`${node.text || '노드'} 색상`}
                />
                <button
                  type="button"
                  className="btn"
                  onClick={() => handleAddChild(node.id)}
                  disabled={readOnly}
                >
                  자식 추가
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => handleAddSibling(node.id)}
                  disabled={readOnly || isRoot}
                >
                  형제 추가
                </button>
                <button
                  type="button"
                  className="btn btn-danger outline-delete"
                  onClick={() => handleDeleteClick(node.id)}
                  disabled={readOnly || isRoot}
                >
                  삭제
                </button>
              </div>
              {pendingDeleteId === node.id && (
                <div className="confirm-delete">
                  <p>{deleteConfirmMessage(nodes, node.id)}</p>
                  <button type="button" className="btn btn-danger" onClick={confirmDelete}>
                    삭제 확정
                  </button>
                  <button type="button" className="btn" onClick={() => setPendingDeleteId(null)}>
                    취소
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
