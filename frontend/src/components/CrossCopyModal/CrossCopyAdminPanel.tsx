import type { ReactNode } from "react";
import type {
  CrossCopyAdminCleanupImportResult,
  CrossCopyAdminPrepareRowsResult,
  CrossCopyAdminPrepareTableResult,
  ExpandColumn,
} from "../../types/api";
import { isCompleted, operationMessage } from "../../utils/apiResult";

type AdminResult =
  | CrossCopyAdminPrepareRowsResult
  | CrossCopyAdminPrepareTableResult
  | CrossCopyAdminCleanupImportResult;

interface CrossCopyAdminPanelProps {
  title: string;
  description: string;
  preparedColumns?: ExpandColumn[];
  result?: AdminResult | null;
  actions?: ReactNode;
}

export function CrossCopyAdminPanel({
  title,
  description,
  preparedColumns = [],
  result,
  actions,
}: CrossCopyAdminPanelProps) {
  const hasPreparedColumns = preparedColumns.length > 0;
  const outcomeTone = result ? (isCompleted(result) ? "#166534" : "#1d4ed8") : "#1d4ed8";
  const outcomeBg = result ? (isCompleted(result) ? "#f0fdf4" : "#eff6ff") : "#eff6ff";

  const overwrittenTables =
    result && "overwritten_tables" in result ? result.overwritten_tables ?? [] : [];
  const retryActions = result?.retry_actions ?? [];

  return (
    <div
      style={{
        marginTop: 10,
        marginBottom: 12,
        padding: "10px 12px",
        background: outcomeBg,
        border: `1px solid ${result && isCompleted(result) ? "#bbf7d0" : "#bfdbfe"}`,
        borderRadius: 6,
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 700, color: outcomeTone, marginBottom: 6 }}>
        {title}
      </div>
      <div style={{ fontSize: 12, color: "#334155", marginBottom: hasPreparedColumns || result || actions ? 8 : 0 }}>
        {description}
      </div>

      {hasPreparedColumns && (
        <div style={{ fontSize: 12, color: "#334155", marginBottom: 8 }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>対象カラム</div>
          <ul style={{ margin: 0, paddingLeft: 16 }}>
            {preparedColumns.map((column) => (
              <li key={`${column.name}:${column.dst_type}:${column.src_type}`}>
                <strong>{column.name}</strong>: {column.dst_type} → {column.src_type}
              </li>
            ))}
          </ul>
        </div>
      )}

      {result && (
        <div style={{ fontSize: 12, color: outcomeTone, marginBottom: actions ? 8 : 0 }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>
            {operationMessage(result, isCompleted(result) ? "管理レーンを完了しました" : "管理レーンの追加対応が必要です")}
          </div>
          {"main_hash" in result && result.main_hash && (
            <div style={{ color: "#475569" }}>main: {result.main_hash}</div>
          )}
          {"branch_hash" in result && result.branch_hash && (
            <div style={{ color: "#475569" }}>branch: {result.branch_hash}</div>
          )}
          {"branch_name" in result && result.branch_name && (
            <div style={{ color: "#475569" }}>branch: {result.branch_name}</div>
          )}
          {overwrittenTables.length > 0 && (
            <div style={{ color: "#92400e", marginTop: 6 }}>
              main 優先で上書きしたテーブル: {overwrittenTables.map((table) => `${table.table} (${table.conflicts})`).join(", ")}
            </div>
          )}
          {retryActions.length > 0 && (
            <div style={{ color: "#475569", marginTop: 6 }}>
              次の確認: {retryActions.map((action) => action.label).join(" / ")}
            </div>
          )}
        </div>
      )}

      {actions}
    </div>
  );
}
