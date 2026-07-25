import type { ActivityVersion, Course, Submission } from "../types";
import { t } from "../i18n";
import type { View } from "../App";

export function subtitle(view: View, course: Course | null, activity: ActivityVersion | null, submission: Submission | null) {
  if (view === "submission" && submission) {
    return submission.name ? t("Submission detail - {0}", submission.name) : t("Submission detail");
  }
  if (view === "activity" && activity) {
    return `${activity.activityId}@${activity.version}`;
  }
  if (view === "course" && course) {
    return course.code ? `${course.name} · ${course.code}` : course.name;
  }
  return t("Courses, activities, and submissions");
}
