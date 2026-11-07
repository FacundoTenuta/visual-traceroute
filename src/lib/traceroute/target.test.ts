import { describe, expect, it } from "vitest";
import { validateTarget } from "./target";

describe("validateTarget", () => {
  it.each([
    ["google.com", "google.com"],
    ["  Example.ORG  ", "example.org"],
    ["1.1.1.1", "1.1.1.1"],
    ["sub-domain.example.co.uk", "sub-domain.example.co.uk"],
    ["https://github.com/some/path?q=1", "github.com"],
    ["http://8.8.8.8:8080/", "8.8.8.8"],
    ["localhost", "localhost"],
    ["0xdead.com", "0xdead.com"],
  ])("accepts %j as %j", (input, expected) => {
    expect(validateTarget(input)).toEqual({ ok: true, value: expected });
  });

  it.each([
    ["", "Enter a hostname or IPv4 address."],
    ["   ", "Enter a hostname or IPv4 address."],
    ["-m 1 google.com", "Invalid hostname or IPv4 address."],
    ["-I", "Invalid hostname or IPv4 address."],
    ["google.com; rm -rf /", "Invalid hostname or IPv4 address."],
    ["$(whoami).com", "Invalid hostname or IPv4 address."],
    ["exa_mple.com", "Invalid hostname or IPv4 address."],
    ["-bad.com", "Invalid hostname or IPv4 address."],
    ["bad-.com", "Invalid hostname or IPv4 address."],
    ["999.1.1.1", "Invalid hostname or IPv4 address."],
    ["2606:4700::1111", "IPv6 targets are not supported yet."],
    ["0x7f.1", "Invalid hostname or IPv4 address."],
    ["0x7f000001", "Invalid hostname or IPv4 address."],
    ["0x7f.0.0.1", "Invalid hostname or IPv4 address."],
    [`${"a".repeat(64)}.com`, "Invalid hostname or IPv4 address."],
  ])("rejects %j", (input, error) => {
    expect(validateTarget(input)).toEqual({ ok: false, error });
  });
});
