import { useEffect, useMemo, useRef, useState } from "react";
import { EMOJI_GROUPS, ICON_GROUPS } from "../../lib/chart-plugins/drawing-tools/icon-data.ts";
import { ensureIconFont, selectEmoji, selectIcon, twemojiUrl } from "../../lib/chart-plugins/drawing-tools/icontools.ts";
import { safeStorage } from "../../lib/safe-storage.ts";
import { cn } from "../../lib/utils.ts";
import { notAvailable } from "./notAvailable.ts";

/**
 * TradingView's Icons flyout: 354px wide, a row of group buttons over a list
 * of titled groups (38px cells), and the Emojis / Stickers / Icons tabs along
 * the bottom. "recently used" keeps the last 18 picks per tab.
 */

type Tab = "emojis" | "stickers" | "icons";
const CELL = 38;
const COLUMNS = Math.floor((354 - 12) / CELL);
const MAX_RECENT = 18;
const TAB_KEY = "tv_icons_tab";
const RECENT_KEY = { emojis: "tv_recent_emojis", icons: "tv_recent_icons" } as const;

function readRecent<T>(key: string): T[] {
  try {
    const v = JSON.parse(safeStorage.getItem(key) ?? "[]");
    return Array.isArray(v) ? (v as T[]) : [];
  } catch {
    return [];
  }
}

function pushRecent<T>(key: string, item: T): void {
  const next = [item, ...readRecent<T>(key).filter((x) => x !== item)].slice(0, MAX_RECENT);
  safeStorage.setItem(key, JSON.stringify(next));
}

export function EmojiGlyph({ emoji, size = 24 }: { emoji: string; size?: number }) {
  return <img src={twemojiUrl(emoji, "png")} width={size} height={size} alt="" draggable={false} decoding="async" />;
}

export function IconGlyph({ icon, size = 22, className }: { icon: number; size?: number; className?: string }) {
  return (
    <span className={className} style={{ fontFamily: "FontAwesome", fontSize: size, lineHeight: 1 }} aria-hidden="true">
      {String.fromCodePoint(icon)}
    </span>
  );
}

export function IconsPicker({ onPick }: { onPick: (kind: "emoji" | "icon") => void }) {
  const [tab, setTab] = useState<Tab>(() => {
    const t = safeStorage.getItem(TAB_KEY);
    return t === "icons" ? "icons" : "emojis";
  });
  useEffect(() => {
    ensureIconFont();
  }, []);
  const groups = useMemo(() => {
    if (tab === "icons") {
      const recent = readRecent<number>(RECENT_KEY.icons);
      return [{ title: "recently used", items: recent }, ...ICON_GROUPS.map((g) => ({ title: g.title, items: g.icons }))];
    }
    const recent = readRecent<string>(RECENT_KEY.emojis);
    return [{ title: "recently used", items: recent }, ...EMOJI_GROUPS.map((g) => ({ title: g.title, items: g.emojis }))];
  }, [tab]);
  const listRef = useRef<HTMLDivElement>(null);
  const [activeGroup, setActiveGroup] = useState(groups.find((g) => g.items.length)?.title ?? "");

  const pick = (item: string | number) => {
    if (tab === "icons") {
      selectIcon(item as number);
      pushRecent(RECENT_KEY.icons, item);
      onPick("icon");
    } else {
      selectEmoji(item as string);
      pushRecent(RECENT_KEY.emojis, item);
      onPick("emoji");
    }
  };
  const chooseTab = (t: Tab) => {
    if (t === "stickers") {
      notAvailable("Stickers");
      return;
    }
    setTab(t);
    safeStorage.setItem(TAB_KEY, t);
    listRef.current?.scrollTo({ top: 0 });
  };
  const visible = groups.filter((g) => g.items.length > 0);

  return (
    <div className="w-[354px]" onMouseDown={(e) => e.stopPropagation()}>
      <div className="flex px-[12px]">
        {visible.map((g) => (
          <button
            key={g.title}
            type="button"
            title={g.title}
            aria-pressed={activeGroup === g.title}
            onClick={() => {
              setActiveGroup(g.title);
              listRef.current?.querySelector(`[data-group="${g.title}"]`)?.scrollIntoView({ block: "start" });
            }}
            className={cn(
              "flex h-[38px] flex-1 items-center justify-center border-b-2 text-muted-foreground hover:text-foreground",
              activeGroup === g.title ? "border-foreground text-foreground" : "border-transparent",
            )}
          >
            {tab === "icons" ? <IconGlyph icon={g.items[0] as number} size={16} /> : <EmojiGlyph emoji={g.items[0] as string} size={18} />}
          </button>
        ))}
      </div>
      <div
        ref={listRef}
        className="max-h-[360px] overflow-y-auto px-[6px]"
        onScroll={(e) => {
          const top = e.currentTarget.scrollTop;
          let current = activeGroup;
          for (const el of e.currentTarget.querySelectorAll<HTMLElement>("[data-group]")) {
            if (el.offsetTop - e.currentTarget.offsetTop <= top + 4) current = el.dataset.group ?? current;
          }
          if (current !== activeGroup) setActiveGroup(current);
        }}
      >
        {visible.map((g) => (
          <div key={g.title} data-group={g.title}>
            <div className="px-[6px] pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{g.title}</div>
            <div className="grid" style={{ gridTemplateColumns: `repeat(${COLUMNS}, ${CELL}px)` }}>
              {g.items.map((item) => (
                <button
                  key={String(item)}
                  type="button"
                  onClick={() => pick(item)}
                  className="flex h-[38px] w-[38px] items-center justify-center rounded hover:bg-secondary"
                >
                  {tab === "icons" ? <IconGlyph icon={item as number} /> : <EmojiGlyph emoji={item as string} />}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="flex h-[43px] justify-center border-t border-border px-[6px] pb-[4px]">
        {(["emojis", "stickers", "icons"] as const).map((t) => (
          <button
            key={t}
            type="button"
            aria-pressed={tab === t}
            onClick={() => chooseTab(t)}
            className={cn(
              "px-3 text-[16px] capitalize leading-6 hover:text-foreground",
              tab === t ? "text-foreground" : "text-muted-foreground",
            )}
          >
            {t === "emojis" ? "Emojis" : t === "stickers" ? "Stickers" : "Icons"}
          </button>
        ))}
      </div>
    </div>
  );
}
