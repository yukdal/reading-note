import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MindmapNode } from '../../types';
import { Autosaver, type SaveFn, type SaveState } from './useAutosave';

function nodes(text: string): MindmapNode[] {
  return [{ id: 'root', parentId: null, text, color: '#111111', collapsed: false, order: 0 }];
}

describe('Autosaver', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('변경 후 1초가 지나야 저장을 호출한다', async () => {
    const save = vi.fn<SaveFn>().mockResolvedValue({ status: 'ok', version: 1, updated_at: 't' });
    const states: SaveState[] = [];
    const autosaver = new Autosaver(save, 0, (s) => states.push(s));

    autosaver.notifyChange(nodes('a'));
    expect(save).not.toHaveBeenCalled();
    expect(states).toEqual(['pending']);

    await vi.advanceTimersByTimeAsync(999);
    expect(save).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledTimes(1);
    expect(states).toEqual(['pending', 'saving', 'saved']);
  });

  it('저장 중 입력을 이어도 최신 변경이 다음 요청에 반영되고 초안이 조기 삭제되지 않음', async () => {
    const calls: MindmapNode[][] = [];
    const impls: Array<() => Promise<{ status: 'ok'; version: number; updated_at: string }>> = [];
    const realSave: SaveFn = (n) => {
      calls.push(n);
      return new Promise((resolve) => {
        impls.push(async () => {
          const v = calls.length;
          resolve({ status: 'ok', version: v, updated_at: `t${v}` });
          return { status: 'ok', version: v, updated_at: `t${v}` };
        });
      });
    };

    const autosaver = new Autosaver(realSave, 0, () => {});
    autosaver.notifyChange(nodes('a'));
    await vi.advanceTimersByTimeAsync(1000);
    expect(calls).toHaveLength(1);
    expect(calls[0][0].text).toBe('a');

    // 첫 저장이 아직 진행 중인 상태에서 추가 편집
    autosaver.notifyChange(nodes('b'));
    await vi.advanceTimersByTimeAsync(1000);
    // 저장 중이므로 두 번째 요청은 아직 나가지 않았어야 함
    expect(calls).toHaveLength(1);

    // 첫 저장을 완료시키면 바로 최신 draft('b')로 다음 요청이 나간다
    await impls[0]();
    await Promise.resolve();
    await Promise.resolve();
    expect(calls).toHaveLength(2);
    expect(calls[1][0].text).toBe('b');
  });

  it('저장 중 변경이 쌓이면 이어 저장 전에 새 버전을 알린다', async () => {
    const resolvers: Array<(v: number) => void> = [];
    const events: string[] = [];
    const save: SaveFn = () => new Promise((resolve) => {
      events.push('save');
      resolvers.push((v) => resolve({ status: 'ok', version: v, updated_at: 't' }));
    });
    const autosaver = new Autosaver(save, 0, (s, v) => events.push(`${s}:${v ?? ''}`));
    autosaver.notifyChange(nodes('a'));
    await vi.advanceTimersByTimeAsync(1000);
    autosaver.notifyChange(nodes('b'));
    resolvers[0](5);
    await vi.advanceTimersByTimeAsync(0);
    expect(events.indexOf('saving:5')).toBeGreaterThan(-1);
    expect(events.indexOf('saving:5')).toBeLessThan(events.lastIndexOf('save'));
    expect(events.filter((e) => e === 'save')).toHaveLength(2);
  });

  it('저장 중에는 동시에 두 번째 요청을 보내지 않는다', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const save: SaveFn = async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Promise.resolve();
      inFlight--;
      return { status: 'ok', version: 1, updated_at: 't' };
    };
    const autosaver = new Autosaver(save, 0, () => {});
    autosaver.notifyChange(nodes('a'));
    await vi.advanceTimersByTimeAsync(1000);
    autosaver.notifyChange(nodes('b'));
    await vi.advanceTimersByTimeAsync(1000);
    await vi.runAllTimersAsync();
    expect(maxInFlight).toBeLessThanOrEqual(1);
  });

  it('충돌 응답을 받으면 자동 저장을 멈춘다', async () => {
    const save = vi.fn<SaveFn>().mockResolvedValue({ status: 'conflict', version: 9, updated_at: 't' });
    const states: SaveState[] = [];
    const autosaver = new Autosaver(save, 0, (s) => states.push(s));

    autosaver.notifyChange(nodes('a'));
    await vi.advanceTimersByTimeAsync(1000);
    expect(states.at(-1)).toBe('conflict');
    expect(save).toHaveBeenCalledTimes(1);

    autosaver.notifyChange(nodes('b'));
    await vi.advanceTimersByTimeAsync(5000);
    // 충돌 이후에는 draft가 갱신되어도 다시 저장을 시도하지 않는다
    expect(save).toHaveBeenCalledTimes(1);
  });
});

describe('Autosaver 수명주기', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('편집기를 닫으면 대기 중이던 예전 내용은 전송하지 않는다', async () => {
    const save = vi.fn<SaveFn>().mockResolvedValue({ status: 'ok', version: 1, updated_at: 't' });
    const saver = new Autosaver(save, 0, () => {});
    saver.notifyChange(nodes('이전 내용'));
    saver.dispose();
    await vi.runAllTimersAsync();
    expect(save).not.toHaveBeenCalled();
  });

  it('이미 전송한 저장이 끝나도 닫힌 편집기에서 다음 요청이나 상태 갱신을 하지 않는다', async () => {
    let finish!: (value: Awaited<ReturnType<SaveFn>>) => void;
    const save = vi.fn<SaveFn>().mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const states: SaveState[] = [];
    const saver = new Autosaver(save, 0, (state) => states.push(state));
    saver.notifyChange(nodes('첫 요청'));
    await vi.advanceTimersByTimeAsync(1000);
    saver.notifyChange(nodes('다음 요청'));
    saver.dispose();
    const before = [...states];
    finish({ status: 'ok', version: 1, updated_at: 't' });
    await vi.runAllTimersAsync();
    expect(save).toHaveBeenCalledTimes(1);
    expect(states).toEqual(before);
  });
});