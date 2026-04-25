import { describe, it, expect } from "vitest";
import { PBI_FILENAME_REGEX, formatPbiFilename, parsePbiFilename } from "./pbi-filename.js";

describe("PBI_FILENAME_REGEX", () => {
  it("matches valid filenames", () => {
    expect(PBI_FILENAME_REGEX.test("PBI-001-foo.md")).toBe(true);
    expect(PBI_FILENAME_REGEX.test("PBI-042-pbi-creation-mode.md")).toBe(true);
    expect(PBI_FILENAME_REGEX.test("PBI-1000-x.md")).toBe(true);
  });
  it("rejects invalid filenames", () => {
    expect(PBI_FILENAME_REGEX.test("PBI-1-foo.md")).toBe(false);     // < 3 digits
    expect(PBI_FILENAME_REGEX.test("PBI-042.md")).toBe(false);        // no slug
    expect(PBI_FILENAME_REGEX.test("PBI-042-Foo.md")).toBe(false);    // uppercase
    expect(PBI_FILENAME_REGEX.test("pbi-042-foo.md")).toBe(false);    // lowercase prefix
  });
});

describe("formatPbiFilename", () => {
  it("zero-pads to 3 digits", () => {
    expect(formatPbiFilename(1, "foo")).toBe("PBI-001-foo.md");
    expect(formatPbiFilename(42, "pbi-creation-mode")).toBe("PBI-042-pbi-creation-mode.md");
  });
  it("preserves 4-digit numbers", () => {
    expect(formatPbiFilename(1234, "x")).toBe("PBI-1234-x.md");
  });
  it("rejects invalid slugs", () => {
    expect(() => formatPbiFilename(1, "Has Space")).toThrow();
    expect(() => formatPbiFilename(1, "")).toThrow();
  });
});

describe("parsePbiFilename", () => {
  it("extracts number and slug", () => {
    expect(parsePbiFilename("PBI-042-foo-bar.md")).toEqual({ id: 42, slug: "foo-bar" });
  });
  it("returns null for invalid names", () => {
    expect(parsePbiFilename("not-a-pbi.md")).toBe(null);
  });
});
