import { describe, expect, it } from 'vitest';
import { xmindExampleBook, xmindExampleNodes } from './xmindExample';
import { mergeLocalImport } from './demoStorage';
import { diffBackup, parseBackupFile, type Backup, type Snapshot } from '../features/backup/backup';

const now = '2026-11-15T01:00:00.000Z';
function snapshot(): Snapshot {
  return {
    books: [{ ...xmindExampleBook, user_id: 'demo' }],
    mindmaps: [{ book_id: xmindExampleBook.id, user_id: 'demo', version: 4,
      updated_at: now, data: { nodes: structuredClone(xmindExampleNodes) } }],
  };
}
function file(): Backup {
  const parsed = parseBackupFile(JSON.stringify(snapshot()));
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.backup;
}

describe('데모 JSON 가져오기', () => {
  it('새 책과 맵을 추가하고 파일의 소유자·버전·시각을 그대로 쓰지 않는다', () => {
    const current: Snapshot = { books: [], mindmaps: [] };
    const backup = file();
    backup.books[0].user_id = 'foreign-owner';
    const result = mergeLocalImport(current, diffBackup(backup, current), now);
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.snapshot.books[0].user_id).toBe('demo');
    expect(result.snapshot.books[0].created_at).toBe(now);
    expect(result.snapshot.mindmaps[0].version).toBe(1);
    expect(result.snapshot.mindmaps[0].data.nodes).toEqual(xmindExampleNodes);
    expect(current.books).toHaveLength(0);
  });

  it('내용이 같은 파일은 중복 추가하거나 버전을 올리지 않는다', () => {
    const current = snapshot();
    const diff = diffBackup(file(), current);
    expect(diff.sameCount).toBe(1);
    const result = mergeLocalImport(current, diff, now);
    if (result.status !== 'ok') throw new Error('unexpected conflict');
    expect(result.snapshot).toEqual(current);
  });

  it('기존 책을 변경하되 파일에 없는 책과 맵은 유지한다', () => {
    const current = snapshot();
    const untouchedBook = { ...xmindExampleBook, id: 'keep' };
    const untouchedMap = { ...current.mindmaps[0], book_id: 'keep' };
    current.books.push(untouchedBook);
    current.mindmaps.push(untouchedMap);
    const backup = file();
    backup.mindmaps[0].data.nodes[1].text = '수정한 가지';
    const result = mergeLocalImport(current, diffBackup(backup, current), now);
    if (result.status !== 'ok') throw new Error('unexpected conflict');
    expect(result.snapshot.books).toHaveLength(2);
    expect(result.snapshot.mindmaps[0].version).toBe(5);
    expect(result.snapshot.mindmaps[0].data.nodes[1].text).toBe('수정한 가지');
    expect(result.snapshot.books[1]).toEqual(untouchedBook);
    expect(result.snapshot.mindmaps[1]).toEqual(untouchedMap);
    expect(current.mindmaps[0].data.nodes[1].text).toBe('Main Topic 1');
  });

  it('미리보기 후 책 수정 시 전체 적용을 거부한다', () => {
    const current = snapshot();
    const backup = file();
    backup.books[0].author = '변경';
    const diff = diffBackup(backup, current);
    current.books[0].updated_at = now;
    const before = structuredClone(current);
    expect(mergeLocalImport(current, diff, now).status).toBe('conflict');
    expect(current).toEqual(before);
  });

  it('미리보기 후 맵 수정 또는 책 삭제 시 전체 적용을 거부한다', () => {
    const current = snapshot();
    const backup = file();
    backup.books[0].author = '변경';
    const diff = diffBackup(backup, current);
    current.mindmaps[0].version++;
    expect(mergeLocalImport(current, diff, now).status).toBe('conflict');
    current.books = [];
    expect(mergeLocalImport(current, diff, now).status).toBe('conflict');
  });

  it('추가 예정인 책이 다른 창에서 이미 생겼으면 중복 생성하지 않는다', () => {
    const current = snapshot();
    const diff = diffBackup(file(), { books: [], mindmaps: [] });
    expect(mergeLocalImport(current, diff, now).status).toBe('conflict');
  });
});
describe('메모·글씨색 백업 왕복', () => {
  function withExtras(): Snapshot {
    const s = snapshot();
    s.mindmaps[0].data.nodes = s.mindmaps[0].data.nodes.map((n, i) =>
      i === 1 ? { ...n, note: '메모 <script>x</script>', textColor: '#1d4ed8' } : n,
    );
    return s;
  }

  it('내보낸 파일을 다시 읽으면 메모·글씨색이 그대로 남고 가져오기에 반영된다', () => {
    const exported = withExtras();
    const parsed = parseBackupFile(JSON.stringify(exported));
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.backup.mindmaps[0].data.nodes).toEqual(exported.mindmaps[0].data.nodes);

    const current = snapshot();
    const diff = diffBackup(parsed.backup, current);
    expect(diff.sameCount).toBe(0);
    const result = mergeLocalImport(current, diff, now);
    if (result.status !== 'ok') throw new Error('unexpected conflict');
    expect(result.snapshot.mindmaps[0].data.nodes).toEqual(exported.mindmaps[0].data.nodes);
  });

  it('글씨색 형식이 틀린 백업 파일은 거부한다', () => {
    const bad = withExtras();
    bad.mindmaps[0].data.nodes[1].textColor = 'javascript:alert(1)';
    expect(parseBackupFile(JSON.stringify(bad)).ok).toBe(false);
  });
});
