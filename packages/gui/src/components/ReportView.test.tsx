import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ReportView } from "./ReportView";

describe("ReportView", () => {
  it("renders markdown content", () => {
    render(<ReportView body={"# Hello"} loading={false} missingLabel="x" />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Hello");
  });

  it("shows missing label when body is null", () => {
    render(<ReportView body={null} loading={false} missingLabel="No report yet" />);
    expect(screen.getByText("No report yet")).toBeTruthy();
  });

  it("shows loading state", () => {
    render(<ReportView body={null} loading={true} missingLabel="No report yet" />);
    expect(screen.getByText("Loading…")).toBeTruthy();
  });

  it("lifts つぶやき out of the markdown and renders it as a banner", () => {
    const md = [
      "# headline",
      "",
      "## つぶやき",
      "「テスト先に書いたら勝ち確。」",
      "",
      "— Mika",
    ].join("\n");
    render(<ReportView body={md} loading={false} missingLabel="x" />);
    expect(screen.getByText("つぶやき")).toBeTruthy();
    expect(screen.getByText("「テスト先に書いたら勝ち確。」")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "つぶやき" })).toBeNull();
  });
});
