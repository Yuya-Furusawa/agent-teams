import { describe, it, expect } from "vitest";
import { parsePbiNumber } from "./pbi-input.js";

describe("parsePbiNumber", () => {
  it("parses bare number", () => {
    expect(parsePbiNumber("42")).toBe(42);
    expect(parsePbiNumber("1")).toBe(1);
    expect(parsePbiNumber("1234")).toBe(1234);
  });
  it("parses PBI-NN forms", () => {
    expect(parsePbiNumber("PBI-42")).toBe(42);
    expect(parsePbiNumber("PBI-042")).toBe(42);
    expect(parsePbiNumber("pbi-42")).toBe(42); // case-insensitive prefix
  });
  it("returns null for non-numeric / multi-token strings", () => {
    expect(parsePbiNumber("add a button")).toBe(null);
    expect(parsePbiNumber("42 things")).toBe(null);
    expect(parsePbiNumber("")).toBe(null);
    expect(parsePbiNumber("PBI-")).toBe(null);
  });
  it("trims surrounding whitespace", () => {
    expect(parsePbiNumber("  42  ")).toBe(42);
    expect(parsePbiNumber(" PBI-42 ")).toBe(42);
  });
});
