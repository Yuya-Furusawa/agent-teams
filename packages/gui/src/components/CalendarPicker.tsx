import { useMemo, useState } from "react";
import { toLocalDateKey } from "../lib/time";

const WEEKDAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];

function buildMonthGrid(year: number, month: number): Date[] {
  const firstOfMonth = new Date(year, month, 1);
  const startOffset = firstOfMonth.getDay();
  const gridStart = new Date(year, month, 1 - startOffset);
  const cells: Date[] = [];
  for (let i = 0; i < 42; i++) {
    cells.push(new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i));
  }
  return cells;
}

export function CalendarPicker({
  selectedDateKey,
  onSelect,
  activeDateKeys,
}: {
  selectedDateKey: string;
  onSelect: (dateKey: string) => void;
  activeDateKeys: Set<string>;
}): JSX.Element {
  const [cursor, setCursor] = useState(() => {
    const parts = selectedDateKey.split("-").map((n) => parseInt(n, 10));
    const y = parts[0] ?? new Date().getFullYear();
    const m = parts[1] ?? new Date().getMonth() + 1;
    return { year: y, month: m - 1 };
  });

  const todayKey = useMemo(() => toLocalDateKey(Date.now()), []);
  const cells = useMemo(() => buildMonthGrid(cursor.year, cursor.month), [cursor]);

  const goPrev = () => {
    setCursor((c) => {
      const d = new Date(c.year, c.month - 1, 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });
  };
  const goNext = () => {
    setCursor((c) => {
      const d = new Date(c.year, c.month + 1, 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });
  };
  const goToday = () => {
    const t = new Date();
    setCursor({ year: t.getFullYear(), month: t.getMonth() });
    onSelect(todayKey);
  };

  const monthLabel = new Date(cursor.year, cursor.month, 1).toLocaleString("en-US", {
    month: "short",
    year: "numeric",
  });

  return (
    <div className="px-3 py-2 border-b border-neutral-800 text-neutral-200 select-none">
      <div className="flex items-center justify-between mb-1">
        <button
          type="button"
          onClick={goPrev}
          aria-label="Previous month"
          className="w-6 h-6 text-neutral-400 hover:text-neutral-100"
        >
          ‹
        </button>
        <button
          type="button"
          onClick={goToday}
          className="text-xs text-neutral-300 hover:text-neutral-100"
          title="Jump to today"
        >
          {monthLabel}
        </button>
        <button
          type="button"
          onClick={goNext}
          aria-label="Next month"
          className="w-6 h-6 text-neutral-400 hover:text-neutral-100"
        >
          ›
        </button>
      </div>
      <div className="grid grid-cols-7 gap-0.5 text-[10px] text-neutral-500 mb-0.5">
        {WEEKDAY_LABELS.map((d, i) => (
          <div key={i} className="text-center">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-0.5">
        {cells.map((d) => {
          const key = toLocalDateKey(d);
          const inMonth = d.getMonth() === cursor.month;
          const isSelected = key === selectedDateKey;
          const isToday = key === todayKey;
          const hasTasks = activeDateKeys.has(key);
          const base =
            "relative w-full h-7 text-[11px] flex items-center justify-center rounded";
          let cls = base;
          if (isSelected) {
            cls += " bg-neutral-100 text-neutral-900";
          } else if (!inMonth) {
            cls += " text-neutral-600 hover:bg-neutral-900";
          } else {
            cls += " text-neutral-200 hover:bg-neutral-800";
          }
          if (!isSelected && isToday) {
            cls += " ring-1 ring-inset ring-neutral-500";
          }
          return (
            <button
              type="button"
              key={key}
              onClick={() => onSelect(key)}
              className={cls}
              aria-pressed={isSelected}
              aria-label={key}
            >
              {d.getDate()}
              {hasTasks && !isSelected && (
                <span
                  className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-ok"
                  aria-hidden
                />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
