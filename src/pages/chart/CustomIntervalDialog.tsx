import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { cn } from "../../lib/utils.ts";
import type { Timeframe } from "../trading/constants.ts";
import { notAvailable } from "./notAvailable.ts";
import { useDismiss } from "./shared.ts";

/** TradingView's types, in its order; ranges are a paid feature. */
const TYPES = [
  { label: "minutes", unit: "m" },
  { label: "hours", unit: "h" },
  { label: "days", unit: "d" },
  { label: "weeks", unit: "w" },
  { label: "months", unit: "M" },
  { label: "range", unit: null },
] as const;

/**
 * "Add custom interval": a type and a count. Add stays disabled until the
 * count is a positive whole number; the new interval opens at once.
 */
export function CustomIntervalDialog({
  open,
  onClose,
  onAdd,
}: {
  open: boolean;
  onClose: () => void;
  onAdd: (tf: Timeframe) => void;
}) {
  if (!open) return null;
  return <DialogBody onClose={onClose} onAdd={onAdd} />;
}

function DialogBody({ onClose, onAdd }: { onClose: () => void; onAdd: (tf: Timeframe) => void }) {
  const [type, setType] = useState<(typeof TYPES)[number]>(TYPES[0]);
  const [value, setValue] = useState("");
  const [listOpen, setListOpen] = useState(false);
  const ref = useDismiss<HTMLDivElement>(true, onClose);
  const n = /^\d+$/.test(value) ? Number(value) : 0;
  const valid = n > 0 && type.unit !== null;
  const submit = () => {
    if (valid) onAdd(`${n}${type.unit}` as Timeframe);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center px-4">
      <div
        ref={ref}
        role="dialog"
        aria-label="Add custom interval"
        data-name="add-custom-interval-dialog"
        className="w-[400px] max-w-full rounded-[6px] bg-popover text-foreground shadow-[0_2px_24px_rgba(0,0,0,0.18)]"
      >
        <div className="flex h-[68px] items-center justify-between border-b border-border pl-5 pr-[22px]">
          <h2 className="text-[20px] font-semibold">Add custom interval</h2>
          <button type="button" onClick={onClose} aria-label="Close menu" className="flex h-6 w-6 items-center justify-center rounded hover:bg-secondary">
            <svg viewBox="0 0 14 14" className="h-[14px] w-[14px]" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
              <path d="m1.5 1.5 11 11m0-11-11 11" />
            </svg>
          </button>
        </div>
        <form
          className="px-5 py-5"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="flex h-[34px] items-center">
            <span className="w-[108px] text-[14px]">Type</span>
            <div className="relative">
              <button
                type="button"
                aria-haspopup="listbox"
                aria-expanded={listOpen}
                onClick={() => setListOpen((v) => !v)}
                className={cn(
                  "flex h-[34px] w-[180px] items-center justify-between rounded-[6px] border pl-2 pr-[6px] text-[14px]",
                  listOpen ? "border-[#2962ff]" : "border-border hover:border-muted-foreground",
                )}
              >
                {type.label}
                <ChevronDown className={cn("h-[18px] w-[18px] transition-transform", listOpen && "rotate-180")} strokeWidth={1.5} />
              </button>
              {listOpen && (
                <div role="listbox" className="absolute left-0 top-[38px] z-10 w-[180px] rounded-[6px] bg-popover py-[6px] shadow-[0_2px_4px_rgba(0,0,0,0.2)]">
                  {TYPES.map((t) => (
                    <button
                      key={t.label}
                      type="button"
                      role="option"
                      aria-selected={t === type}
                      onClick={() => {
                        setListOpen(false);
                        if (t.unit === null) notAvailable("Range intervals");
                        else setType(t);
                      }}
                      className={cn("flex h-8 w-full items-center px-3 text-left text-[14px]", t === type ? "bg-tv-active text-tv-active-foreground" : "hover:bg-secondary")}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="mt-3 flex h-[34px] items-center">
            <span className="w-[108px] text-[14px]">Interval</span>
            <input
              autoFocus
              inputMode="numeric"
              maxLength={6}
              value={value}
              onChange={(e) => setValue(e.target.value.replace(/\D/g, ""))}
              className="h-[34px] w-[180px] rounded-[6px] border border-border bg-transparent px-2 text-[14px] outline-none focus:border-[#2962ff]"
            />
          </div>
        </form>
        <div className="flex justify-end gap-3 border-t border-border px-5 py-4">
          <button type="button" onClick={onClose} className="h-[34px] rounded-[8px] border border-foreground px-[11px] text-[16px] hover:bg-secondary">
            Cancel
          </button>
          <button
            type="button"
            disabled={!valid}
            onClick={submit}
            className="h-[34px] rounded-[8px] bg-foreground px-[11px] text-[16px] text-background disabled:bg-secondary disabled:text-muted-foreground"
          >
            Add
          </button>
        </div>
      </div>
    </div>
  );
}
