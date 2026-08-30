import { SubmitButton } from "@/components/auth/submit-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import {
  COURSE_TYPES,
  LABELS,
  TARGET_BANDS,
  type OfferedCourseType,
} from "@/lib/course-type";

/**
 * The values an existing class starts the form with.
 *
 * The course type is deliberately not here — it arrives as `defaultCourseType`,
 * which creation already supplies from the teacher's declared teaching type.
 * One prop for one control, rather than two places a selected option could come
 * from.
 */
export type ClassFormDefaults = {
  name: string;
  targetBand: number | null;
  startDate: string;
  endDate: string | null;
  scheduleNote: string | null;
};

/**
 * The fields that describe a class.
 *
 * Lifted out of the onboarding step unchanged, because a teacher creating their
 * fifth class answers exactly the same questions as one creating their first —
 * and, since editing, exactly the same questions as one correcting their
 * second. Three copies of this markup would be three places for the field names
 * to drift away from what `createClass` and `updateClass` read.
 *
 * It stays presentational: the caller supplies the action, and the action works
 * out where a teacher goes next. Nothing here decides that. Editing is not a
 * mode this component branches on — it is the same form with `defaults` filled
 * in and a different word on the button, which is why there is no `mode` prop.
 *
 * The target band field only applies to IELTS. `scoring_model = 'none'` forbids a
 * band outright (`classes_no_target_band_when_unscored`), so the field is hidden
 * for the other course types using `:has()` on the live `<select>` value — which
 * keeps the whole form working without JavaScript.
 *
 * CSS is presentation, not enforcement. In a browser without `:has()` the field
 * stays visible and can be filled in, so `targetBandFor()` on the server drops
 * the value for any non-IELTS class regardless of what was submitted. The two
 * layers agree; only one of them is trusted.
 */
export function ClassForm({
  action,
  defaultCourseType,
  defaults,
  submitLabel = "Tạo lớp học",
  pendingLabel = "Đang tạo lớp học…",
}: {
  action: (formData: FormData) => void | Promise<void>;
  /** Which option the course-type control starts on. */
  defaultCourseType: OfferedCourseType;
  /** An existing class's values. Omitted when creating one. */
  defaults?: ClassFormDefaults;
  submitLabel?: string;
  pendingLabel?: string;
}) {
  // `public.band` accepts anything on the half-point grid from 0 to 9, while
  // `TARGET_BANDS` offers only the seven the Figma draws. A class whose band was
  // set outside this form would otherwise fall back to "Chưa đặt" — an
  // untouched dropdown quietly clearing the value on save — so the stored band
  // joins the list when it is not already in it.
  const band = defaults?.targetBand?.toFixed(1) ?? "";
  const bands =
    band && !(TARGET_BANDS as readonly string[]).includes(band)
      ? [...TARGET_BANDS, band].sort()
      : TARGET_BANDS;

  return (
    <form action={action} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="name">Tên lớp học</Label>
        <Input
          id="name"
          name="name"
          type="text"
          placeholder="Lớp IELTS buổi tối"
          defaultValue={defaults?.name}
          maxLength={200}
          required
          autoFocus
        />
      </div>

      <div className="group grid grid-cols-2 gap-3">
        <div className="hidden space-y-1.5 group-has-[option[value=ielts]:checked]:block">
          <Label htmlFor="target_band">Band mục tiêu</Label>
          <Select id="target_band" name="target_band" defaultValue={band}>
            <option value="">Chưa đặt</option>
            {bands.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="course_type">Loại khóa học</Label>
          <Select
            id="course_type"
            name="course_type"
            defaultValue={defaultCourseType}
            required
          >
            {COURSE_TYPES.map((type) => (
              <option key={type} value={type}>
                {LABELS[type]}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="start_date">Ngày bắt đầu</Label>
          <Input
            id="start_date"
            name="start_date"
            type="date"
            defaultValue={defaults?.startDate}
            required
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="end_date">Ngày kết thúc</Label>
          {/* Empty is meaningful: clearing this field is how a teacher makes a
              class open-ended, so it is left blank rather than defaulted. */}
          <Input
            id="end_date"
            name="end_date"
            type="date"
            defaultValue={defaults?.endDate ?? ""}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="schedule_note">Lịch học</Label>
        <Input
          id="schedule_note"
          name="schedule_note"
          type="text"
          placeholder="Thứ Ba & Thứ Năm, 19:30"
          defaultValue={defaults?.scheduleNote ?? ""}
        />
      </div>

      <SubmitButton pendingLabel={pendingLabel} className="mt-6 w-full">
        {submitLabel}
      </SubmitButton>
    </form>
  );
}
