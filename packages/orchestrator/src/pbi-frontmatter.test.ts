import { describe, it, expect } from "vitest";
import { extractSlug } from "./pbi-frontmatter.js";

describe("extractSlug", () => {
  it("reads slug from yaml frontmatter", () => {
    const md = `---\nid: 42\nslug: pbi-creation-mode\ntitle: x\n---\n# body`;
    expect(extractSlug(md)).toBe("pbi-creation-mode");
  });
  it("returns null when no frontmatter", () => {
    expect(extractSlug("# just a heading")).toBe(null);
  });
  it("returns null when slug missing in frontmatter", () => {
    const md = `---\nid: 42\ntitle: x\n---\nbody`;
    expect(extractSlug(md)).toBe(null);
  });
  it("rejects slugs with invalid chars (returns null)", () => {
    const md = `---\nslug: Has Space\n---\nx`;
    expect(extractSlug(md)).toBe(null);
  });
  it("strips quotes around slug value", () => {
    const md = `---\nslug: "quoted-slug"\n---\nx`;
    expect(extractSlug(md)).toBe("quoted-slug");
  });
});
