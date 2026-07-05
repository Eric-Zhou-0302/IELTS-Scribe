import { describe, expect, it } from "vitest";
import { countWords, formatTime, resolveSaveStatusLabel } from "../src/App.jsx";

describe("App helpers", () => {
  it("formats seconds into mm:ss", () => {
    expect(formatTime(65)).toBe("01:05");
    expect(formatTime(0)).toBe("00:00");
  });

  it("counts words with compact whitespace handling", () => {
    expect(countWords("This   is a test")).toBe(4);
    expect(countWords("   ")).toBe(0);
  });

  it("renders save status text", () => {
    expect(resolveSaveStatusLabel({ status: "saving", savedAt: null })).toBe("保存中");
    expect(resolveSaveStatusLabel({ status: "error", savedAt: null })).toBe("保存失败");
  });
});
