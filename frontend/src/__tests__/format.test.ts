import { describe, expect, it } from "vitest";

import { formatActivityTime, formatDate, truncate } from "@/lib/format";

describe("format helpers", () => {
  it("labels missing dates", () => {
    expect(formatDate(null)).toBe("Not dated");
    expect(formatDate("")).toBe("Not dated");
  });

  it("formats ISO dates", () => {
    expect(formatDate("1998-09-12")).toContain("1998");
    expect(formatDate("1998-09-12")).not.toBe("Not dated");
  });

  it("truncates long text with an ellipsis", () => {
    expect(truncate("1234567890", 5)).toBe("1234…");
    expect(truncate("short", 10)).toBe("short");
  });

  it("formats activity timestamps", () => {
    expect(formatActivityTime(new Date(2026, 0, 1, 9, 5).toISOString())).not.toBe("");
  });
});
