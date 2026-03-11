import { useRef, useState } from "react";
import { useContextStore } from "../../store/context";
import { useUIStore } from "../../store/ui";
import * as api from "../../api/client";
import { ApiError } from "../../api/errors";
import type { CSVPreviewResponse } from "../../types/api";

interface CSVImportModalProps {
  tableName: string;
  expectedHead: string;
  onClose: () => void;
  onApplied: (newHash: string) => void;
}

type Step = "select" | "preview" | "done";

/** Parse CSV text into array of row objects. Handles quoted fields. */
function parseCSV(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length < 1) return { headers: [], rows: [] };

  const parseRow = (line: string): string[] => {
    const fields: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"' && line[i + 1] === '"') {
          current += '"';
          i++;
        } else if (ch === '"') {
          inQuotes = false;
        } else {
          current += ch;
        }
      } else {
        if (ch === '"') {
          inQuotes = true;
        } else if (ch === ",") {
          fields.push(current);
          current = "";
        } else {
          current += ch;
        }
      }
    }
    fields.push(current);
    return fields;
  };

  const headers = parseRow(lines[0]);
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const vals = parseRow(lines[i]);
    const row: Record<string, string> = {};
    headers.forEach((h, j) => {
      row[h] = vals[j] ?? "";
    });
    rows.push(row);
  }
  return { headers, rows };
}

