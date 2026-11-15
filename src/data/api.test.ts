import { describe, expect, it } from 'vitest';
import { classifyError } from './api';

describe('classifyError', () => {
  it('TypeError(fetch 실패)는 network', () => {
    expect(classifyError(new TypeError('Failed to fetch')).kind).toBe('network');
  });

  it('AbortError는 network', () => {
    expect(classifyError(new DOMException('aborted', 'AbortError')).kind).toBe('network');
  });

  it('HTTP 401은 auth', () => {
    expect(classifyError({ status: 401, message: 'JWT expired' }).kind).toBe('auth');
  });

  it('PGRST301(JWT 만료)은 auth', () => {
    expect(classifyError({ code: 'PGRST301', message: 'JWT expired' }).kind).toBe('auth');
  });

  it('42501은 forbidden', () => {
    expect(classifyError({ code: '42501', message: '내 책이 아닙니다' }).kind).toBe('forbidden');
  });

  it('22023은 validation', () => {
    expect(classifyError({ code: '22023', message: '검증 실패' }).kind).toBe('validation');
  });

  it('23514(체크 제약 위반)은 validation', () => {
    expect(classifyError({ code: '23514', message: '제약 위반' }).kind).toBe('validation');
  });

  it('P0002는 not_found', () => {
    expect(classifyError({ code: 'P0002', message: '책을 찾을 수 없습니다' }).kind).toBe('not_found');
  });

  it('알 수 없는 코드는 unknown이지만 메시지는 보존', () => {
    const r = classifyError({ message: '이상한 오류' });
    expect(r.kind).toBe('unknown');
    expect(r.message).toBe('이상한 오류');
  });

  it('아무 정보 없는 값도 unknown으로 떨어짐(메시지는 한국어 기본값)', () => {
    expect(classifyError(null).kind).toBe('unknown');
    expect(classifyError(undefined).kind).toBe('unknown');
  });
});
