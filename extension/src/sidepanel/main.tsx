import React from "react";
import ReactDOM from "react-dom/client";
import SidePanel from "./SidePanel";

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("[PIXEL NOVA] UI Crash caught by ErrorBoundary:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          padding: "24px 16px",
          color: "#f87171",
          fontFamily: "'Plus Jakarta Sans', sans-serif",
          background: "#09090b",
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          gap: "14px",
          justifyContent: "center",
          alignItems: "center",
          textAlign: "center"
        }}>
          <div style={{ fontSize: "32px" }}>🛡️</div>
          <h3 style={{ color: "#fca5a5", margin: 0, fontSize: "15px", fontWeight: 700 }}>
            PIXEL NOVA Interface Safeguard
          </h3>
          <p style={{ color: "#a1a1aa", fontSize: "12px", margin: 0, maxWidth: "280px", lineHeight: 1.5 }}>
            A rendering exception was safely caught. Your privacy protections and on-device vault remain intact.
          </p>
          <div style={{
            background: "rgba(255,255,255,0.05)",
            border: "1px solid rgba(255,255,255,0.1)",
            padding: "8px 12px",
            borderRadius: "6px",
            fontSize: "11px",
            fontFamily: "monospace",
            maxWidth: "95%",
            wordBreak: "break-all",
            color: "#e4e4e7"
          }}>
            {this.state.error?.message || "Unknown rendering error"}
          </div>
          <button
            onClick={() => {
              this.setState({ hasError: false, error: null });
              window.location.reload();
            }}
            style={{
              padding: "8px 16px",
              background: "#27272a",
              border: "1px solid rgba(255,255,255,0.25)",
              borderRadius: "6px",
              color: "#fff",
              cursor: "pointer",
              fontSize: "12px",
              fontWeight: 600
            }}
          >
            ↻ Reload Side Panel
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(
  document.getElementById("root")!
).render(
  <React.StrictMode>
    <ErrorBoundary>
      <SidePanel />
    </ErrorBoundary>
  </React.StrictMode>
);