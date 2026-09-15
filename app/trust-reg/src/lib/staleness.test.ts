import { describe, expect, it } from "vitest";
import { agingBucket, daysSince, isStalled } from "./staleness";

const NOW = new Date("2026-09-14T12:00:00Z");
const ago = (d: number) => new Date(NOW.getTime() - d * 86400000).toISOString();

describe("staleness", () => {
  it("counts whole days since a timestamp", () => {
    expect(daysSince(ago(0), NOW)).toBe(0);
    expect(daysSince(ago(13.9), NOW)).toBe(13);
    expect(daysSince(null, NOW)).toBe(0);
  });

  it("flags open cases untouched for the threshold", () => {
    expect(isStalled({ overall_status: "registration_in_progress", updated_at: ago(14) }, NOW, 14)).toBe(true);
    expect(isStalled({ overall_status: "registration_in_progress", updated_at: ago(13) }, NOW, 14)).toBe(false);
    expect(isStalled({ overall_status: "blocked", updated_at: ago(30) }, NOW, 7)).toBe(true);
  });

  it("never flags closed or handed-back cases", () => {
    expect(isStalled({ overall_status: "closed", updated_at: ago(400) }, NOW, 7)).toBe(false);
    expect(isStalled({ overall_status: "handed_back_to_wm", updated_at: ago(400) }, NOW, 7)).toBe(false);
  });

  it("buckets ages", () => {
    expect(agingBucket(0)).toBe("0-7");
    expect(agingBucket(7)).toBe("0-7");
    expect(agingBucket(8)).toBe("8-14");
    expect(agingBucket(28)).toBe("15-28");
    expect(agingBucket(29)).toBe("29+");
  });
});
