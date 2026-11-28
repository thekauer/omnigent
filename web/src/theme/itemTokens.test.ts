// The item tokens (layout plan L11): the idle session row's text, the composer's send button,
// the account avatar, the message and list timestamps' font, and the activity bar's item
// colours. Each defaults to what the item uses today (unset for the timestamp font, which then
// inherits the document font), so a theme sets them like any token and nothing else changes.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { TIMESTAMP_FONT_CLASS } from "@/lib/relativeTime";
import { VSCODE_COLOR_ALIAS_MAP } from "./vscodeColorAliases";
import { parseThemeFile, type ThemeFileOptions } from "./themeFile";
import { getToken } from "./tokens/registry";
import { TOKEN_CONSTRAINTS } from "./validate";

const source = (path: string) =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
const INDEX_CSS = source("../index.css");
const ACTIVITY_BAR_TSX = source("../shell/ActivityBar.tsx");
const SIDEBAR_TSX = source("../shell/Sidebar.tsx");
const SERVER_PICKER_TSX = source("../shell/SidebarServerPicker.tsx");
const BUBBLE_PARTS_TSX = source("../components/chat/chatBubbleParts.tsx");
const SESSION_ROW_META_TSX = source("../shell/sessionRowMeta.tsx");
// The list and review timestamps that take the timestamp font (the session hover card and the
// Kanban card are in Sidebar.tsx and sessionRowMeta.tsx).
const TIMESTAMP_LIST_FILES = [
  "pages/InboxPage.tsx",
  "shell/PullRequestCommitsList.tsx",
  "shell/ChangesReviewCommit.tsx",
  "shell/ChangesReviewCommits.tsx",
  "shell/PullRequestReviewThread.tsx",
  "shell/PullRequestPanelDetails.tsx",
  "shell/extensionViews/ViewPlan.tsx",
  "shell/WorktreeRadioRow.tsx",
  "components/usage/UsageSessionTable.tsx",
];

const OPTIONS: ThemeFileOptions = {
  uiTheme: "dark",
  context: {
    isKnownToken: (id) => getToken(id) !== undefined && !TOKEN_CONSTRAINTS[id]?.internal,
    fontFamily: () => undefined,
  },
  extensionColors: new Map(),
  assetUrl: () => undefined,
};

const parse = (tokens: Record<string, string>) => parseThemeFile({ omnigent: { tokens } }, OPTIONS);

/** Each new token: its kind, and its defaults in each mode (undefined: unset). */
const ITEM_TOKENS: Record<string, { kind: string; light?: string; dark?: string }> = {
  "ui-sidebar-row-idle-foreground": {
    kind: "color",
    light: "var(--foreground)",
    dark: "var(--foreground)",
  },
  "ui-composer-send-background": { kind: "color" },
  "ui-composer-send-foreground": { kind: "color" },
  "ui-account-avatar-background": {
    kind: "image",
    light: "var(--secondary)",
    dark: "var(--secondary)",
  },
  "ui-account-avatar-foreground": {
    kind: "color",
    light: "var(--secondary-foreground)",
    dark: "var(--secondary-foreground)",
  },
  "ui-account-avatar-radius": { kind: "length", light: "9999px", dark: "9999px" },
  "ui-font-timestamp": { kind: "font" },
  "ui-activitybar-item-size": { kind: "length", light: "2.5rem", dark: "2.5rem" },
  "ui-activitybar-foreground": {
    kind: "color",
    light: "var(--muted-foreground)",
    dark: "var(--muted-foreground)",
  },
  "ui-activitybar-active-foreground": {
    kind: "color",
    light: "var(--sidebar-active-foreground)",
    dark: "var(--sidebar-active-foreground)",
  },
  "ui-activitybar-active-background": {
    kind: "color",
    light: "var(--sidebar-active)",
    dark: "var(--sidebar-active)",
  },
  "ui-activitybar-active-border": {
    kind: "color",
    light: "var(--sidebar-active-foreground)",
    dark: "var(--sidebar-active-foreground)",
  },
  "ui-activitybar-badge-background": {
    kind: "color",
    light: "var(--primary)",
    dark: "var(--primary)",
  },
  "ui-activitybar-badge-foreground": {
    kind: "color",
    light: "var(--primary-foreground)",
    dark: "var(--primary-foreground)",
  },
};

