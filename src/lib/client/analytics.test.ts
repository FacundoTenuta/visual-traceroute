import { afterEach, describe, expect, it, vi } from "vitest";
import { gaInitScript, parseGaIds, track } from "./analytics";

describe("parseGaIds", () => {
  it("returns no ids when the variable is unset or blank", () => {
    expect(parseGaIds(undefined)).toEqual([]);
    expect(parseGaIds("")).toEqual([]);
    expect(parseGaIds(" , ,")).toEqual([]);
  });

  it("splits a comma-separated list, trimming blanks and duplicates in order", () => {
    expect(parseGaIds(" G-4RGE1D3764 ,G-S6QYX1R889,,G-4RGE1D3764")).toEqual(["G-4RGE1D3764", "G-S6QYX1R889"]);
  });

  it("drops entries that are not measurement ids, so nothing else reaches the inline script", () => {
    expect(parseGaIds("G-ABC123,');alert(1);//,UA-1234-1,G-")).toEqual(["G-ABC123"]);
  });
});

describe("gaInitScript", () => {
  it("sets up gtag once and configures every id without a manual page_view", () => {
    const script = gaInitScript(["G-ONE", "G-TWO"]);
    expect(script).toContain("window.dataLayer=window.dataLayer||[]");
    expect(script).toContain("gtag('js',new Date())");
    expect(script).toContain(`gtag('config',"G-ONE")`);
    expect(script).toContain(`gtag('config',"G-TWO")`);
    expect(script).not.toContain("page_view");
    expect(script).not.toContain("cookie_domain");
  });
});

describe("track", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("is a no-op without a window or without gtag", () => {
    expect(() => track("trace_start", { target_type: "ip" })).not.toThrow();
    vi.stubGlobal("window", {});
    expect(() => track("trace_start", { target_type: "ip" })).not.toThrow();
  });

  it("forwards the event name and params to gtag", () => {
    const gtag = vi.fn();
    vi.stubGlobal("window", { gtag });
    track("hop_select", { hop: 4, reached: true, theme: "dark" });
    expect(gtag).toHaveBeenCalledTimes(1);
    expect(gtag).toHaveBeenCalledWith("event", "hop_select", { hop: 4, reached: true, theme: "dark" });
  });

  it("sends an event without params as an empty object", () => {
    const gtag = vi.fn();
    vi.stubGlobal("window", { gtag });
    track("replay_route");
    expect(gtag).toHaveBeenCalledWith("event", "replay_route", {});
  });

  it("drops empty values and caps strings at 100 characters", () => {
    const gtag = vi.fn();
    vi.stubGlobal("window", { gtag });
    track("trace_start", { target_host: "a".repeat(150), asn: undefined, origin_city: null });
    expect(gtag).toHaveBeenCalledWith("event", "trace_start", { target_host: "a".repeat(100) });
  });

  it("never throws when gtag does", () => {
    vi.stubGlobal("window", {
      gtag: () => {
        throw new Error("blocked");
      },
    });
    expect(() => track("theme_change", { theme: "light" })).not.toThrow();
  });
});
