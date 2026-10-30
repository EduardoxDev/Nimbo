import type { LucideIcon } from "lucide-react";
import "./IslandTabs.css";

export type IslandTab<Page extends string> = {
  id: Page;
  label: string;
  icon: LucideIcon;
};

/**
 * Page switcher shared by every island page. "header" shows icons with the
 * active page's name; "compact" is the small capsule under the player, which
 * shows dots and opens into icons on hover when `revealIcons` is on.
 */
export function IslandTabs<Page extends string>({
  tabs,
  current,
  label,
  variant,
  revealIcons = true,
  onChange,
}: {
  tabs: IslandTab<Page>[];
  current: Page;
  label: string;
  variant: "header" | "compact";
  revealIcons?: boolean;
  onChange: (page: Page) => void;
}) {
  return (
    <nav
      className={[
        "island-tabs",
        `island-tabs--${variant}`,
        revealIcons ? "island-tabs--reveal" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      aria-label={label}
      data-window-drag="false"
    >
      {tabs.map(({ id, label: tabLabel, icon: Icon }) => {
        const isActive = id === current;
        return (
          <button
            key={id}
            className={`island-tab${isActive ? " island-tab--active" : ""}`}
            type="button"
            title={tabLabel}
            aria-label={tabLabel}
            aria-current={isActive ? "page" : undefined}
            onClick={(event) => {
              event.stopPropagation();
              onChange(id);
            }}
          >
            <Icon className="island-tab__icon" size={variant === "header" ? 15 : 12} strokeWidth={2.2} aria-hidden="true" />
            {variant === "header" && isActive && <span className="island-tab__label">{tabLabel}</span>}
          </button>
        );
      })}
    </nav>
  );
}
