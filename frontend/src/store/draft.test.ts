import { describe, it, expect, beforeEach } from "vitest";
import { useDraftStore } from "./draft";

// Reset store before each test
beforeEach(() => {
  useDraftStore.getState().clearDraft();
});

describe("addOp — basic append", () => {
  it("appends a simple INSERT op", () => {
    useDraftStore.getState().addOp({ type: "insert", table: "T1", values: { id: 1, name: "a" } });
    expect(useDraftStore.getState().ops).toHaveLength(1);
    expect(useDraftStore.getState().ops[0].type).toBe("insert");
  });

  it("appends ops for different tables independently", () => {
    useDraftStore.getState().addOp({ type: "insert", table: "T1", values: { id: 1 } });
    useDraftStore.getState().addOp({ type: "insert", table: "T2", values: { id: 2 } });
    expect(useDraftStore.getState().ops).toHaveLength(2);
  });
});

describe("addOp — INSERT absorption", () => {
  it("absorbs UPDATE into an existing INSERT for the same PK", () => {
    useDraftStore.getState().addOp({ type: "insert", table: "T1", values: { id: "1", name: "a" } });
    useDraftStore.getState().addOp({ type: "update", table: "T1", pk: { id: "1" }, values: { name: "b" } });
    const ops = useDraftStore.getState().ops;
    expect(ops).toHaveLength(1);
    expect(ops[0].type).toBe("insert");
    expect(ops[0].values.name).toBe("b");
  });

  it("cancels INSERT when DELETE is applied to the same PK", () => {
    useDraftStore.getState().addOp({ type: "insert", table: "T1", values: { id: "1", name: "a" } });
    useDraftStore.getState().addOp({ type: "delete", table: "T1", pk: { id: "1" }, values: {} });
    expect(useDraftStore.getState().ops).toHaveLength(0);
  });

  it("does not absorb UPDATE into INSERT of a different PK", () => {
    useDraftStore.getState().addOp({ type: "insert", table: "T1", values: { id: "1", name: "a" } });
    useDraftStore.getState().addOp({ type: "update", table: "T1", pk: { id: "2" }, values: { name: "b" } });
    expect(useDraftStore.getState().ops).toHaveLength(2);
  });

  it("does not absorb UPDATE into INSERT of a different table", () => {
    useDraftStore.getState().addOp({ type: "insert", table: "T1", values: { id: "1" } });
    useDraftStore.getState().addOp({ type: "update", table: "T2", pk: { id: "1" }, values: { name: "b" } });
    expect(useDraftStore.getState().ops).toHaveLength(2);
  });
});

describe("addOp — UPDATE merge", () => {
  it("merges consecutive UPDATEs to the same row", () => {
    useDraftStore.getState().addOp({ type: "update", table: "T1", pk: { id: "1" }, values: { name: "a" } });
    useDraftStore.getState().addOp({ type: "update", table: "T1", pk: { id: "1" }, values: { value: 42 } });
    const ops = useDraftStore.getState().ops;
    expect(ops).toHaveLength(1);
    expect(ops[0].values).toEqual({ name: "a", value: 42 });
  });

  it("later UPDATE value wins on same column", () => {
    useDraftStore.getState().addOp({ type: "update", table: "T1", pk: { id: "1" }, values: { name: "first" } });
    useDraftStore.getState().addOp({ type: "update", table: "T1", pk: { id: "1" }, values: { name: "second" } });
    expect(useDraftStore.getState().ops[0].values.name).toBe("second");
  });

  it("does not merge UPDATEs for different rows", () => {
    useDraftStore.getState().addOp({ type: "update", table: "T1", pk: { id: "1" }, values: { name: "a" } });
    useDraftStore.getState().addOp({ type: "update", table: "T1", pk: { id: "2" }, values: { name: "b" } });
    expect(useDraftStore.getState().ops).toHaveLength(2);
  });
});

describe("removeOp", () => {
  it("removes the op at the specified index", () => {
    useDraftStore.getState().addOp({ type: "insert", table: "T1", values: { id: 1 } });
    useDraftStore.getState().addOp({ type: "insert", table: "T1", values: { id: 2 } });
    useDraftStore.getState().removeOp(0);
    const ops = useDraftStore.getState().ops;
    expect(ops).toHaveLength(1);
    expect(ops[0].values.id).toBe(2);
  });
});

describe("clearDraft", () => {
  it("empties all ops", () => {
    useDraftStore.getState().addOp({ type: "insert", table: "T1", values: { id: 1 } });
    useDraftStore.getState().clearDraft();
    expect(useDraftStore.getState().ops).toHaveLength(0);
  });
});

describe("hasDraft", () => {
  it("returns false when ops list is empty", () => {
    expect(useDraftStore.getState().hasDraft()).toBe(false);
  });

  it("returns true when at least one op exists", () => {
    useDraftStore.getState().addOp({ type: "insert", table: "T1", values: { id: 1 } });
    expect(useDraftStore.getState().hasDraft()).toBe(true);
  });
});

describe("bulkReplacePKInDraft", () => {
  it("replaces PK value in targeted INSERT ops only", () => {
    useDraftStore.getState().addOp({ type: "insert", table: "T1", values: { id: "abc-001", name: "x" } });
    useDraftStore.getState().addOp({ type: "insert", table: "T1", values: { id: "def-002", name: "y" } });
    useDraftStore.getState().bulkReplacePKInDraft("T1", "id", "abc", "xyz", new Set(["abc-001"]));
    const ops = useDraftStore.getState().ops;
    expect(ops[0].values.id).toBe("xyz-001");
    expect(ops[1].values.id).toBe("def-002"); // untouched
  });

  it("does not touch UPDATE ops or other tables", () => {
    useDraftStore.getState().addOp({ type: "update", table: "T1", pk: { id: "abc-001" }, values: { name: "a" } });
    useDraftStore.getState().addOp({ type: "insert", table: "T2", values: { id: "abc-001" } });
    useDraftStore.getState().bulkReplacePKInDraft("T1", "id", "abc", "xyz", new Set(["abc-001"]));
    const ops = useDraftStore.getState().ops;
    expect(ops[0].pk?.id).toBe("abc-001"); // UPDATE pk unchanged
    expect(ops[1].values.id).toBe("abc-001"); // different table unchanged
  });
});