export function CSVImportModal({
  tableName,
  expectedHead,
  onClose,
  onApplied,
}: CSVImportModalProps) {
  const { targetId, dbName, branchName } = useContextStore();
  const setBaseState = useUIStore((s) => s.setBaseState);
  const setGlobalError = useUIStore((s) => s.setError);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>("select");
  const [headers, setHeaders] = useState<string[]>([]);
  const [csvRows, setCsvRows] = useState<Record<string, string>[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<CSVPreviewResponse | null>(null);
  const [commitMessage, setCommitMessage] = useState("");

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setParseError(null);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const { headers: h, rows } = parseCSV(text);
      if (h.length === 0) {
        setParseError("CSVのヘッダー行が見つかりません");
        return;
      }
      if (rows.length === 0) {
        setParseError("CSVにデータ行がありません");
        return;
      }
      if (rows.length > 1000) {
        setParseError(`CSVが1000行を超えています（${rows.length}行）。最大1000行まで対応しています`);
        return;
      }
      setHeaders(h);
      setCsvRows(rows);
    };
    // BUG-G: handle file read errors explicitly.
    reader.onerror = () => {
      setParseError("ファイルの読み込みに失敗しました");
    };
    reader.readAsText(file, "UTF-8");
  };

  const handlePreview = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.csvPreview({
        target_id: targetId,
        db_name: dbName,
        branch_name: branchName,
        table: tableName,
        rows: csvRows,
      });
      setPreview(result);
      setStep("preview");
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "プレビューに失敗しました";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleApply = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.csvApply({
        target_id: targetId,
        db_name: dbName,
        branch_name: branchName,
        table: tableName,
        expected_head: expectedHead,
        commit_message: commitMessage || `[CSV] ${tableName}: 一括更新`,
        rows: csvRows,
      });
      onApplied(result.hash);
      setStep("done");
    } catch (err) {
      if (err instanceof ApiError && err.code === "STALE_HEAD") {
        setBaseState("StaleHeadDetected");
        setGlobalError("データが更新されています" + (err.message ? ": " + err.message : ""));
        setError(null);
        return;
      }
      const msg = err instanceof ApiError ? err.message : "適用に失敗しました";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal"
        style={{ minWidth: 520, maxWidth: 720, maxHeight: "90vh", display: "flex", flexDirection: "column" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h2 style={{ margin: 0, fontSize: 16 }}>📥 CSVインポート — {tableName}</h2>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 18, cursor: "pointer", color: "#666" }}>✕</button>
        </div>

        {error && (
          <div style={{ padding: "6px 10px", background: "#fee2e2", color: "#991b1b", fontSize: 12, borderRadius: 4, marginBottom: 8 }}>
            {error}
          </div>
        )}

        {step === "select" && (
          <div>
            <p style={{ fontSize: 13, color: "#555", marginBottom: 12 }}>
              CSVをアップロードして既存行を一括更新します。PKが一致する行は更新、存在しない行は追加されます。CSVにない行は変更されません。
            </p>
            <div
              style={{ border: "2px dashed #cbd5e1", borderRadius: 6, padding: 24, textAlign: "center", marginBottom: 12, cursor: "pointer" }}
              onClick={() => fileInputRef.current?.click()}
            >
              <div style={{ fontSize: 32, marginBottom: 4 }}>📄</div>
              <div style={{ fontSize: 13, color: "#666" }}>クリックしてCSVを選択</div>
              <div style={{ fontSize: 11, color: "#888", marginTop: 4 }}>UTF-8 / 最大1000行</div>
              <input ref={fileInputRef} type="file" accept=".csv" style={{ display: "none" }} onChange={handleFileChange} />
            </div>
            {parseError && (
              <div style={{ color: "#991b1b", fontSize: 12, marginBottom: 8 }}>⚠ {parseError}</div>
            )}
            {csvRows.length > 0 && (
              <div style={{ fontSize: 12, color: "#166534", marginBottom: 12 }}>
                ✓ {csvRows.length}行 / {headers.length}カラム 読み込み済み
              </div>
            )}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={onClose} style={{ padding: "6px 16px", fontSize: 13 }}>キャンセル</button>
              <button
                className="primary"
                onClick={handlePreview}
                disabled={loading || csvRows.length === 0}
                style={{ padding: "6px 16px", fontSize: 13 }}
              >
                {loading ? "確認中..." : "プレビュー →"}
              </button>
            </div>
          </div>
        )}

        {step === "preview" && preview && (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <div style={{ display: "flex", gap: 16, marginBottom: 12, flexWrap: "wrap" }}>
              <div style={{ padding: "8px 16px", background: "#dcfce7", borderRadius: 6, fontSize: 13, color: "#166534", fontWeight: 600 }}>
                追加: {preview.inserts}行
              </div>
              <div style={{ padding: "8px 16px", background: "#fef3c7", borderRadius: 6, fontSize: 13, color: "#92400e", fontWeight: 600 }}>
                更新: {preview.updates}行
              </div>
              <div style={{ padding: "8px 16px", background: "#f1f5f9", borderRadius: 6, fontSize: 13, color: "#475569", fontWeight: 600 }}>
                変更なし: {preview.skips}行
              </div>
              {preview.errors > 0 && (
                <div style={{ padding: "8px 16px", background: "#fee2e2", borderRadius: 6, fontSize: 13, color: "#991b1b", fontWeight: 600 }}>
                  エラー: {preview.errors}行
                </div>
              )}
            </div>

            {preview.sample_diffs.length > 0 && (
              <div style={{ flex: 1, overflow: "auto", marginBottom: 12 }}>
                <div style={{ fontSize: 11, color: "#888", marginBottom: 4 }}>サンプル差分（最初の5件）:</div>
                {preview.sample_diffs.map((d, i) => (
                  <div key={i} style={{ fontSize: 11, padding: "4px 8px", background: d.action === "insert" ? "#f0fdf4" : "#fef3c7", borderRadius: 4, marginBottom: 4, fontFamily: "monospace" }}>
                    <span style={{ fontWeight: 700, color: d.action === "insert" ? "#166534" : "#92400e" }}>
                      {d.action === "insert" ? "+" : "~"}
                    </span>
                    {" "}
                    {Object.entries(d.row).slice(0, 5).map(([k, v]) => `${k}=${v}`).join(", ")}
                  </div>
                ))}
              </div>
            )}

            <div style={{ marginBottom: 12 }}>
              <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                コミットメッセージ
              </label>
              <input
                type="text"
                value={commitMessage}
                onChange={(e) => setCommitMessage(e.target.value)}
                placeholder={`[CSV] ${tableName}: 一括更新`}
                style={{ width: "100%", fontSize: 13, padding: "4px 8px", boxSizing: "border-box" }}
              />
            </div>

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={() => setStep("select")} style={{ padding: "6px 16px", fontSize: 13 }}>← 戻る</button>
              <button
                className="primary"
                onClick={handleApply}
                disabled={loading || (preview.inserts === 0 && preview.updates === 0)}
                style={{ padding: "6px 16px", fontSize: 13 }}
              >
                {loading ? "適用中..." : `適用する (${preview.inserts + preview.updates}行)`}
              </button>
            </div>
          </div>
        )}

        {step === "done" && (
          <div style={{ textAlign: "center", padding: 24 }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>✓</div>
            <div style={{ fontSize: 14, color: "#166534", fontWeight: 600 }}>CSVの適用が完了しました</div>
            <button className="primary" onClick={onClose} style={{ marginTop: 16, padding: "6px 20px", fontSize: 13 }}>
              閉じる
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