describe("item tokens", () => {
  it("registers each with its kind and today's value (or unset)", () => {
    for (const [id, { kind, light, dark }] of Object.entries(ITEM_TOKENS)) {
      const token = getToken(id);
      expect(token, id).toBeDefined();
      expect(token!.kind, id).toBe(kind);
      expect(token!.default?.light, id).toBe(light);
      expect(token!.default?.dark, id).toBe(dark);
    }
    // Unset by default: the send button keeps the primary call-to-action, the timestamp
    // font inherits the document font.
    expect(getToken("ui-composer-send-background")!.default).toEqual({});
    expect(getToken("ui-composer-send-foreground")!.default).toEqual({});
    expect(getToken("ui-font-timestamp")!.default).toEqual({});
  });

  it("reads each where it applies, with today's value as the fallback", () => {
    // The idle session row: the active row's own text colour still wins (twMerge keeps the later).
    expect(SIDEBAR_TSX).toContain(
      '"relative flex text-left text-(--ui-sidebar-row-idle-foreground) transition-colors"',
    );
    // The send button, while it can send; the mobile override follows it.
    expect(INDEX_CSS).toContain(
      "background: var(--ui-composer-send-background, var(--primary-cta));",
    );
    expect(INDEX_CSS).toContain(
      "color: var(--ui-composer-send-foreground, var(--primary-cta-foreground));",
    );
    expect(INDEX_CSS).toContain(
      '[data-slot="composer-send"][data-variant="default"]:not(:disabled) {',
    );
    // The avatar: both places draw the same fallback, through the hook.
    expect(SERVER_PICKER_TSX).toContain('data-slot="account-avatar"');
    expect(INDEX_CSS).toContain(
      "background: var(--ui-account-avatar-background, var(--secondary));",
    );
    expect(INDEX_CSS).toContain(
      "color: var(--ui-account-avatar-foreground, var(--secondary-foreground));",
    );
    // The radius: the fallback, and the root that clips it (and its ring).
    expect(INDEX_CSS).toContain("border-radius: var(--ui-account-avatar-radius, 9999px);");
    expect(INDEX_CSS).toContain(
      '[data-slot="avatar"]:has(> [data-slot="account-avatar"])::after {',
    );
    // Timestamps: the message ones, and every list's or hover card's time through the shared class.
    expect(BUBBLE_PARTS_TSX.match(/font-\(family-name:--ui-font-timestamp\)/g)).toHaveLength(2);
    expect(SIDEBAR_TSX).toContain(
      '"right-2 font-(family-name:--ui-font-timestamp) text-sm text-muted-foreground"',
    );
    expect(TIMESTAMP_FONT_CLASS).toBe("font-(family-name:--ui-font-timestamp)");
    // The session hover card's two times (the import, and the two uses), and the Kanban card's
    // (through SessionUpdatedLabel in sessionRowMeta.tsx).
    expect(SIDEBAR_TSX.match(/TIMESTAMP_FONT_CLASS/g)).toHaveLength(3);
    expect(SESSION_ROW_META_TSX).toContain("TIMESTAMP_FONT_CLASS");
    for (const file of TIMESTAMP_LIST_FILES) {
      expect(source(`../${file}`), file).toContain("TIMESTAMP_FONT_CLASS");
    }
    // The activity bar's items: idle, active, the active edge and the badge.
    expect(ACTIVITY_BAR_TSX).toContain("text-(--ui-activitybar-foreground)");
    expect(ACTIVITY_BAR_TSX).toContain("size-(--ui-activitybar-item-size)");
    expect(ACTIVITY_BAR_TSX).toContain("bg-(--ui-activitybar-active-background)");
    expect(ACTIVITY_BAR_TSX).toContain("text-(--ui-activitybar-active-foreground)");
    expect(ACTIVITY_BAR_TSX).toContain("before:bg-(--ui-activitybar-active-border)");
    expect(ACTIVITY_BAR_TSX).toContain("bg-(--ui-activitybar-badge-background)");
    expect(ACTIVITY_BAR_TSX).toContain("text-(--ui-activitybar-badge-foreground)");
  });

  it("maps the VS Code activity bar ids onto the item tokens", () => {
    // VS Code's `activityBar.foreground` is the active item's, `inactiveForeground` the idle one's.
    expect(VSCODE_COLOR_ALIAS_MAP.get("activityBar.foreground")).toEqual([
      "ui-activitybar-active-foreground",
    ]);
    expect(VSCODE_COLOR_ALIAS_MAP.get("activityBar.inactiveForeground")).toEqual([
      "ui-activitybar-foreground",
    ]);
    expect(VSCODE_COLOR_ALIAS_MAP.get("activityBar.activeBackground")).toEqual([
      "ui-activitybar-active-background",
    ]);
    expect(VSCODE_COLOR_ALIAS_MAP.get("activityBar.activeBorder")).toEqual([
      "ui-activitybar-active-border",
    ]);
    expect(VSCODE_COLOR_ALIAS_MAP.get("activityBarBadge.background")).toEqual([
      "ui-activitybar-badge-background",
    ]);
    expect(VSCODE_COLOR_ALIAS_MAP.get("activityBarBadge.foreground")).toEqual([
      "ui-activitybar-badge-foreground",
    ]);
  });

  it("takes a theme's values, a gradient for the avatar included", () => {
    const parsed = parse({
      "ui-sidebar-row-idle-foreground": "#a1a1a1",
      "ui-composer-send-background": "#ededed",
      "ui-composer-send-foreground": "#0a0a0a",
      "ui-account-avatar-background": "linear-gradient(135deg, #006bff, #a1a1a1)",
      "ui-account-avatar-foreground": "#0a0a0a",
      "ui-account-avatar-radius": "0",
      "ui-font-timestamp": '"Geist Mono Variable", ui-monospace, monospace',
      "ui-activitybar-item-size": "36px",
      "ui-activitybar-foreground": "var(--muted-foreground)",
      "ui-activitybar-active-foreground": "var(--primary)",
      "ui-activitybar-active-background": "var(--sidebar-active)",
      "ui-activitybar-active-border": "var(--primary)",
      "ui-activitybar-badge-background": "#006bff",
      "ui-activitybar-badge-foreground": "#ffffff",
    });
    expect(parsed.issues).toEqual([]);
    expect(Object.keys(parsed.tokens)).toHaveLength(14);
    expect(parsed.tokens["ui-activitybar-item-size"]?.value).toBe("36px");
    expect(parsed.tokens["ui-account-avatar-radius"]?.value).toBe("0");
    expect(parsed.tokens["ui-account-avatar-background"]?.value).toBe(
      "linear-gradient(135deg, #006bff, #a1a1a1)",
    );
  });

  it("rejects a timestamp font that is not a font list", () => {
    const parsed = parse({ "ui-font-timestamp": "url(https://example.com/font.woff2)" });
    expect(parsed.tokens["ui-font-timestamp"]).toBeUndefined();
    expect(parsed.issues.join("\n")).toContain("ui-font-timestamp");
  });
});
