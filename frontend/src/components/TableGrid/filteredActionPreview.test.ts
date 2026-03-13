import { describe, expect, it } from "vitest";
import type { CommitOp } from "../../types/api";
import {
  FILTERED_ACTION_PREVIEW_LIMIT,
  buildFilteredActionPreview,
  countAffectedFetchedBaseRows,
  collectMissingBaseDraftPks,
  getFilteredActionPersistedFetchTargetCount,
} from "./filteredActionPreview";

const pkCols = [
  { name: "id", type: "int", nullable: false, primary_key: true },
];

describe("collectMissingBaseDraftPks", () => {
  it("includes draft-updated base rows missing from persisted filter results", () => {
    const missingPks = collectMissingBaseDraftPks(
      [],
      [
        {
          type: "update",
          table: "users",
          pk: { id: 2 },
          values: { role: "guest" },
        },
      ],
      pkCols,
      "users",
    );

    expect(missingPks).toEqual([{ id: 2 }]);
  });

  it("does not include copied rows with client_row_id", () => {
    const missingPks = collectMissingBaseDraftPks(
      [],
      [
        {
          type: "update",
          table: "users",
          client_row_id: "copy-1",
          pk: { id: 2 },
          values: { role: "guest" },
        },
      ],
      pkCols,
      "users",
    );

    expect(missingPks).toEqual([]);
  });
});

describe("buildFilteredActionPreview", () => {
  it("includes a base row that only matches after a draft update", () => {
    const preview = buildFilteredActionPreview({
      persistedRows: [],
      fetchedDraftBaseRows: [{ id: 2, name: "Bob", role: "user" }],
      draftOps: [
        {
          type: "update",
          table: "users",
          pk: { id: 2 },
          values: { role: "guest" },
        },
      ],
      pkCols,
      tableName: "users",
      filterJson: JSON.stringify([{ column: "role", op: "eq", value: "guest" }]),
      sortSpec: "",
      showDraftOnly: false,
      serverTotalCount: 0,
    });

    expect(preview.rows).toHaveLength(1);
    expect(preview.rows[0].name).toBe("Bob");
    expect(preview.containsDraftRows).toBe(true);
  });

  it("includes a fetched deleted base row in draft-only mode", () => {
    const preview = buildFilteredActionPreview({
      persistedRows: [],
      fetchedDraftBaseRows: [{ id: 2, name: "Bob", role: "user" }],
      draftOps: [
        {
          type: "delete",
          table: "users",
          pk: { id: 2 },
          values: {},
        },
      ],
      pkCols,
      tableName: "users",
      filterJson: "",
      sortSpec: "",
      showDraftOnly: true,
      serverTotalCount: 0,
    });

    expect(preview.rows).toHaveLength(1);
    expect(preview.rows[0].name).toBe("Bob");
    expect(preview.containsDraftRows).toBe(true);
  });

  it("caps the target rows at 1000", () => {
    const inserts: CommitOp[] = Array.from(
      { length: FILTERED_ACTION_PREVIEW_LIMIT + 1 },
      (_, index) => ({
        type: "insert",
        table: "users",
        client_row_id: `copy-${index}`,
        values: { id: index + 1, name: `User ${index}`, role: "guest" },
      }),
    );

    const preview = buildFilteredActionPreview({
      persistedRows: [],
      fetchedDraftBaseRows: [],
      draftOps: inserts,
      pkCols,
      tableName: "users",
      filterJson: "",
      sortSpec: "",
      showDraftOnly: false,
      serverTotalCount: 0,
    });

    expect(preview.count).toBe(FILTERED_ACTION_PREVIEW_LIMIT);
    expect(preview.capped).toBe(true);
  });
});

describe("getFilteredActionPersistedFetchTargetCount", () => {
  it("requests spillover rows when a fetched base row has a draft update", () => {
    const persistedRows = Array.from({ length: FILTERED_ACTION_PREVIEW_LIMIT }, (_, index) => ({
      id: index + 1,
      name: `User ${index + 1}`,
      role: "user",
    }));

    expect(
      getFilteredActionPersistedFetchTargetCount(
        persistedRows,
        [
          {
            type: "update",
            table: "users",
            pk: { id: 1 },
            values: { role: "guest" },
          },
        ],
        pkCols,
        "users",
        FILTERED_ACTION_PREVIEW_LIMIT + 1,
      )
    ).toBe(FILTERED_ACTION_PREVIEW_LIMIT + 1);
  });

  it("recomputes the fetch target when a newly fetched row is also draft-affected", () => {
    const firstPageRows = Array.from({ length: FILTERED_ACTION_PREVIEW_LIMIT }, (_, index) => ({
      id: index + 1,
      name: `User ${index + 1}`,
      role: "user",
    }));
    const withSpillover = [...firstPageRows, { id: FILTERED_ACTION_PREVIEW_LIMIT + 1, name: "User 1001", role: "user" }];
    const draftOps: CommitOp[] = [
      {
        type: "update",
        table: "users",
        pk: { id: 1 },
        values: { role: "guest" },
      },
      {
        type: "update",
        table: "users",
        pk: { id: FILTERED_ACTION_PREVIEW_LIMIT + 1 },
        values: { role: "guest" },
      },
    ];

    expect(
      getFilteredActionPersistedFetchTargetCount(
        firstPageRows,
        draftOps,
        pkCols,
        "users",
        FILTERED_ACTION_PREVIEW_LIMIT + 2,
      )
    ).toBe(FILTERED_ACTION_PREVIEW_LIMIT + 1);
    expect(
      getFilteredActionPersistedFetchTargetCount(
        withSpillover,
        draftOps,
        pkCols,
        "users",
        FILTERED_ACTION_PREVIEW_LIMIT + 2,
      )
    ).toBe(FILTERED_ACTION_PREVIEW_LIMIT + 2);
  });

  it("stops at the first page when no fetched rows are draft-affected", () => {
    const persistedRows = Array.from({ length: FILTERED_ACTION_PREVIEW_LIMIT }, (_, index) => ({
      id: index + 1,
      name: `User ${index + 1}`,
      role: "user",
    }));

    expect(countAffectedFetchedBaseRows(persistedRows, [], pkCols, "users")).toBe(0);
    expect(
      getFilteredActionPersistedFetchTargetCount(
        persistedRows,
        [],
        pkCols,
        "users",
        FILTERED_ACTION_PREVIEW_LIMIT + 500,
      )
    ).toBe(FILTERED_ACTION_PREVIEW_LIMIT);
  });
});
