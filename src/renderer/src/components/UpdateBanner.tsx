import React, { useState, useEffect } from "react";

interface UpdateInfo {
  version: string;
  releaseNotes?: string;
}

interface DownloadProgress {
  percent: number;
  bytesPerSecond: number;
  transferred: number;
  total: number;
}

export default function UpdateBanner() {
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [progress, setProgress]     = useState<DownloadProgress | null>(null);
  const [downloaded, setDownloaded] = useState(false);
  const [dismissed, setDismissed]   = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError]           = useState<string | null>(null);

  useEffect(() => {
    const api = (window as any).electronAPI;
    if (!api?.on) return;

    const unsubs = [
      api.on("update:available",       (info: UpdateInfo)          => { setUpdateInfo(info); setError(null); }),
      api.on("update:downloadProgress",(p: DownloadProgress)       => setProgress(p)),
      api.on("update:downloaded",      ()                          => { setDownloaded(true); setDownloading(false); setProgress(null); }),
      api.on("update:error",           (msg: string)               => { setError(msg); setDownloading(false); }),
    ];
    return () => unsubs.forEach((u: () => void) => u?.());
  }, []);

  if (dismissed || !updateInfo) return null;

  const mbps = progress ? (progress.bytesPerSecond / 1024 / 1024).toFixed(1) : null;

  return (
    <div style={{
      position: "fixed", top: 0, left: 0, right: 0, zIndex: 10000,
      background: "rgba(2,8,18,.97)",
      borderBottom: "1px solid rgba(0,255,157,.2)",
      padding: "5px 14px",
      display: "flex", alignItems: "center", gap: 8,
      fontFamily: "monospace", fontSize: 11,
      boxShadow: "0 2px 12px rgba(0,255,157,.07)",
    }}>
      <span style={{ color: "#00ff9d", fontSize: 13 }}>⬆</span>

      <span style={{ color: "#6a90b8", flex: 1 }}>
        Доступна версия{" "}
        <b style={{ color: "#00ff9d" }}>v{updateInfo.version}</b>
      </span>

      {error && (
        <span style={{ color: "#ff4466", fontSize: 10 }}>⚠ {error.slice(0, 60)}</span>
      )}

      {downloaded ? (
        <button
          onClick={() => (window as any).electronAPI.update.install()}
          style={{
            fontSize: 10, padding: "3px 12px", borderRadius: 3,
            background: "rgba(0,255,157,.15)", border: "1px solid rgba(0,255,157,.5)",
            color: "#00ff9d", cursor: "pointer",
          }}
        >
          ✅ Установить и перезапустить
        </button>
      ) : downloading && progress ? (
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <div style={{ width: 90, height: 4, background: "#0a1520", borderRadius: 2 }}>
            <div style={{
              width: `${Math.min(100, Math.round(progress.percent))}%`,
              height: "100%", background: "#00ff9d", borderRadius: 2,
              transition: "width .3s",
            }} />
          </div>
          <span style={{ color: "#4a7a96", minWidth: 60, fontSize: 10 }}>
            {Math.round(progress.percent)}% · {mbps} МБ/с
          </span>
        </div>
      ) : (
        <button
          disabled={downloading}
          onClick={() => {
            setDownloading(true);
            setError(null);
            (window as any).electronAPI.update.download();
          }}
          style={{
            fontSize: 10, padding: "3px 12px", borderRadius: 3,
            background: downloading ? "none" : "rgba(0,255,157,.08)",
            border: `1px solid ${downloading ? "#1a2a3a" : "rgba(0,255,157,.3)"}`,
            color: downloading ? "#2a4a6a" : "#00ff9d",
            cursor: downloading ? "not-allowed" : "pointer",
          }}
        >
          {downloading ? "Загрузка…" : "⬇ Скачать обновление"}
        </button>
      )}

      <button
        onClick={() => setDismissed(true)}
        style={{
          fontSize: 10, padding: "2px 7px", borderRadius: 3,
          background: "none", border: "1px solid #1a2a3a",
          color: "#2a4a6a", cursor: "pointer",
        }}
      >✕</button>
    </div>
  );
}
