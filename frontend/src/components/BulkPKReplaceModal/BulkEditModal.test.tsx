import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BulkEditModal } from "./BulkEditModal";

describe("BulkEditModal", () => {
  it("excludes PK columns from the editable target list", () => {
    render(
      <BulkEditModal
        columns={[
          { name: "id", type: "int", nullable: false, primary_key: true },
          { name: "name", type: "varchar", nullable: false, primary_key: false },
        ]}
        selectedRows={[{ id: 1, name: "Alice" }]}
        onApply={vi.fn()}
        onClose={vi.fn()}
      />
    );

    expect(screen.queryByRole("option", { name: "id" })).toBeNull();
    expect(screen.getByRole("option", { name: "name" })).toBeTruthy();
  });
});
