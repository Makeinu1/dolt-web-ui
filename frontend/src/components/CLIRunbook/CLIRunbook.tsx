import { useState } from "react";
import { useContextStore } from "../../store/context";
import { useUIStore } from "../../store/ui";
import * as api from "../../api/client";

export function CLIRunbook() {
  const { targetId, dbName, branchName } = useContextStore();
  const { baseState, setBaseState, setError } = useUIStore();
  const [checking, setChecking] = useState(false);

  if (
    baseState !== "SchemaConflictDetected" &&
    baseState !== "ConstraintViolationDetected"
  ) {
    return null;
  }

  const isSchema = baseState === "SchemaConflictDetected";
  const title = isSchema
    ? "Schema Conflict Detected"
    : "Constraint Violation Detected";
  const description = isSchema
    ? "スキーマコンフリクトはWeb UIでは解決できません。以下のCLIコマンドで対応してください。"
    : "制約違反はWeb UIでは解決できません。以下のCLIコマンドで対応してください。";

  const diagnosisSQL = `USE \`${dbName}/${branchName}\`;

-- マージ状態の確認
SELECT is_merging, source, target FROM dolt_merge_status;

-- スキーマコンフリクト確認
SELECT table_name, description FROM dolt_schema_conflicts;

-- データコンフリクト確認
SELECT * FROM dolt_conflicts;

-- 制約違反確認
SELECT * FROM dolt_constraint_violations;`;

  const resolutionSQL = isSchema
    ? `-- スキーマコンフリクトの解決 (ours = work branch の変更を採用)
CALL DOLT_CONFLICTS_RESOLVE('--ours', '<table_name>');

-- または theirs = main の変更を採用
CALL DOLT_CONFLICTS_RESOLVE('--theirs', '<table_name>');

-- 解決後にコミット
CALL DOLT_COMMIT('-a', '-m', 'resolve schema conflicts');`
    : `-- 制約違反のデータを修正
-- FK, UNIQUE, CHECK 等の制約を確認し、データを修正してください
UPDATE \`<table>\` SET ... WHERE ...;

-- 違反がなくなったことを確認
SELECT * FROM dolt_constraint_violations;
-- → 0 rows

-- 修正をコミット
CALL DOLT_COMMIT('-a', '-m', 'resolve constraint violations');`;

  const abortSQL = `-- マージを中止する場合
CALL DOLT_MERGE('--abort');`;

  const handleRefreshCheck = async () => {
    setChecking(true);
    try {
      // Try to get conflicts — if empty, issue is resolved
      const conflicts = await api.getConflicts(targetId, dbName, branchName);
      const hasSchemaConflicts = conflicts.some((c) => c.schema_conflicts > 0);
      const hasConstraintViolations = conflicts.some((c) => c.constraint_violations > 0);

      if (hasSchemaConflicts) {
        setBaseState("SchemaConflictDetected");
        setError("Schema conflicts still present. Resolve via CLI.");
      } else if (hasConstraintViolations) {
        setBaseState("ConstraintViolationDetected");
        setError("Constraint violations still present. Resolve via CLI.");
      } else {
        setBaseState("Idle");
        setError(null);
      }
    } catch {
      // If getConflicts fails (e.g., no merge in progress), assume resolved
      setBaseState("Idle");
      setError(null);
    } finally {
      setChecking(false);
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
    >
      <div
        style={{
          background: "#fff",
          borderRadius: 8,
          padding: 24,
          maxWidth: 700,
          width: "90%",
          maxHeight: "80vh",
          overflow: "auto",
          boxShadow: "0 8px 32px rgba(0,0,0,0.3)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 16,
          }}
        >
          <span
            style={{
              background: isSchema ? "#dc3545" : "#fd7e14",
              color: "#fff",
              padding: "2px 8px",
              borderRadius: 4,
              fontSize: 11,
              fontWeight: 700,
            }}
          >
            CLI Required
          </span>
          <h2 style={{ margin: 0, fontSize: 18 }}>{title}</h2>
        </div>

        <p style={{ fontSize: 14, color: "#333", marginBottom: 16 }}>
          {description}
        </p>

        <h3 style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
          1. 診断
        </h3>
        <pre
          style={{
            background: "#1e1e1e",
            color: "#d4d4d4",
            padding: 12,
            borderRadius: 4,
            fontSize: 12,
            overflow: "auto",
            marginBottom: 16,
          }}
        >
          {diagnosisSQL}
        </pre>

        <h3 style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
          2. 解決
        </h3>
        <pre
          style={{
            background: "#1e1e1e",
            color: "#d4d4d4",
            padding: 12,
            borderRadius: 4,
            fontSize: 12,
            overflow: "auto",
            marginBottom: 16,
          }}
        >
          {resolutionSQL}
        </pre>

        <h3 style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
          3. マージ中止（必要な場合）
        </h3>
        <pre
          style={{
            background: "#1e1e1e",
            color: "#d4d4d4",
            padding: 12,
            borderRadius: 4,
            fontSize: 12,
            overflow: "auto",
            marginBottom: 16,
          }}
        >
          {abortSQL}
        </pre>

        <p style={{ fontSize: 12, color: "#888", marginBottom: 16 }}>
          CLIで解決後、「Dismiss & Refresh」を押してUIを再読み込みしてください。
        </p>

        <div style={{ textAlign: "right" }}>
          <button
            className="primary"
            onClick={handleRefreshCheck}
            disabled={checking}
            style={{ fontSize: 13 }}
          >
            {checking ? "Checking..." : "Refresh & Check"}
          </button>
        </div>
      </div>
    </div>
  );
}
