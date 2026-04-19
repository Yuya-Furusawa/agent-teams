import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CalendarPicker } from "./CalendarPicker";

describe("CalendarPicker", () => {
  it("calls onSelect with the clicked day's date key", () => {
    const onSelect = vi.fn();
    const { container } = render(
      <CalendarPicker
        selectedDateKey="2026-04-15"
        onSelect={onSelect}
        activeDateKeys={new Set()}
      />,
    );
    const day10 = container.querySelector('[aria-label="2026-04-10"]');
    expect(day10).not.toBeNull();
    fireEvent.click(day10!);
    expect(onSelect).toHaveBeenCalledWith("2026-04-10");
  });

  it("marks the selected day", () => {
    const { container } = render(
      <CalendarPicker
        selectedDateKey="2026-04-15"
        onSelect={() => {}}
        activeDateKeys={new Set()}
      />,
    );
    const selected = container.querySelector('[aria-pressed="true"]');
    expect(selected?.getAttribute("aria-label")).toBe("2026-04-15");
  });

  it("shows prev/next navigation and changes the month", () => {
    const { container } = render(
      <CalendarPicker
        selectedDateKey="2026-04-15"
        onSelect={() => {}}
        activeDateKeys={new Set()}
      />,
    );
    expect(screen.getByText(/Apr 2026/)).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Previous month"));
    expect(screen.getByText(/Mar 2026/)).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Next month"));
    fireEvent.click(screen.getByLabelText("Next month"));
    expect(screen.getByText(/May 2026/)).toBeTruthy();
    expect(container).toBeDefined();
  });

  it("renders an activity dot for active days", () => {
    const { container } = render(
      <CalendarPicker
        selectedDateKey="2026-04-15"
        onSelect={() => {}}
        activeDateKeys={new Set(["2026-04-10"])}
      />,
    );
    const day10 = container.querySelector('[aria-label="2026-04-10"]');
    expect(day10?.querySelector(".bg-ok")).not.toBeNull();
  });
});
