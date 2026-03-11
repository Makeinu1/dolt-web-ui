import { render, screen, fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorBoundary } from "./ErrorBoundary";
import { performRecoveryReload } from "../../utils/recoveryReload";

vi.mock("../../utils/recoveryReload", () => ({
  performRecoveryReload: vi.fn(),
}));

function Thrower(): never {
  throw new Error("boom");
}

describe("ErrorBoundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows recovery reload action on runtime errors", () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    render(
      <ErrorBoundary>
        <Thrower />
      </ErrorBoundary>
    );

    expect(screen.getByText("予期しないエラーが発生しました")).toBeTruthy();
    const button = screen.getByRole("button", { name: "復旧付き再読み込み" });
    fireEvent.click(button);
    expect(performRecoveryReload).toHaveBeenCalledTimes(1);

    consoleErrorSpy.mockRestore();
  });
});
