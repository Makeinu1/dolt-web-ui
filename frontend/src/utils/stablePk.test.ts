import { describe, expect, it } from "vitest";
import { stablePkJson } from "./stablePk";

describe("stablePkJson", () => {
  it("returns the same JSON regardless of key insertion order", () => {
    const a = stablePkJson({ sub_id: "2", id: "1" });
    const b = stablePkJson({ id: "1", sub_id: "2" });

    expect(a).toBe(b);
    expect(a).toBe('{"id":"1","sub_id":"2"}');
  });
});

