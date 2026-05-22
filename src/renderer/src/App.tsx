import React, { useEffect, useState, Component } from "react";
import { useAppStore } from "./store/appStore";
import MainLayout from "./components/MainLayout";
import OllamaSetup from "./components/OllamaSetup";
import LoadingScreen from "./components/LoadingScreen";
import UpdateBanner from "./components/UpdateBanner";

class ErrorBoundary extends Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[ErrorBoundary] React crash caught:", error, info);
  }

  render() {
    const { error } = this.state;
    return (
      <div style={{ position: "relative", display: "flex", flex: 1, overflow: "hidden" }}>
        {this.props.children}
        {error && (
          <div style={{
            position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 9999,
            background: "rgba(20,6,8,.97)", borderTop: "1px solid #ff3344",
            padding: "6px 14px", display: "flex", alignItems: "center", gap: 10,
            fontFamily: "monospace", fontSize: 11,
          }}>
            <span style={{ color: "#ff4466" }}>⚠</span>
            <span style={{ color: "#ff6677", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {error.message}
            </span>
            <button
              style={{
                padding: "2px 10px", background: "none", border: "1px solid #ff3344",
                borderRadius: 3, color: "#ff4466", cursor: "pointer",
                fontFamily: "monospace", fontSize: 11, flexShrink: 0,
              }}
              onClick={() => this.setState({ error: null })}
            >
              ✕
            </button>
          </div>
        )}
      </div>
    );
  }
}

export default function App() {
  const { ollamaStatus, setOllamaStatus, loadBots, loadConfig } = useAppStore();
  const [loading, setLoading] = useState(true);
  const [needsSetup, setNeedsSetup] = useState(false);

  useEffect(() => {
    async function init() {
      await loadConfig();
      await loadBots();
      const status = await window.electronAPI.ollama.check();
      setOllamaStatus(status);
      if (!status.installed || !status.running) setNeedsSetup(true);
      setLoading(false);
    }
    init();

    const unsubs = [
      window.electronAPI.on("bot:created", (d) => useAppStore.getState().onBotCreated(d)),
      window.electronAPI.on("bot:deleted", (d) => useAppStore.getState().onBotDeleted(d)),
      window.electronAPI.on("bot:statusChanged", (d) => useAppStore.getState().onBotStatusChanged(d)),
      window.electronAPI.on("bot:statsUpdated", (d) => useAppStore.getState().onBotStatsUpdated(d)),
      window.electronAPI.on("bot:chat", (d) => useAppStore.getState().onBotChat(d)),
      window.electronAPI.on("bot:serverMessage", (d) => useAppStore.getState().onBotServerMessage(d)),
      window.electronAPI.on("bot:aiMessage", (d) => useAppStore.getState().onBotAiMessage(d)),
      window.electronAPI.on("bot:aiChatMessage", (d) => useAppStore.getState().onBotAiChatMessage(d)),
      window.electronAPI.on("bot:death", (d) => useAppStore.getState().onBotDeath(d)),
      window.electronAPI.on("bot:error", (d) => useAppStore.getState().onBotError(d)),
      window.electronAPI.on("bot:inventoryUpdated", (d) => useAppStore.getState().onInventoryUpdated(d)),
      window.electronAPI.on("bot:survivorLog", (d) => useAppStore.getState().onSurvivorLog(d)),
      window.electronAPI.on("bot:survivorStarted", (d) => useAppStore.getState().onSurvivorStarted(d)),
      window.electronAPI.on("bot:survivorStopped", (d) => useAppStore.getState().onSurvivorStopped(d)),
      window.electronAPI.on("bot:aiToggled", (d) => useAppStore.getState().onAiToggled(d)),
      window.electronAPI.on("ollama:pullProgress", (d) => useAppStore.getState().onPullProgress(d)),
      window.electronAPI.on("coordinator:groupChat", (d) => useAppStore.getState().onGroupChat(d)),
    ];

    return () => unsubs.forEach((u) => u?.());
  }, []);

  if (loading) return <LoadingScreen />;
  if (needsSetup && !ollamaStatus?.running) return <OllamaSetup onComplete={() => setNeedsSetup(false)} />;
  return (
    <ErrorBoundary>
      <UpdateBanner />
      <MainLayout />
    </ErrorBoundary>
  );
}
