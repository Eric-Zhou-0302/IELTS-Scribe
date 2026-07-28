import { describe, expect, it } from "vitest";
import {
  countWords,
  formatTime,
  resolvePromptAdditionLabel,
  resolveSaveStatusLabel
} from "../src/App.jsx";

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

  it("falls back to a placeholder when promptAddition is empty", () => {
    expect(resolvePromptAdditionLabel("")).toBe("无题目补充");
    expect(resolvePromptAdditionLabel("   ")).toBe("无题目补充");
    expect(resolvePromptAdditionLabel(null)).toBe("无题目补充");
    expect(resolvePromptAdditionLabel(undefined)).toBe("无题目补充");
  });

  it("trims promptAddition before showing it", () => {
    expect(resolvePromptAdditionLabel("  柱状图，2015-2020  ")).toBe("柱状图，2015-2020");
  });
});
