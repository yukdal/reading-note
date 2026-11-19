import { useEffect, useRef, useState } from 'react';
import type { MindmapNode } from '../../types';

export type SaveResult =
  | { status: 'ok'; version: number; updated_at: string }
  | { status: 'conflict'; version: number; updated_at: string };

export type SaveFn = (nodes: MindmapNode[], expectedVersion: number) => Promise<SaveResult>;

export type SaveState = 'saved' | 'pending' | 'saving' | 'error' | 'conflict';

const DEBOUNCE_MS = 1000;

/**
 * React와 분리된 디바운스/직렬화 로직. 변경 → 1초 대기 → 저장 요청(동시에 1개만).
 * 저장 중 들어온 변경은 draft에 쌓이고, 저장이 끝나면 바로 다음 요청으로 이어진다.
 * 충돌(conflict) 응답을 받으면 draft는 유지한 채 더 이상 자동으로 요청하지 않는다.
 */
export class Autosaver {
  private readonly save: SaveFn;
  private readonly onState: (state: SaveState, version?: number) => void;
  private readonly delayMs: number;
  private draft: MindmapNode[] | null = null;
  private version: number;
  private saving = false;
  private disposed = false;
  private stopped = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    save: SaveFn,
    initialVersion: number,
    onState: (state: SaveState, version?: number) => void,
    delayMs: number = DEBOUNCE_MS,
  ) {
    this.save = save;
    this.onState = onState;
    this.delayMs = delayMs;
    this.version = initialVersion;
  }

  notifyChange(nodes: MindmapNode[]): void {
    this.draft = nodes;
    if (this.disposed || this.stopped) return; // 충돌 이후: draft는 갱신하되 더 이상 자동 저장하지 않음
    this.onState('pending');
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), this.delayMs);
  }

  /** 저장 실패 후 재시도. */
  retry(): void {
    if (this.disposed || this.stopped) return;
    if (this.timer) clearTimeout(this.timer);
    this.flush();
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private flush(): void {
    this.timer = null;
    if (this.disposed || this.saving || this.stopped || this.draft === null) return;
    const toSave = this.draft;
    this.saving = true;
    this.onState('saving');
    this.save(toSave, this.version).then(
      (result) => {
        if (this.disposed) return;
        this.saving = false;
        if (result.status === 'conflict') {
          this.stopped = true;
          this.onState('conflict', result.version);
          return;
        }
        this.version = result.version;
        if (this.draft === toSave) {
          this.draft = null;
          this.onState('saved', result.version);
        } else {
          // 저장 중 새 변경이 쌓임 → draft를 지우지 않고 바로 다음 요청으로 이어감
          this.onState('saving', result.version); // 이어 저장 전에 화면 쪽 기준 버전도 갱신
          this.flush();
        }
      },
      () => {
        if (this.disposed) return;
        this.saving = false;
        this.onState('error');
      },
    );
  }
}

export interface UseAutosaveResult {
  state: SaveState;
  version: number;
  retry: () => void;
}

/** nodes가 바뀔 때마다(최초 마운트 시의 값은 제외) save를 디바운스·직렬화하여 호출한다. */
export function useAutosave(
  nodes: MindmapNode[], save: SaveFn, initialVersion: number, saveInitially = false,
): UseAutosaveResult {
  const [state, setState] = useState<SaveState>(saveInitially ? 'pending' : 'saved');
  const [version, setVersion] = useState(initialVersion);
  const saverRef = useRef<Autosaver | null>(null);
  const lastNodesRef = useRef(nodes);

  useEffect(() => {
    const saver = new Autosaver(save, initialVersion, (s, v) => {
      setState(s);
      if (v !== undefined) setVersion(v);
    });
    saverRef.current = saver;
    if (saveInitially) saver.notifyChange(lastNodesRef.current);
    return () => {
      saver.dispose();
      saverRef.current = null;
    };
    // 저장 함수는 편집기 수명 동안 고정된다. 저장 성공으로 바뀐 버전으로 재생성하지 않는다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [save]);

  useEffect(() => {
    if (lastNodesRef.current === nodes) return;
    lastNodesRef.current = nodes;
    saverRef.current?.notifyChange(nodes);
  }, [nodes]);

  return { state, version, retry: () => saverRef.current?.retry() };
}