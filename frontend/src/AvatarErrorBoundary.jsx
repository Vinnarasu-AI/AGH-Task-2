import React from "react";
import { AlertCircle, RefreshCw } from "lucide-react";

export class AvatarErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("AvatarErrorBoundary caught an error:", error, errorInfo);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            width: "100%",
            height: "100%",
            minHeight: "480px",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            background: "#0f172a",
            borderRadius: "16px",
            padding: "24px",
            textAlign: "center",
            color: "#f1f5f9",
          }}
        >
          <AlertCircle size={44} color="#f87171" style={{ marginBottom: "12px" }} />
          <h3 style={{ margin: "0 0 8px 0", fontSize: "16px", fontWeight: 600 }}>
            Avatar Rendering Notice
          </h3>
          <p style={{ margin: "0 0 16px 0", fontSize: "13px", color: "#94a3b8", maxWidth: "340px" }}>
            {this.state.error?.message || "An issue occurred initializing the 3D graphics context."}
          </p>
          <button
            onClick={this.handleRetry}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              padding: "8px 16px",
              background: "#2563eb",
              color: "#ffffff",
              border: "none",
              borderRadius: "8px",
              fontSize: "13px",
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            <RefreshCw size={14} /> Retry Avatar
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

export default AvatarErrorBoundary;
