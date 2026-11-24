// A view's search input (`searchInput` in its contribution): the query box with
// a toggle for the extra fields, the submit button, the option checkboxes, the
// extension's validation message, the fields and the notes, laid out as the
// classic Content search form. The value is kept by the host per chat session.

import { FilterIcon, SearchIcon } from "lucide-react";
import { type RefObject, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { RailSearchInputValue, RailView } from "../railViews";

const MAX_INPUT_LENGTH = 4096;

export function ViewSearchForm({
  view,
  conversationId,
  inputRef,
}: {
  view: RailView;
  conversationId: string | undefined;
  inputRef?: RefObject<HTMLInputElement | null>;
}) {
  const form = view.searchInput;
  const host = view.host;
  const [value, setValue] = useState<RailSearchInputValue>(
    () => host?.getSearchInput(conversationId) ?? { query: "", options: {}, fields: {} },
  );
  const [showFields, setShowFields] = useState(false);
  const fieldsId = useId();
  if (!form) return null;
  const update = (next: RailSearchInputValue) => {
    setValue(next);
    host?.setSearchInput(conversationId, next);
  };
  const fieldsSet = form.fields.some(({ id }) => (value.fields[id] ?? "").trim() !== "");
  const canSubmit = view.searchEnabled && view.searchValidation === undefined;
  return (
    <form
      className="space-y-2 border-b border-border p-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (canSubmit) host?.acceptSearchInput(conversationId);
      }}
    >
      <div className="flex gap-2">
        <div className="flex flex-1">
          <Input
            ref={inputRef}
            aria-label={form.ariaLabel}
            placeholder={form.placeholder}
            type="search"
            maxLength={MAX_INPUT_LENGTH}
            value={value.query}
            onChange={(event) => update({ ...value, query: event.target.value })}
            className={cn(form.fieldsToggle && "rounded-r-none")}
          />
          {form.fieldsToggle && (
            <Button
              type="button"
              variant={fieldsSet ? "secondary" : "outline"}
              size="icon"
              aria-label={form.fieldsToggle.ariaLabel}
              aria-expanded={showFields}
              aria-controls={fieldsId}
              title={form.fieldsToggle.title}
              onClick={() => setShowFields((visible) => !visible)}
              className={cn("rounded-l-none border-l-0", showFields && "bg-muted!")}
            >
              <FilterIcon className="size-4" />
            </Button>
          )}
        </div>
        <Button type="submit" disabled={!canSubmit}>
          <SearchIcon className="size-4" />
          {form.submitTitle}
        </Button>
      </div>
      {form.options.length > 0 && (
        <div className="flex flex-wrap gap-3 text-xs">
          {form.options.map((option) => (
            <label key={option.id} className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={value.options[option.id] === true}
                onChange={(event) =>
                  update({
                    ...value,
                    options: { ...value.options, [option.id]: event.target.checked },
                  })
                }
              />
              {option.title}
            </label>
          ))}
        </div>
      )}
      {view.searchValidation && (
        <p role="alert" className="text-xs text-destructive">
          {view.searchValidation}
        </p>
      )}
      {form.fields.length > 0 && (
        <div id={fieldsId} hidden={!showFields} className="space-y-2 text-xs">
          {form.fields.map((field) => (
            <label key={field.id} className="block space-y-1">
              <span>{field.label}</span>
              <Input
                placeholder={field.placeholder}
                maxLength={MAX_INPUT_LENGTH}
                value={value.fields[field.id] ?? ""}
                onChange={(event) =>
                  update({ ...value, fields: { ...value.fields, [field.id]: event.target.value } })
                }
              />
            </label>
          ))}
          {form.fieldsHint && <p className="text-muted-foreground">{form.fieldsHint}</p>}
        </div>
      )}
      {form.hint && <p className="text-xs text-muted-foreground">{form.hint}</p>}
    </form>
  );
}
