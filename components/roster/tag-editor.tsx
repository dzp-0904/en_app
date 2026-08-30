"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MAX_TAG_LENGTH, MAX_TAGS } from "@/lib/standing";

/**
 * One list of tags — strengths or focus areas — for one student.
 *
 * The pending list lives here, in state, and reaches the server as one hidden
 * input per tag. Adding and removing are therefore instant and local: nothing
 * is written until the teacher presses Save, which is the whole point of a card
 * where two lists are edited together and saved once. `FormData.getAll` reads
 * the repeated inputs straight back as an array, in the order they appear, so
 * the order shown is the order stored.
 *
 * A `key` derived from the saved tags is set by the caller, which is what makes
 * the state fall back in step with the server after every save: when the stored
 * list changes the component remounts and re-seeds from it. Without that, a
 * successful save would leave this holding its own idea of the list forever.
 *
 * The "add" box is a real named field, not a scratch input. With JavaScript it
 * is usually empty by the time Save is pressed, because Add and Enter both move
 * its contents into a chip. Without JavaScript nothing moves — but the box still
 * posts, and the action appends it, so a teacher with scripting off can still
 * add a tag and can still save. Removing is the part that genuinely needs
 * JavaScript, and it degrades to "unavailable" rather than to "silently broken".
 *
 * The checks below are the editor's, and they are duplicated on the server on
 * purpose. These two columns carry no database constraint at all — no length,
 * no count, no vocabulary — so `readTags` is the only real enforcement and this
 * is only the courtesy of not letting a teacher type something that will bounce.
 *
 * `tone` is presentation and nothing else. The Figma's student profile writes
 * strengths as green chips and areas to improve as orange ones — the same two
 * tinted pairs `Badge` carries — so that the two lists can be told apart at a
 * glance rather than only by the heading above them. The tints are the
 * accessible `--green-dark` / `--orange-dark` foregrounds, not the Figma's own
 * #3BA876 and #E8834A, for the reason `badge.tsx` sets out at length. `neutral`
 * keeps the hairline chip the editor shipped with, so no existing caller
 * changes appearance by upgrading.
 *
 * The colour is never the only signal: each list has a visible legend, and the
 * remove button carries the tag's own name.
 */
const CHIP = {
  neutral: "border border-input bg-background text-foreground",
  green: "bg-green-light text-green-dark",
  orange: "bg-orange-light text-orange-dark",
} as const;

export function TagEditor({
  label,
  hint,
  name,
  addName,
  saved,
  empty,
  listId,
  tone = "neutral",
}: {
  label: string;
  hint: string;
  /** Repeated on every hidden input — the array the action reads. */
  name: string;
  /** The single "still in the box" field the action appends. */
  addName: string;
  saved: readonly string[];
  empty: string;
  listId: string;
  /** Chip tint. Presentation only — see the note above. */
  tone?: keyof typeof CHIP;
}) {
  const [tags, setTags] = useState<string[]>([...saved]);
  const [draft, setDraft] = useState("");
  const { pending } = useFormStatus();

  const trimmed = draft.trim();
  const duplicate = tags.some(
    (tag) => tag.toLocaleLowerCase() === trimmed.toLocaleLowerCase(),
  );
  const full = tags.length >= MAX_TAGS;
  const canAdd =
    trimmed !== "" && !duplicate && !full && trimmed.length <= MAX_TAG_LENGTH;

  function add() {
    if (!canAdd) return;
    setTags([...tags, trimmed]);
    setDraft("");
  }

  return (
    <fieldset className="mt-3 min-w-0" disabled={pending}>
      <legend className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </legend>
      <p className="mt-1 text-xs text-muted-foreground">{hint}</p>

      {tags.map((tag) => (
        <input key={tag} type="hidden" name={name} value={tag} />
      ))}

      {tags.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">{empty}</p>
      ) : (
        // `flex-wrap` and `break-words` together are what keep a long custom
        // tag inside a 390px card: the row wraps between chips, and a chip too
        // wide to fit wraps within itself rather than widening the card.
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {tags.map((tag) => (
            <li
              key={tag}
              className={`flex min-w-0 items-center gap-1 rounded-full py-1 pr-1 pl-2.5 ${CHIP[tone]}`}
            >
              {/* `min-w-0` on the span as well as the row: a flex item defaults to
                  `min-width: auto`, which refuses to shrink below its content's
                  longest unbreakable run, and `break-words` only breaks a box
                  that is already constrained. Without it a single long token
                  widens the card past the viewport at 390px. */}
              <span className="min-w-0 text-xs font-medium break-words">
                {tag}
              </span>
              <button
                type="button"
                onClick={() => setTags(tags.filter((held) => held !== tag))}
                aria-label={`Xóa ${tag}`}
                className="rounded-full px-1 text-xs leading-none opacity-70 hover:opacity-100"
              >
                &times;
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Input
          name={addName}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          // Enter inside a form submits it. Here it should add a tag instead —
          // saving the moment a teacher finishes typing one of several is not
          // what they meant, and the tag would be appended by the action anyway.
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            add();
          }}
          list={listId}
          maxLength={MAX_TAG_LENGTH}
          placeholder={full ? `Tối đa ${MAX_TAGS} mục` : "Thêm…"}
          disabled={full}
          aria-label={`Thêm vào ${label.toLowerCase()}`}
          className="h-9 w-32 min-w-0 flex-1 py-0"
        />
        <Button
          type="button"
          onClick={add}
          disabled={!canAdd}
          variant="outline"
          size="sm"
        >
          Thêm
        </Button>
      </div>

      {duplicate && trimmed !== "" ? (
        <p className="mt-1 text-xs break-words text-muted-foreground">
          Mục này đã có trong danh sách.
        </p>
      ) : null}
    </fieldset>
  );
}
