// The default-hidden views and navigation entries (layout plan L11, decision 11): the setting's
// defaults, the user's choice over them (kept across reloads, undone by Reset Layout), a
// product's removal over both, the last-shown rule, and the old navigation list's migration.

import { beforeEach, describe, expect, it } from "vitest";
import workbenchManifest from "@/builtinExtensions/omnigent.workbench/package.json";
import { parseConfigurationContributions } from "@/configuration/configurationContributions";
import { ConfigurationRegistry } from "@/configuration/configurationRegistry";
import { ConfigurationService } from "@/configuration/configurationService";
import { SettingsStore } from "@/configuration/settingsStore";
import type { RailViewContribution } from "@/shell/railViews";
import { containerViews } from "@/shell/ViewContainerViews";
import {
  DEFAULT_HIDDEN_VIEWS_SETTING,
  defaultHiddenViewsOf,
  NO_DEFAULT_HIDDEN,
  readDefaultHiddenViews,
} from "./defaultHiddenViews";
import { LAYOUT_SLOTS, LayoutStateStore, RESETTABLE_LAYOUT_SLOTS } from "./layoutState";
import {
  isNavigationEntryHidden,
  readHiddenNavigationEntries,
  readNavigationEntryChoices,
  setNavigationEntryHidden,
} from "./sidebarNavigation";
import { ProductLayoutPolicy } from "./productLayout";
import { isViewHidden, readViewsLayout, updateViewLayout } from "./viewsLayout";

const FILES_VIEW = "omnigent.files.view";
const NEW_SESSION = "omnigent.newSession";
const USAGE = "omnigent.openUsage";
const NO_PRODUCT_POLICY = new ProductLayoutPolicy();

function configuration(...extra: [id: string, defaults: Record<string, unknown>][]) {
  const service = new ConfigurationService(new ConfigurationRegistry(), new SettingsStore());
  service.addExtension(
    "omnigent.workbench",
    parseConfigurationContributions("omnigent.workbench", workbenchManifest.contributes, {
      builtIn: true,
    }).contributions,
    undefined,
    { builtIn: true },
  );
  for (const [id, configurationDefaults] of extra) {
    service.addExtension(
      id,
      parseConfigurationContributions(id, { configurationDefaults }).contributions,
    );
  }
  return service;
}

/** A fresh store on the same document: what a reload reads. */
const reload = () => new LayoutStateStore();

beforeEach(() => {
  localStorage.clear();
});

describe("the defaults setting", () => {
  it("is an empty list the workbench registers, and configurationDefaults can set", () => {
    expect(readDefaultHiddenViews(configuration())).toEqual([]);
    const service = configuration(["acme.dev", { [DEFAULT_HIDDEN_VIEWS_SETTING]: [FILES_VIEW] }]);
    expect(readDefaultHiddenViews(service)).toEqual([FILES_VIEW]);
  });

  it("is replaced as a whole: the last registered default wins, a product's sits above all", () => {
    const service = configuration(
      ["acme.first", { [DEFAULT_HIDDEN_VIEWS_SETTING]: [FILES_VIEW] }],
      ["acme.last", { [DEFAULT_HIDDEN_VIEWS_SETTING]: [NEW_SESSION] }],
    );
    expect(readDefaultHiddenViews(service)).toEqual([NEW_SESSION]);
    service.setPolicy("product", { defaults: { [DEFAULT_HIDDEN_VIEWS_SETTING]: [USAGE] } });
    expect(readDefaultHiddenViews(service)).toEqual([USAGE]);
    // The user's settings JSON sits above the product's default.
    service.update(DEFAULT_HIDDEN_VIEWS_SETTING, [FILES_VIEW]);
    expect(readDefaultHiddenViews(service)).toEqual([FILES_VIEW]);
  });

  it("keeps the strings it lists, once each", () => {
    expect(defaultHiddenViewsOf([FILES_VIEW, FILES_VIEW, 3, "", "omnigent.*"])).toEqual([
      FILES_VIEW,
      "omnigent.*",
    ]);
    expect(defaultHiddenViewsOf("omnigent.files.view")).toBe(NO_DEFAULT_HIDDEN);
  });
});

