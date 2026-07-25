import { useEffect, useMemo, useState } from "react";
import { getJson, getListJson, postJson, uploadZip } from "../api";
import type {
  ActivityVersion,
  ActivityVersionDetail,
  Course,
  CourseGroup,
  Metrics,
  Submission,
  SubmissionDetail,
  SubmissionEventSessions,
  SubmissionReview,
} from "../types";
import { getLocale, setLocale, t, type Locale } from "../i18n";
import { errorMessage } from "../lib/errors";
import { mergeActivities, mergeGroups } from "../lib/merge";
import type { View } from "../App";

export function useRepositoryApp() {
  const [locale, setLocaleState] = useState<Locale>(() => getLocale());
  const [view, setView] = useState<View>("courses");
  const [courses, setCourses] = useState<Course[]>([]);
  const [courseGroups, setCourseGroups] = useState<CourseGroup[]>([]);
  const [activities, setActivities] = useState<ActivityVersion[]>([]);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [activityDetail, setActivityDetail] = useState<ActivityVersionDetail | null>(null);
  const [submissionDetail, setSubmissionDetail] = useState<SubmissionDetail | null>(null);
  const [submissionReview, setSubmissionReview] = useState<SubmissionReview | null>(null);
  const [submissionEventSessions, setSubmissionEventSessions] = useState<SubmissionEventSessions | null>(null);
  const [selectedCourse, setSelectedCourse] = useState<Course | null>(null);
  const [selectedActivity, setSelectedActivity] = useState<ActivityVersion | null>(null);
  const [selectedSubmission, setSelectedSubmission] = useState<Submission | null>(null);
  const [addPanel, setAddPanel] = useState<"course" | "activity" | "submission" | null>(null);
  const [message, setMessage] = useState("");

  const selectedCourseGroups = useMemo(
    () => courseGroups.filter((group) => group.course === selectedCourse?.id),
    [courseGroups, selectedCourse],
  );

  async function loadCourses() {
    const [nextCourses, nextGroups] = await Promise.all([
      getListJson<Course>("/courses/"),
      getListJson<CourseGroup>("/course-groups/"),
    ]);
    setCourses(nextCourses);
    setCourseGroups(nextGroups);
  }

  async function openCourse(course: Course) {
    setSelectedCourse(course);
    setSelectedActivity(null);
    setActivityDetail(null);
    setSelectedSubmission(null);
    setSubmissionDetail(null);
    setSubmissionReview(null);
    setSubmissionEventSessions(null);
    setActivities([]);
    setView("course");
    setAddPanel(null);
    try {
      const nextGroups = await getListJson<CourseGroup>("/course-groups/");
      const courseGroupsForCourse = nextGroups.filter((group) => group.course === course.id);
      const activityLists = await Promise.all(
        courseGroupsForCourse.map(async (group) => {
          const groupActivities = await getListJson<ActivityVersion>(`/course-groups/${group.id}/activities/`);
          return groupActivities.map((activity) => ({
            ...activity,
            courseGroups: mergeGroups(activity.courseGroups ?? [], [group]),
          }));
        }),
      );
      const nextActivities = mergeActivities(activityLists.flat());
      setCourseGroups(nextGroups);
      setActivities(nextActivities);
    } catch (error) {
      setMessage(errorMessage(error));
    }
  }

  async function openActivity(activity: ActivityVersion) {
    setSelectedActivity(activity);
    setSelectedSubmission(null);
    setSubmissionDetail(null);
    setSubmissionReview(null);
    setSubmissionEventSessions(null);
    const scopeQuery = selectedCourse ? `?courseId=${selectedCourse.id}` : "";
    const [detail, nextSubmissions, nextMetrics] = await Promise.all([
      getJson<ActivityVersionDetail>(`/activity-versions/${activity.id}/`),
      getListJson<Submission>(`/activity-versions/${activity.id}/submissions/${scopeQuery}`),
      getJson<Metrics>(`/activity-versions/${activity.id}/metrics/${scopeQuery}`),
    ]);
    setActivityDetail(detail);
    setSubmissions(nextSubmissions);
    setMetrics(nextMetrics);
    setView("activity");
    setAddPanel(null);
  }

  async function openSubmission(submission: Submission) {
    setSelectedSubmission(submission);
    const [detail, review, eventSessions] = await Promise.all([
      getJson<SubmissionDetail>(`/submissions/${submission.id}/`),
      getJson<SubmissionReview>(`/submissions/${submission.id}/review/`),
      getJson<SubmissionEventSessions>(`/submissions/${submission.id}/event-sessions/`),
    ]);
    setSubmissionDetail(detail);
    setSubmissionReview(review);
    setSubmissionEventSessions(eventSessions);
    setView("submission");
    setAddPanel(null);
  }

  async function createCourse(form: FormData) {
    const course = await postJson<Course>("/courses/", {
      name: form.get("name"),
      code: form.get("code"),
      description: form.get("description"),
    });
    await postJson<CourseGroup>("/course-groups/", {
      course: course.id,
      name: form.get("groupName"),
      term: form.get("term"),
      description: "",
    });
    setMessage(t("Course created."));
    setAddPanel(null);
    await loadCourses();
  }

  async function importActivity(file: File, courseGroupId: string) {
    if (!courseGroupId) {
      setMessage(t("Choose a group to associate the activity."));
      return;
    }
    const imported = await uploadZip<ActivityVersion>("/activities/import-zip/", file, { courseGroupId });
    setMessage(t("Activity added."));
    setAddPanel(null);
    if (selectedCourse) {
      await openCourse(selectedCourse);
      await openActivity(imported);
    }
  }

  async function registerActivityDraft(form: FormData) {
    const courseGroupId = String(form.get("courseGroupId") ?? "");
    if (!courseGroupId) {
      setMessage(t("Choose a group to associate the activity."));
      return;
    }
    const draft = await postJson<ActivityVersion>("/activities/register-draft/", {
      activityId: form.get("activityId"),
      version: form.get("version"),
      title: form.get("title"),
      description: form.get("description"),
      courseGroupId,
    });
    setMessage(t("Activity draft registered."));
    setAddPanel(null);
    if (selectedCourse) {
      await openCourse(selectedCourse);
      await openActivity(draft);
    }
  }

  async function importSubmission(file: File, courseGroupId: string, submissionName = "") {
    if (!selectedActivity) {
      return;
    }
    if (!courseGroupId) {
      setMessage(t("Choose a group to associate the submission."));
      return;
    }
    await uploadZip<Submission>(`/activity-versions/${selectedActivity.id}/submissions/import-zip/`, file, { courseGroupId, submissionName });
    setMessage(t("Submission added."));
    setAddPanel(null);
    await openActivity(selectedActivity);
  }

  async function completeActivityDraft(file: File, courseGroupId: string) {
    if (!selectedActivity) {
      return;
    }
    if (!courseGroupId) {
      setMessage(t("Choose a group to associate the activity."));
      return;
    }
    const imported = await uploadZip<ActivityVersion>("/activities/import-zip/", file, { courseGroupId });
    setMessage(t("Activity ZIP uploaded. Draft completed."));
    setAddPanel(null);
    if (selectedCourse) {
      await openCourse(selectedCourse);
    }
    await openActivity(imported);
  }

  function goBack() {
    if (view === "submission" && selectedActivity) {
      setView("activity");
      return;
    }
    if (view === "activity" && selectedCourse) {
      setView("course");
      return;
    }
    setView("courses");
  }

  function changeLocale(nextLocale: Locale) {
    setLocale(nextLocale);
    setLocaleState(nextLocale);
  }

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  useEffect(() => {
    loadCourses().catch((error) => setMessage(errorMessage(error)));
  }, []);

  return {
    locale,
    view,
    courses,
    courseGroups,
    activities,
    submissions,
    metrics,
    activityDetail,
    submissionDetail,
    submissionReview,
    submissionEventSessions,
    selectedCourse,
    selectedActivity,
    selectedSubmission,
    addPanel,
    message,
    selectedCourseGroups,
    setAddPanel,
    setMessage,
    changeLocale,
    loadCourses,
    openCourse,
    openActivity,
    openSubmission,
    createCourse,
    importActivity,
    registerActivityDraft,
    importSubmission,
    completeActivityDraft,
    goBack,
  };
}
