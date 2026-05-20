import React from "react";
import { useAppStore } from "../store/appStore";

export default function TopBar() {
  const { ollamaStatus, bots } = useAppStore();
  const onlineBots = bots.filter((b) => b.status === "online").length;
  const hasAndy = bots.some(b => (b.config.aiModel || "").toLowerCase().includes("andy"));

  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "0 14px", minHeight: 38,
      background: "linear-gradient(90deg, #050810 0%, #080c1a 100%)",
      borderBottom: "1px solid #1a2040",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
          <polygon points="10,1 18,7 14,19 6,19 2,7" fill="#00c8ff" opacity="0.65"/>
          <polygon points="10,1 18,7 10,5" fill="#00e8ff" opacity="0.9"/>
          <polygon points="10,1 2,7 10,5" fill="#007aaa" opacity="0.8"/>
          <polygon points="10,5 18,7 14,19 6,19 2,7" fill="#008faa" opacity="0.4"/>
          <polygon points="10,5 14,19 10,14" fill="#00c8ff" opacity="0.35"/>
          <polygon points="10,5 6,19 10,14" fill="#006688" opacity="0.4"/>
        </svg>
        <span style={{
          color: "#00c8ff", fontFamily: "monospace", fontWeight: "bold",
          fontSize: 13, letterSpacing: "0.04em",
          textShadow: "0 0 12px rgba(0,200,255,.5)",
        }}>
          Prismarine Bot
        </span>
        <span style={{ color: "#1a2a40", fontSize: 10, fontFamily: "monospace" }}>v4.1.4</span>
        {hasAndy && (
          <span style={{
            fontSize: 9, background: "rgba(0,200,255,.06)",
            border: "1px solid rgba(0,200,255,.25)",
            color: "#00c8ff", borderRadius: 3, padding: "1px 5px",
          }}>Andy-4</span>
        )}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 18, fontSize: 11 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{
            width: 6, height: 6, borderRadius: "50%", display: "inline-block",
            background: onlineBots > 0 ? "#00ff9d" : "#1a2a3a",
            boxShadow: onlineBots > 0 ? "0 0 7px #00ff9d" : "none",
          }} />
          <span style={{ color: onlineBots > 0 ? "#00ff9d" : "#2a3a5a", fontFamily: "monospace" }}>
            Ботов: {onlineBots}/{bots.length}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{
            width: 6, height: 6, borderRadius: "50%", display: "inline-block",
            background: ollamaStatus?.running ? "#00c8ff" : "#ff2255",
            boxShadow: ollamaStatus?.running ? "0 0 7px #00c8ff" : "none",
          }} />
          <span style={{ color: ollamaStatus?.running ? "#00c8ff" : "#3a4a6a", fontFamily: "monospace" }}>
            Ollama: {ollamaStatus?.running ? "активна" : "выкл"}
          </span>
        </div>
      </div>
    </div>
  );
}
