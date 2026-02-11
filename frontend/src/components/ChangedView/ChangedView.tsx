import { useDraftStore } from "../../store/draft";
import { useUIStore } from "../../store/ui";

export function ChangedView() {
  const { ops, removeOp, clearDraft } = useDraftStore();
  const setBaseState = useUIStore((s) => s.setBaseState);

  if (ops.length === 0) {
    return (
      <div style={{ padding: 24, textAlign: "center", color: "#888" }}>
        No pending changes. Edit cells in the grid to create draft operations.
      </div>
    );
  }

  const handleDiscard = () => {
    if (window.confirm("Discard all draft changes?")) {
      clearDraft();
      setBaseState("Idle");
    }
  };

  return (
    <div style={{ padding: 16 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 12,
        }}
      >
        <h3 style={{ fontSize: 14, fontWeight: 600 }}>
          Pending Changes ({ops.length})
        </h3>
        <button className="danger" onClick={handleDiscard} style={{ fontSize: 12 }}>
          Discard All
        </button>
      </div>

      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          fontSize: 13,
        }}
      >
        <thead>
          <tr style={{ borderBottom: "2px solid #d0d0d8" }}>
            <th style={{ textAlign: "left", padding: "6px 8px" }}>#</th>
            <th style={{ textAlign: "left", padding: "6px 8px" }}>Type</th>
            <th style={{ textAlign: "left", padding: "6px 8px" }}>Table</th>
            <th style={{ textAlign: "left", padding: "6px 8px" }}>PK</th>
            <th style={{ textAlign: "left", padding: "6px 8px" }}>Values</th>
            <th style={{ textAlign: "right", padding: "6px 8px" }}></th>
          </tr>
        </thead>
        <tbody>
          {ops.map((op, i) => (
            <tr
              key={i}
              style={{
                borderBottom: "1px solid #e8e8f0",
                background:
                  op.type === "insert" ? "#f0fdf4" : "#fffbeb",
              }}
            >
              <td style={{ padding: "6px 8px", color: "#888" }}>{i + 1}</td>
              <td style={{ padding: "6px 8px" }}>
                <span
                  className={`badge ${
                    op.type === "insert" ? "badge-success" : "badge-warning"
                  }`}
                >
                  {op.type}
                </span>
              </td>
              <td style={{ padding: "6px 8px", fontWeight: 500 }}>{op.table}</td>
              <td
                style={{
                  padding: "6px 8px",
                  fontFamily: "monospace",
                  fontSize: 12,
                }}
              >
                {op.pk ? JSON.stringify(op.pk) : "-"}
              </td>
              <td
                style={{
                  padding: "6px 8px",
                  fontFamily: "monospace",
                  fontSize: 12,
                  maxWidth: 300,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {JSON.stringify(op.values)}
              </td>
              <td style={{ padding: "6px 8px", textAlign: "right" }}>
                <button
                  onClick={() => removeOp(i)}
                  style={{ fontSize: 11, padding: "2px 8px" }}
                >
                  Remove
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
