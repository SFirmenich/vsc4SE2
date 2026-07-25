import type { ActivityVersion, CourseGroup } from "../types";

export function mergeGroups(current: CourseGroup[], incoming: CourseGroup[]) {
  const map = new Map<number, CourseGroup>();
  [...current, ...incoming].forEach((group) => map.set(group.id, group));
  return Array.from(map.values());
}

export function mergeActivities(activities: ActivityVersion[]) {
  const map = new Map<number, ActivityVersion>();
  for (const activity of activities) {
    const existing = map.get(activity.id);
    map.set(activity.id, {
      ...activity,
      courseGroups: mergeGroups(existing?.courseGroups ?? [], activity.courseGroups ?? []),
      submissionCount: Math.max(existing?.submissionCount ?? 0, activity.submissionCount ?? 0),
    });
  }
  return Array.from(map.values());
}
