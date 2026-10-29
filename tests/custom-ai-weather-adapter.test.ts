import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { normalizeWeather, LONDON_RAIN } from "../lib/custom-ai/feed-adapters/weather.server";
const value = (time: number, rain: number) => ({ latitude: 51.5, longitude: -0.12, current_units: { rain: "mm", time: "unixtime" }, current: { time, rain } });
describe("weather observation semantics", () => {
  it("does not fabricate transitions or fresh timestamps by polling", () => {
    const first = normalizeWeather(value(1000, 0), LONDON_RAIN, 1010);
    expect(normalizeWeather(value(1000, 0), LONDON_RAIN, 1020, first)).toEqual(first);
    const second = normalizeWeather(value(1100, 0), LONDON_RAIN, 1110, first);
    expect(second.transitionSequence).toBe("0");
    const rain = normalizeWeather(value(1200, 0.2), LONDON_RAIN, 1210, second);
    expect(rain).toMatchObject({ value: "200", previousValue: "0", changedAt: 1200, transitionSequence: "1" });
  });
  it("rejects a changed old value, stale observation and wrong unit/location", () => {
    const first = normalizeWeather(value(1000, 0), LONDON_RAIN, 1010);
    expect(() => normalizeWeather(value(1000, 1), LONDON_RAIN, 1010, first)).toThrow();
    expect(() => normalizeWeather(value(1000, 0), LONDON_RAIN, 3000)).toThrow();
    expect(() => normalizeWeather({ ...value(1000, 0), latitude: 10 }, LONDON_RAIN, 1010)).toThrow();
    expect(() => normalizeWeather({ ...value(1000, 0), current_units: { rain: "inch" } }, LONDON_RAIN, 1010)).toThrow();
  });
});
