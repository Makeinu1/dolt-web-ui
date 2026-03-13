import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../api/errors";
import * as api from "../../api/client";
import { useDraftStore } from "../../store/draft";
import { CellCommentPanel } from "./CellCommentPanel";

vi.mock("../../api/client", () => ({
  getMemo: vi.fn(),
}));

describe("CellCommentPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useDraftStore.getState().clearDraft();
  });

  it("uses the selected ref and ignores current drafts in read-only mode", async () => {
    useDraftStore.getState().addOp({
      type: "update",
      table: "_memo_users",
      pk: { pk_value: `{"id":1}`, column_name: "role" },
      values: { memo_text: "draft memo" },
    });
    vi.mocked(api.getMemo).mockResolvedValue({
      pk_value: `{"id":1}`,
      column_name: "role",
      memo_text: "preview memo",
      updated_at: "2026-03-13T12:00:00",
    });

    render(
      <CellCommentPanel
        targetId="local"
        dbName="test_db"
        refName="0123456789abcdef0123456789abcdef"
        table="users"
        pk={`{"id":1}`}
        column="role"
        readOnly
        onClose={() => {}}
      />
    );

    expect(await screen.findByText("preview memo")).toBeTruthy();
    expect(api.getMemo).toHaveBeenCalledWith(
      "local",
      "test_db",
      "0123456789abcdef0123456789abcdef",
      "users",
      `{"id":1}`,
      "role"
    );
    expect(screen.queryByText("✏ 未保存の変更あり")).toBeNull();
    expect(screen.queryByText("draft memo")).toBeNull();
    expect(screen.queryByText("下書きに追加")).toBeNull();
  });

  it("shows a visible error when memo loading fails", async () => {
    vi.mocked(api.getMemo).mockRejectedValue(
      new ApiError(500, { code: "INTERNAL", message: "メモの読み込みに失敗しました" })
    );

    render(
      <CellCommentPanel
        targetId="local"
        dbName="test_db"
        refName="wi/feat-a"
        table="users"
        pk={`{"id":1}`}
        column="role"
        readOnly={false}
        onClose={() => {}}
      />
    );

    expect(await screen.findByText("メモの読み込みに失敗しました")).toBeTruthy();
  });
});