describe("views the defaults hide", () => {
  const files = { id: FILES_VIEW };

  it("are hidden until the user shows them, and the user's show is kept across a reload", () => {
    const store = new LayoutStateStore();
    const policy = NO_PRODUCT_POLICY;
    expect(isViewHidden(files, readViewsLayout(store, policy), policy, [FILES_VIEW])).toBe(true);
    expect(isViewHidden(files, readViewsLayout(store, policy), policy)).toBe(false);

    expect(updateViewLayout(FILES_VIEW, { hidden: false }, store, policy)).toBe(true);
    expect(isViewHidden(files, readViewsLayout(reload(), policy), policy, [FILES_VIEW])).toBe(
      false,
    );
  });

  it("a product's hiddenViews still removes a view the user shows", () => {
    const policy = new ProductLayoutPolicy();
    policy.set({ hiddenViews: [FILES_VIEW] });
    const layout = { [FILES_VIEW]: { hidden: false } };
    expect(isViewHidden(files, layout, policy, [])).toBe(true);
  });

  it("a container's last shown view is not hidden by the defaults", () => {
    const registered: RailViewContribution[] = [
      {
        id: "acme.tools.a",
        extensionId: "acme.tools",
        name: "A",
        icon: undefined,
        containerId: "acme.tools",
      },
      {
        id: "acme.tools.b",
        extensionId: "acme.tools",
        name: "B",
        icon: undefined,
        containerId: "acme.tools",
      },
    ];
    const defaults = ["acme.tools.*"];
    // The defaults would hide both: they don't apply to the container, which keeps its views.
    const drawn = containerViews(
      registered,
      "acme.tools",
      "acme.tools",
      {},
      {},
      NO_PRODUCT_POLICY,
      defaults,
    );
    expect(drawn.map((view) => view.id)).toEqual(["acme.tools.a", "acme.tools.b"]);
    // One the user shows stays drawn; the other the defaults hide.
    const layout = { "acme.tools.a": { hidden: false } };
    const partly = containerViews(
      registered,
      "acme.tools",
      "acme.tools",
      layout,
      {},
      NO_PRODUCT_POLICY,
      ["acme.tools.b"],
    );
    expect(partly.map((view) => view.id)).toEqual(["acme.tools.a"]);
    // The header menu's listing names every view, default-hidden ones too, to show them again.
    const listed = containerViews(
      registered,
      "acme.tools",
      "acme.tools",
      {},
      {},
      NO_PRODUCT_POLICY,
    );
    expect(listed.map((view) => view.id)).toEqual(["acme.tools.a", "acme.tools.b"]);
  });
});

describe("the product's patterns", () => {
  it("hide a view and a navigation entry by `*` pattern, the user's show included", () => {
    const policy = new ProductLayoutPolicy();
    policy.set({ hiddenViews: ["omnigent.files.*", "omnigent.open*"] });
    const shown = { [FILES_VIEW]: { hidden: false } };
    expect(isViewHidden({ id: FILES_VIEW }, shown, policy)).toBe(true);
    expect(isViewHidden({ id: "omnigent.changes.view" }, {}, policy)).toBe(false);
    const choices = { [USAGE]: false };
    expect(isNavigationEntryHidden(USAGE, choices, [], policy)).toBe(true);
    expect(isNavigationEntryHidden(NEW_SESSION, choices, [], policy)).toBe(false);
  });

  it("a product's removal of a navigation entry beats a show, from the menu or the layout", () => {
    const policy = new ProductLayoutPolicy();
    policy.set({ hiddenViews: [NEW_SESSION] });
    const store = new LayoutStateStore();
    expect(setNavigationEntryHidden(NEW_SESSION, false, store, policy)).toBe(true);
    expect(readNavigationEntryChoices(store, policy)).toEqual({ [NEW_SESSION]: false });
    expect(isNavigationEntryHidden(NEW_SESSION, { [NEW_SESSION]: false }, [], policy)).toBe(true);
  });
});

