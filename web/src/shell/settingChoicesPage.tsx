// A setting's ⌘K page: its values, the current one marked. It goes back without choosing if
// the setting, its owner or the command target changes; after a choice, the row shows the
// value the owner reports.

import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "zustand";

import type { QuickPickAcceptResult, QuickPickItem } from "@/components/ui/quick-pick";
import { isCommandAvailable, type PaletteCommand } from "@/store/paletteCommands";
import { listedChoices, matchedChoice, type PaletteSetting } from "@/store/paletteSettings";

import {
  type PaletteChildPage,
  leavePaletteChildPage,
  openPaletteChildPage,
  paletteChildPageStore,
  paletteIntents,
  rememberPaletteParent,
  type PaletteParentPlace,
} from "./commandPaletteChildPage";
import type { PaletteTarget } from "./paletteTarget";
import { applySettingChoice } from "./settingChoiceFlow";
import { SETTING_GONE_NOTICE, settingWaitingStatus } from "./settingChoiceStatus";

export {
  CHOICE_UNCONFIRMED_STATUS,
  SETTING_GONE_NOTICE,
  settingFailedStatus,
  settingWaitingStatus,
} from "./settingChoiceStatus";

/** A value's row id on its setting's page. */
export function choiceItemId(itemId: string, value: string): string {
  return `${itemId}=${value}`;
}

/** The rows for `setting`'s values: the current one says so, an unavailable one says why. */
export function settingChoiceItems(
  itemId: string,
  setting: PaletteSetting,
): QuickPickItem<PaletteTarget>[] {
  const Icon = setting.icon;
  return listedChoices(setting).map((choice) => ({
    id: choiceItemId(itemId, choice.value),
    label: choice.label,
    description: choice.description,
    detail: choice.value === setting.current ? "Current" : undefined,
    keywords: choice.keywords,
    icon: <Icon aria-hidden className="size-4 text-muted-foreground" />,
    disabledReason:
      choice.availability?.available === false ? choice.availability.reason : undefined,
    // The value list changes with the setting; history keeps the setting's row instead.
    rememberInHistory: false,
    value: { kind: "setting-choice", itemId, value: choice.value },
  }));
}

/** A setting page's own fields. */
type SettingChoicesChildPage = Extract<PaletteChildPage, { kind: "setting-choices" }>;

/**
 * The setting a page opened from a command's option stands for now: `optionSetting` reads
 * that option from the command the options page is bound to.
 */
export type OptionSettingReader = (page: SettingChoicesChildPage) => PaletteSetting | null;

/** The setting `itemId` offers now, if it's still the one the page was opened for. */
function boundSetting(
  items: readonly QuickPickItem<PaletteTarget>[],
  page: SettingChoicesChildPage,
  targetKey: string,
  optionSetting?: OptionSettingReader,
): PaletteSetting | null {
  if (targetKey !== page.targetKey) return null;
  let setting: PaletteSetting | undefined;
  if (page.via) {
    setting = optionSetting?.(page) ?? undefined;
  } else {
    const value = items.find((item) => item.id === page.itemId)?.value;
    if (value?.kind !== "command") return null;
    if (!isCommandAvailable(value.command.availability)) return null;
    setting = value.command.setting;
  }
  if (!setting || setting.id !== page.settingId || setting.owner !== page.owner) return null;
  return isCommandAvailable(setting.availability) ? setting : null;
}

export interface SettingChoicesPage {
  open: boolean;
  /** The setting's name, with its note when it has one. */
  heading: string | null;
  items: QuickPickItem<PaletteTarget>[];
  /** What the page is waiting on, or why a choice didn't apply. */
  status: string | null;
  /** Said on the parent after the page left because its setting went away. */
  notice: string | null;
  clearNotice: () => void;
  /**
   * Open `command`'s values from the row `itemId`, with the value `query` names active.
   * Returns that value's row id.
   */
  openChoices: (
    command: PaletteCommand,
    itemId: string,
    targetKey: string,
    parent: PaletteParentPlace,
  ) => string;
  /**
   * Open the values of the setting a command's option stands for, from that option's row
   * `itemId` on the options page `optionsPage`. Returns the current value's row id.
   */
  openOptionChoices: (
    setting: PaletteSetting,
    itemId: string,
    optionId: string,
    optionsPage: Extract<PaletteChildPage, { kind: "command-options" }>,
  ) => string;
  acceptChoice: (value: string) => QuickPickAcceptResult;
  /** Back to the parent page, returning where it was. */
  back: () => PaletteParentPlace | null;
}

