import { useEffect, useState } from "react";
import { useContextStore } from "../../store/context";
import * as api from "../../api/client";
import type { ColumnSchema } from "../../types/api";

interface PKSearchBarProps {
  tableName: string;
}

export function PKSearchBar({ tableName }: PKSearchBarProps) {
  const { targetId, dbName, branchName } = useContextStore();
  const [pkValue, setPkValue] = useState("");
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [searchStatus, setSearchStatus] = useState<"idle" | "not_found" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [loading, setLoading] = useState(false);
  const [pkColName, setPkColName] = useState("");

  // Fetch PK column name from schema
  useEffect(() => {
    if (!tableName || !targetId || !dbName || !branchName) return;
    api.getTableSchema(targetId, dbName, branchName, tableName).then((schema) => {
      const pk = schema.columns.find((c: ColumnSchema) => c.primary_key);
      setPkColName(pk ? pk.name : "");
    }).catch(() => setPkColName(""));
  }, [targetId, dbName, branchName, tableName]);

  const handleSearch = async () => {
    const pk = pkValue.trim();
    if (!pk || !tableName || !pkColName) return;
    setLoading(true);
    setResult(null);
    setSearchStatus("idle");
    try {
      // Backend expects JSON object: {"ColumnName": value}
      const pkNum = Number(pk);
      const pkJSON = JSON.stringify({ [pkColName]: isNaN(pkNum) ? pk : pkNum });
      const row = await api.getTableRow(targetId, dbName, branchName, tableName, pkJSON);
      setResult(row);
    } catch (err: unknown) {
      const e = err as { status?: number; error?: { message?: string } };
      if (e?.status === 404 || (e?.error?.message && e.error.message.toLowerCase().includes("not found"))) {
        setSearchStatus("not_found");
      } else {
        setSearchStatus("error");
        setErrorMsg(e?.error?.message || "Search failed");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleClear = () => {
    setPkValue("");
    setResult(null);
    setSearchStatus("idle");
    setErrorMsg("");
  };

  return (
    <div style={{ padding: "4px 16px", background: "#fafafa", borderBottom: "1px solid #e8e8f0" }}>
      <form
        onSubmit={(e) => { e.preventDefault(); handleSearch(); }}
        style={{ display: "flex", alignItems: "center", gap: 8 }}
      >
        <label style={{ fontSize: 12, fontWeight: 600, color: "#666" }}>PK Search</label>
        <input
          value={pkValue}
          onChange={(e) => setPkValue(e.target.value)}
          placeholder="Enter PK value"
          style={{ padding: "3px 8px", fontSize: 12, width: 140 }}
        />
        <button type="submit" disabled={loading || !pkValue.trim()} style={{ fontSize: 12, padding: "3px 10px" }}>
          {loading ? "..." : "Search"}
        </button>
        {(result || searchStatus !== "idle") && (
          <button type="button" onClick={handleClear} style={{ fontSize: 12, padding: "3px 10px" }}>
            Clear
          </button>
        )}
      </form>

      {/* Search result card */}
      {result && (
        <div style={{
          marginTop: 6,
          marginBottom: 4,
          background: "#e0e7ff",
          border: "1px solid #a5b4fc",
          borderRadius: 4,
          padding: 8,
          fontSize: 12,
          fontFamily: "monospace",
        }}>
          {Object.entries(result).map(([key, val]) => (
            <div key={key}>
              <span style={{ fontWeight: 600 }}>{key}</span>: {String(val ?? "")}
            </div>
          ))}
        </div>
      )}
      {searchStatus === "not_found" && (
        <div style={{ marginTop: 4, marginBottom: 4, fontSize: 12, color: "#991b1b" }}>
          No row found for PK = &quot;{pkValue.trim()}&quot;
        </div>
      )}
      {searchStatus === "error" && (
        <div style={{ marginTop: 4, marginBottom: 4, fontSize: 12, color: "#991b1b" }}>
          Error: {errorMsg}
        </div>
      )}
    </div>
  );
}
