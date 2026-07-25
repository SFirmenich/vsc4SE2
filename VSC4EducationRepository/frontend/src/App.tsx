import { ArrowLeft, RefreshCw } from "lucide-react";
import { t } from "./i18n";
import { useRepositoryApp } from "./hooks/useRepositoryApp";
import { errorMessage } from "./lib/errors";
import { subtitle } from "./lib/subtitle";
import { LanguageSelector } from "./components/LanguageSelector";
import { CoursesView } from "./views/CoursesView";
import { CourseActivitiesView } from "./views/CourseActivitiesView";
import { ActivityView } from "./views/ActivityView";
import { SubmissionView } from "./views/SubmissionView";

export type View = "courses" | "course" | "activity" | "submission";

export function App() {
  const app = useRepositoryApp();

  return (
    <main>
      <header className="appHeader">
        <div>
          <h1>VSCode4Education Repository</h1>
          <p>{subtitle(app.view, app.selectedCourse, app.selectedActivity, app.selectedSubmission)}</p>
        </div>
        <div className="headerActions">
          <LanguageSelector locale={app.locale} onChange={app.changeLocale} />
          {app.view !== "courses" && (
            <button className="ghostButton" onClick={app.goBack}>
              <ArrowLeft size={17} /> {t("Back")}
            </button>
          )}
          <button className="iconButton" onClick={() => app.loadCourses().catch((error) => app.setMessage(errorMessage(error)))} title={t("Refresh")}>
            <RefreshCw size={17} />
          </button>
        </div>
      </header>

      {app.message && <button className="notice" onClick={() => app.setMessage("")}>{app.message}</button>}

      <section className="page">
        {app.view === "courses" && (
          <CoursesView
            courses={app.courses}
            groups={app.courseGroups}
            addPanel={app.addPanel}
            onAdd={() => app.setAddPanel(app.addPanel === "course" ? null : "course")}
            onCreate={(form) => app.createCourse(form).catch((error) => app.setMessage(errorMessage(error)))}
            onOpen={(course) => {
              void app.openCourse(course);
            }}
          />
        )}

        {app.view === "course" && app.selectedCourse && (
          <CourseActivitiesView
            course={app.selectedCourse}
            groups={app.selectedCourseGroups}
            activities={app.activities}
            addPanel={app.addPanel}
            onAdd={() => app.setAddPanel(app.addPanel === "activity" ? null : "activity")}
            onUpload={(file, groupId) => app.importActivity(file, groupId).catch((error) => app.setMessage(errorMessage(error)))}
            onRegisterDraft={(form) => app.registerActivityDraft(form).catch((error) => app.setMessage(errorMessage(error)))}
            onOpen={app.openActivity}
          />
        )}

        {app.view === "activity" && app.selectedActivity && (
          <ActivityView
            activity={app.activityDetail}
            fallbackActivity={app.selectedActivity}
            groups={app.selectedCourseGroups}
            submissions={app.submissions}
            metrics={app.metrics}
            scopeQuery={app.selectedCourse ? `?courseId=${app.selectedCourse.id}` : ""}
            addPanel={app.addPanel}
            onAdd={() => app.setAddPanel(app.addPanel === "submission" ? null : "submission")}
            onUpload={(file, groupId, submissionName) => app.importSubmission(file, groupId, submissionName).catch((error) => app.setMessage(errorMessage(error)))}
            onCompleteDraft={(file, groupId) => app.completeActivityDraft(file, groupId).catch((error) => app.setMessage(errorMessage(error)))}
            onOpen={app.openSubmission}
          />
        )}

        {app.view === "submission" && app.submissionDetail && (
          <SubmissionView submission={app.submissionDetail} review={app.submissionReview} eventSessions={app.submissionEventSessions} />
        )}
      </section>
    </main>
  );
}
