import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback?: (error: Error, reset: () => void) => ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * ErrorBoundary — DiffGrid などの AG Grid コンポーネントで発生する
 * 予期せぬ JS エラー（null 参照など）をキャッチし、ホワイトアウトを防ぐ。
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary] Caught error:", error, info.componentStack);
  }

  reset = () => {
    this.setState({ error: null });
  };

  render() {
    const { error } = this.state;
    const { children, fallback } = this.props;

    if (error) {
      if (fallback) return fallback(error, this.reset);
      return (
        <div
          style={{
            padding: "16px",
            background: "#fee2e2",
            border: "1px solid #fca5a5",
            borderRadius: 6,
            fontSize: 13,
            color: "#991b1b",
          }}
        >
          <strong>表示エラーが発生しました</strong>
          <div style={{ marginTop: 8, fontSize: 11, fontFamily: "monospace", whiteSpace: "pre-wrap" }}>
            {error.message}
          </div>
          <button
            onClick={this.reset}
            style={{
              marginTop: 10,
              padding: "4px 12px",
              background: "#991b1b",
              color: "#fff",
              border: "none",
              borderRadius: 4,
              cursor: "pointer",
              fontSize: 12,
            }}
          >
            再読み込み
          </button>
        </div>
      );
    }

    return children;
  }
}
