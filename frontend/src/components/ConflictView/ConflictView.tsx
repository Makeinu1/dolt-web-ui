import type { OverwrittenTable } from "../../types/api";

interface ConflictViewProps {
  overwrittenTables: OverwrittenTable[];
  onDismiss: () => void;
}

/**
 * OverwriteNotification
 *
 * Shown after a sync that auto-resolved data conflicts (main priority).
 * Informs the user which tables were overwritten and prompts them to re-edit if needed.
 */
export function ConflictView({ overwrittenTables, onDismiss }: ConflictViewProps) {
  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, margin: 0, color: "#b45309" }}>
          ⚠ mainの変更が優先されました
        </h3>
        <button
          onClick={onDismiss}
          style={{ fontSize: 12, padding: "4px 12px", background: "#f1f5f9", color: "#334155", border: "1px solid #cbd5e1", borderRadius: 4, cursor: "pointer" }}
        >
          閉じる
        </button>
      </div>

      <p style={{ fontSize: 12, color: "#555", margin: "0 0 12px" }}>
        同期中にコンフリクトが検出されました。mainの変更を優先して自動解決しました。
        以下のテーブルで、あなたの変更がmainの内容で上書きされた可能性があります。
        必要に応じて再編集してください。
      </p>

      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ borderBottom: "2px solid #d0d0d8" }}>
            <th style={{ textAlign: "left", padding: "6px 8px" }}>テーブル</th>
            <th style={{ textAlign: "center", padding: "6px 8px" }}>コンフリクト数</th>
          </tr>
        </thead>
        <tbody>
          {overwrittenTables.map((t) => (
            <tr key={t.table} style={{ borderBottom: "1px solid #e8e8f0" }}>
              <td style={{ padding: "6px 8px", fontWeight: 500 }}>{t.table}</td>
              <td style={{ textAlign: "center", padding: "6px 8px" }}>
                <span style={{ background: "#fef3c7", color: "#92400e", padding: "2px 8px", borderRadius: 4, fontSize: 12 }}>
                  {t.conflicts}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
