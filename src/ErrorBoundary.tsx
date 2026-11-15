import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

/** 렌더링 중 던져진 예외를 잡아 화면 전체가 하얗게 비는 대신 안내를 보여준다. 오류 내용은 콘솔에만 남긴다. */
export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error('화면을 그리는 중 오류가 발생했습니다:', error, info.componentStack);
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="editor-page">
          <h1>독서노트</h1>
          <p className="field-error">화면을 표시하는 중 문제가 생겼습니다.</p>
          <p>저장되지 않은 마인드맵 초안은 이 브라우저에 보존됩니다.</p>
          <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
            새로고침
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
