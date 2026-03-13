import { describe, expect, it } from "vitest";
import type { CommitOp } from "../../types/api";
import { buildRowModel } from "./rowModel";

const pkCols = [
  { name: "id", type: "int", nullable: false, primary_key: true },
];

function buildRows(draftOps: CommitOp[], filterJson = "", sortSpec = "") {
  return buildRowModel({
    baseRows: [
      { id: 1, name: "Alice", role: "admin" },
      { id: 2, name: "Bob", role: "user" },
      { id: 3, name: "Charlie", role: "user" },
    ],
    draftOps,
    pkCols,
    tableName: "users",
    filterJson,
    sortSpec,
    showDraftOnly: false,
  });
}

describe("buildRowModel", () => {
  it("keeps original and copied same-PK rows as separate identities", () => {
    const result = buildRows([
      {
        type: "insert",
        table: "users",
        client_row_id: "copy-1",
        values: { id: 2, name: "Bob copy", role: "user" },
      },
    ]);

    const bobRows = result.displayRows.filter((row) => row.id === 2);
    expect(bobRows).toHaveLength(2);
    expect(new Set(bobRows.map((row) => row._rowId)).size).toBe(2);
    expect(result.duplicatePkRowIds.has("draft:copy-1")).toBe(true);
  });

  it("applies draft-row updates only to the copied row", () => {
    const result = buildRows([
      {
        type: "insert",
        table: "users",
        client_row_id: "copy-1",
        values: { id: 2, name: "Bob", role: "user" },
      },
      {
        type: "update",
        table: "users",
        client_row_id: "copy-1",
        pk: { id: 2 },
        values: { role: "member" },
      },
    ]);

    const baseBob = result.displayRows.find((row) => row._rowId === 'base:{"id":2}');
    const copiedBob = result.displayRows.find((row) => row._rowId === "draft:copy-1");
    expect(baseBob?.role).toBe("user");
    expect(copiedBob?.role).toBe("member");
  });

  it("re-evaluates local filters against draft rows", () => {
    const result = buildRows(
      [
        {
          type: "insert",
          table: "users",
          client_row_id: "copy-1",
          values: { id: 4, name: "Dana", role: "guest" },
        },
        {
          type: "update",
          table: "users",
          pk: { id: 2 },
          values: { role: "guest" },
        },
      ],
      JSON.stringify([{ column: "role", op: "eq", value: "guest" }]),
    );

    expect(result.displayRows.map((row) => row.name)).toEqual(["Bob", "Dana"]);
  });

  it("re-evaluates local sort against draft rows", () => {
    const result = buildRows([
      {
        type: "insert",
        table: "users",
        client_row_id: "copy-1",
        values: { id: 4, name: "Aaron", role: "user" },
      },
    ], "", "name");

    expect(result.displayRows.map((row) => row.name)).toEqual([
      "Aaron",
      "Alice",
      "Bob",
      "Charlie",
    ]);
  });

  it("handles large current-table draft sets in a single pass shape", () => {
    const inserts: CommitOp[] = Array.from({ length: 1000 }, (_, index) => ({
      type: "insert",
      table: "users",
      client_row_id: `copy-${index}`,
      values: { id: 1000 + index, name: `User ${index}`, role: "bulk" },
    }));

    const result = buildRowModel({
      baseRows: [],
      draftOps: inserts,
      pkCols,
      tableName: "users",
      filterJson: "",
      sortSpec: "",
      showDraftOnly: false,
    });

    expect(result.displayRows).toHaveLength(1000);
    expect(result.rowById.get("draft:copy-999")?.name).toBe("User 999");
  });
});
