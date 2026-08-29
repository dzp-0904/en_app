import { cn } from "@/lib/utils";

/**
 * A large selectable card backed by a real radio input.
 *
 * The Figma draws these as buttons that select on click and advance the wizard.
 * They are radios here so the choice submits with the surrounding form and needs
 * no JavaScript — the same reasoning as the rest of onboarding. That also buys
 * the correct semantics for free: arrow keys move between options, the group is
 * announced as a group, and the selected state is exposed rather than implied by
 * colour.
 *
 * The input is `sr-only` rather than `hidden` — a hidden input is not focusable,
 * which would remove the option from the keyboard order entirely. `peer-*`
 * variants project its state onto the visible box, including the focus ring,
 * since the box itself never receives focus.
 */
export function RadioCard({
  name,
  value,
  label,
  defaultChecked,
}: {
  name: string;
  value: string;
  label: string;
  defaultChecked?: boolean;
}) {
  return (
    <label className="block cursor-pointer">
      <input
        type="radio"
        name={name}
        value={value}
        defaultChecked={defaultChecked}
        required
        className="peer sr-only"
      />
      <span
        className={cn(
          "block rounded-xl border-2 border-border bg-card p-4 text-left text-sm font-medium text-muted-foreground transition-colors",
          "hover:border-primary/40",
          "peer-checked:border-primary peer-checked:bg-secondary peer-checked:text-secondary-foreground",
          "peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring",
        )}
      >
        {label}
      </span>
    </label>
  );
}
