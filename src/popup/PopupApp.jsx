import { useEffect, useState } from "react";

const cardStyle = {
  fontFamily: "ui-sans-serif, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
  width: 330,
  padding: 16,
  background: "linear-gradient(180deg, #f8fafc 0%, #ffffff 60%)",
  color: "#0f172a",
};

export default function PopupApp() {
  const [status, setStatus] = useState({
    loading: true,
    active: false,
    sessionToken: "",
    startedAt: 0,
  });

  const refresh = () => {
    setStatus((prev) => ({ ...prev, loading: true }));
    chrome.runtime.sendMessage({ type: "AIPX_STATUS", payload: {} }, (res) => {
      const next = res?.payload || {};
      setStatus({
        loading: false,
        active: !!next.active,
        sessionToken: next.sessionToken || "",
        startedAt: next.startedAt || 0,
      });
    });
  };

  useEffect(() => {
    refresh();
  }, []);

  return (
    <div style={cardStyle}>
      <h1 style={{ margin: 0, fontSize: 16, fontWeight: 800 }}>AI Interview Guard</h1>
      <p style={{ marginTop: 6, fontSize: 12, color: "#475569" }}>
        Keeps interview tab lockdown active while interview is running.
      </p>
      <div
        style={{
          marginTop: 12,
          padding: 10,
          borderRadius: 12,
          background: status.active ? "#dcfce7" : "#f1f5f9",
          border: `1px solid ${status.active ? "#86efac" : "#cbd5e1"}`,
        }}
      >
        <div style={{ fontSize: 12, fontWeight: 700 }}>
          {status.loading
            ? "Checking extension status..."
            : status.active
              ? "Lockdown is active"
              : "Lockdown is idle"}
        </div>
        {!status.loading && status.active && (
          <div style={{ marginTop: 8, fontSize: 11, color: "#166534" }}>
            Session: {status.sessionToken.slice(0, 10)}...
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={refresh}
        style={{
          marginTop: 12,
          width: "100%",
          height: 36,
          borderRadius: 10,
          border: "1px solid #cbd5e1",
          background: "#ffffff",
          color: "#0f172a",
          fontWeight: 700,
          cursor: "pointer",
        }}
      >
        Refresh Status
      </button>
    </div>
  );
}