/**
 * The page for the current palette rows `items`, built for `targetKey`. `onLeft` restores
 * the parent when the page leaves by itself, after a choice or once its setting is gone.
 */
export function useSettingChoicesPage(
  items: readonly QuickPickItem<PaletteTarget>[],
  targetKey: string,
  onLeft: (parent: PaletteParentPlace | null) => void,
  optionSetting?: OptionSettingReader,
): SettingChoicesPage {
  const storePage = useStore(paletteChildPageStore, (state) => state.page);
  const page = storePage?.kind === "setting-choices" ? storePage : null;
  const setting = page ? boundSetting(items, page, targetKey, optionSetting) : null;
  const [status, setStatus] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // The choice waiting on its owner; repeat accepts wait with it.
  const [waiting, setWaiting] = useState<number | null>(null);

  // Read at accept and after an awaited choice, so they act on the current rows.
  const latest = useRef({ items, targetKey, onLeft, optionSetting });
  latest.current = { items, targetKey, onLeft, optionSetting };

  // A new page, or none, starts without the last one's status or wait.
  useEffect(() => {
    setStatus(null);
    setWaiting(null);
  }, [storePage]);

  // The setting went away, moved to another owner, or the target changed: leave.
  const bound = setting !== null;
  useEffect(() => {
    if (!page || bound) return;
    setNotice(SETTING_GONE_NOTICE);
    latest.current.onLeft(leavePaletteChildPage());
  }, [page, bound]);

  const itemId = page?.itemId;
  const choiceItems = useMemo(
    () => (setting && itemId ? settingChoiceItems(itemId, setting) : []),
    [setting, itemId],
  );

  const readBound = (): PaletteSetting | null => {
    const current = paletteChildPageStore.getState().page;
    if (current?.kind !== "setting-choices") return null;
    return boundSetting(
      latest.current.items,
      current,
      latest.current.targetKey,
      latest.current.optionSetting,
    );
  };

  const leaveToParent = () => latest.current.onLeft(leavePaletteChildPage());

  return {
    open: page !== null,
    heading: setting ? (setting.note ? `${setting.label} · ${setting.note}` : setting.label) : null,
    items: choiceItems,
    status: waiting !== null && setting ? settingWaitingStatus(setting) : status,
    notice,
    clearNotice: () => setNotice(null),
    openChoices: (command, rowId, rowTargetKey, parent) => {
      const opened = command.setting!;
      // An owner that can change unseen is read again as its page opens.
      void opened.refresh?.().catch(() => undefined);
      const named = matchedChoice(opened, parent.query);
      const initialValue = named ?? opened.current;
      setNotice(null);
      rememberPaletteParent(parent);
      openPaletteChildPage({
        kind: "setting-choices",
        itemId: rowId,
        settingId: opened.id,
        owner: opened.owner,
        targetKey: rowTargetKey,
        initialValue,
      });
      return choiceItemId(rowId, initialValue);
    },
    openOptionChoices: (opened, rowId, optionId, optionsPage) => {
      void opened.refresh?.().catch(() => undefined);
      setNotice(null);
      const { parent } = paletteChildPageStore.getState();
      // Back from the options page still returns to the root, as it would have.
      rememberPaletteParent({ query: parent?.query ?? "", activeId: rowId });
      openPaletteChildPage({
        kind: "setting-choices",
        itemId: rowId,
        settingId: opened.id,
        owner: opened.owner,
        targetKey: optionsPage.targetKey,
        initialValue: opened.current,
        via: { optionsPage, optionId, optionsParent: parent },
      });
      return choiceItemId(rowId, opened.current);
    },
    acceptChoice: (value) => {
      if (waiting !== null) return "keepOpen";
      const current = readBound();
      // Gone or rebound: the live check leaves; a greyed value stays, showing why.
      if (!current) return "keepOpen";
      setStatus(null);
      const generation = paletteIntents.begin();
      applySettingChoice(generation, current, value, {
        isCurrent: paletteIntents.isCurrent,
        isBound: (fresh) => {
          const openPage = paletteChildPageStore.getState().page;
          return (
            openPage?.kind === "setting-choices" &&
            fresh.id === openPage.settingId &&
            fresh.owner === openPage.owner
          );
        },
        setWaiting,
        setStatus,
        // Back on the parent only while the page is still bound to the same setting.
        leave: () => {
          if (readBound()) leaveToParent();
        },
        gone: () => {
          setNotice(SETTING_GONE_NOTICE);
          latest.current.onLeft(leavePaletteChildPage());
        },
      });
      return "keepOpen";
    },
    back: () => {
      setStatus(null);
      setWaiting(null);
      return leavePaletteChildPage();
    },
  };
}
