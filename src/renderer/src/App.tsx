import React, { useEffect, useState, Component } from "react";
import { useAppStore } from "./store/appStore";
import MainLayout from "./components/MainLayout";
import OllamaSetup from "./components/OllamaSetup";
import LoadingScreen from "./components/LoadingScreen";

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
    if (this.state.error) {
      return (
        <div style={{
          flex: 1, display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center", gap: 12,
          background: "#060810", color: "#ff4466", fontFamily: "monospace",
          padding: 32,
        }}>
          <div style={{ fontSize: 32 }}>⚠️</div>
          <div style={{ fontSize: 14, fontWeight: "bold" }}>Ошибка интерфейса</div>
          <div style={{ fontSize: 11, color: "#2a3a5a", maxWidth: 400, textAlign: "center", wordBreak: "break-word" }}>
            {this.state.error.message}
          </div>
          <button
            style={{
              marginTop: 8, padding: "6px 18px", background: "none",
              border: "1px solid #ff4466", borderRadius: 4,
              color: "#ff4466", cursor: "pointer", fontFamily: "monospace", fontSize: 12,
            }}
            onClick={() => this.setState({ error: null })}
          >
            Восстановить
          </button>
        </div>
      );
    }
    return this.props.children;
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
      <MainLayout />
    </ErrorBoundary>
  );
}
