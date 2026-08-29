import { GoogleMark } from "@/components/icons/google-mark";
import { Button } from "@/components/ui/button";

/**
 * The OAuth button. Presentation only — the caller wraps it in the `<form>` that
 * posts to `signInWithGoogle`, which keeps the server action out of the
 * component tree and lets both auth screens label the button differently
 * ("Continue with Google" / "Sign up with Google"), as the Figma does.
 */
export function GoogleButton({ label }: { label: string }) {
  return (
    <Button type="submit" variant="outline" className="w-full gap-2.5">
      <GoogleMark />
      {label}
    </Button>
  );
}