describe("the product's lockViewLocations", () => {
  const LOCKED = new ProductLayoutPolicy();
  LOCKED.set({ lockViewLocations: true });

  it("applies the defaults to views and navigation entries alike, the stored choices unread", () => {
    const store = new LayoutStateStore();
    store.set(LAYOUT_SLOTS.views, { [FILES_VIEW]: { hidden: false } });
    store.set(LAYOUT_SLOTS.hiddenNavigationEntries, { [NEW_SESSION]: false });
    expect(
      isViewHidden({ id: FILES_VIEW }, readViewsLayout(store, LOCKED), LOCKED, [FILES_VIEW]),
    ).toBe(true);
    expect(
      isNavigationEntryHidden(
        NEW_SESSION,
        readNavigationEntryChoices(store, LOCKED),
        [NEW_SESSION],
        LOCKED,
      ),
    ).toBe(true);
    expect(readNavigationEntryChoices(store, LOCKED)).toEqual({});
  });

  it("refuses a show or a hide of either, and stores nothing", () => {
    const store = new LayoutStateStore();
    expect(updateViewLayout(FILES_VIEW, { hidden: false }, store, LOCKED)).toBe(false);
    expect(setNavigationEntryHidden(NEW_SESSION, false, store, LOCKED)).toBe(false);
    expect(setNavigationEntryHidden(USAGE, true, store, LOCKED)).toBe(false);
    expect(store.get(LAYOUT_SLOTS.views)).toBeUndefined();
    expect(store.get(LAYOUT_SLOTS.hiddenNavigationEntries)).toBeUndefined();
    // Unlocked, the same store takes the choices again.
    expect(setNavigationEntryHidden(USAGE, true, store, NO_PRODUCT_POLICY)).toBe(true);
    expect(readHiddenNavigationEntries(store, NO_PRODUCT_POLICY)).toEqual([USAGE]);
  });
});

describe("navigation entries the defaults hide", () => {
  it("are hidden until the user shows them; a show is stored and kept across a reload", () => {
    const store = new LayoutStateStore();
    const defaults = [NEW_SESSION];
    expect(isNavigationEntryHidden(NEW_SESSION, readNavigationEntryChoices(store), defaults)).toBe(
      true,
    );
    setNavigationEntryHidden(NEW_SESSION, false, store);
    expect(readNavigationEntryChoices(reload())).toEqual({ [NEW_SESSION]: false });
    expect(
      isNavigationEntryHidden(NEW_SESSION, readNavigationEntryChoices(reload()), defaults),
    ).toBe(false);
  });

  it("a user's hide is stored as a choice, and the list of hidden ids names only those", () => {
    const store = new LayoutStateStore();
    setNavigationEntryHidden(USAGE, true, store);
    setNavigationEntryHidden(NEW_SESSION, false, store);
    expect(readHiddenNavigationEntries(store)).toEqual([USAGE]);
    expect(readNavigationEntryChoices(store)).toEqual({ [USAGE]: true, [NEW_SESSION]: false });
  });

  it("migrates the old list of hidden ids to hidden choices, once written", () => {
    localStorage.setItem(
      "omnigent:layout-state",
      JSON.stringify({
        version: 1,
        state: { [LAYOUT_SLOTS.hiddenNavigationEntries]: [NEW_SESSION, NEW_SESSION, 7, USAGE] },
      }),
    );
    const store = new LayoutStateStore();
    expect(readNavigationEntryChoices(store)).toEqual({ [NEW_SESSION]: true, [USAGE]: true });
    setNavigationEntryHidden(NEW_SESSION, false, store);
    expect(store.get(LAYOUT_SLOTS.hiddenNavigationEntries)).toEqual({
      [NEW_SESSION]: false,
      [USAGE]: true,
    });
  });

  it("reads a malformed slot as no choices, and drops a prototype key", () => {
    localStorage.setItem(
      "omnigent:layout-state",
      JSON.stringify({
        version: 1,
        state: { [LAYOUT_SLOTS.hiddenNavigationEntries]: { __proto__: true, [USAGE]: "yes" } },
      }),
    );
    expect(readNavigationEntryChoices(new LayoutStateStore())).toEqual({});
  });
});

describe("Reset Layout", () => {
  it("clears the user's shows and hides, so the defaults apply again", () => {
    const store = new LayoutStateStore();
    setNavigationEntryHidden(NEW_SESSION, false, store);
    updateViewLayout(FILES_VIEW, { hidden: false }, store, NO_PRODUCT_POLICY);
    store.resetSlots(RESETTABLE_LAYOUT_SLOTS);
    const after = new LayoutStateStore();
    expect(
      isNavigationEntryHidden(NEW_SESSION, readNavigationEntryChoices(after), [NEW_SESSION]),
    ).toBe(true);
    expect(
      isViewHidden(
        { id: FILES_VIEW },
        readViewsLayout(after, NO_PRODUCT_POLICY),
        NO_PRODUCT_POLICY,
        [FILES_VIEW],
      ),
    ).toBe(true);
  });
});
