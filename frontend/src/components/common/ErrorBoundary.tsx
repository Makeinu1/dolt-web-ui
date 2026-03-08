import { Component } from "react";
import type { ReactNode, ErrorInfo } from "react";

interface Props {
    children: ReactNode;
}

interface State {
    hasError: boolean;
    error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
    constructor(props: Props) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, info: ErrorInfo) {
        console.error("ErrorBoundary caught:", error, info.componentStack);
    }

    render() {
        if (this.state.hasError) {
            return (
                <div style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    height: "100vh",
                    gap: 16,
                    fontFamily: "sans-serif",
                    color: "#1e293b",
                }}>
                    <div style={{ fontSize: 32 }}>⚠</div>
                    <h2 style={{ margin: 0, fontSize: 18 }}>予期しないエラーが発生しました</h2>
                    <p style={{ margin: 0, fontSize: 13, color: "#64748b" }}>
                        {this.state.error?.message ?? "不明なエラー"}
                    </p>
                    <button
                        onClick={() => window.location.reload()}
                        style={{ fontSize: 13, padding: "6px 20px", cursor: "pointer" }}
                    >
                        ページを再読み込み
                    </button>
                </div>
            );
        }
        return this.props.children;
    }
}
