import { useEffect, useState } from "react";
import { Activity, BarChart3, FileArchive, ShieldCheck, Upload } from "lucide-react";
import { getJson } from "../../api";
import type {
  ActivityEventReceipts,
  ActivityReviewDashboard,
  ActivityReviewDashboardV2,
  ActivitySubmissionAnalysis,
  ActivitySubmissionAnalysisV2,
  ActivityVersion,
  ActivityVersionDetail,
  CourseGroup,
  Metrics,
  Submission,
} from "../../types";
import { t } from "../../i18n";
import { errorMessage } from "../../lib/errors";
import { SectionHeader } from "../../components/SectionHeader";
import { Metric } from "../../components/Metric";
import { EmptyState } from "../../components/EmptyState";
import { ZipUploadPanel } from "../../components/ZipUploadPanel";
import { ActivityDashboardView } from "./ActivityDashboardView";
import { SubmissionAnalysisView } from "./SubmissionAnalysisView";
import { ActivityDashboardViewV2 } from "./ActivityDashboardViewV2";
import { SubmissionAnalysisViewV2 } from "./SubmissionAnalysisViewV2";
import { ActivityEventServerView } from "./ActivityEventServerView";

export function ActivityView(props: {
  activity: ActivityVersionDetail | null;
  fallbackActivity: ActivityVersion;
  groups: CourseGroup[];
  submissions: Submission[];
  metrics: Metrics | null;
  scopeQuery: string;
  addPanel: string | null;
  onAdd: () => void;
  onUpload: (file: File, groupId: string, submissionName?: string) => void;
  onCompleteDraft: (file: File, groupId: string) => void;
  onOpen: (submission: Submission) => void;
}) {
  const activity = props.activity;
  const isDraft = props.fallbackActivity.status === "draft" || activity?.status === "draft";
  const [tab, setTab] = useState<"submissions" | "analysis" | "dashboard" | "analysis-2" | "dashboard-2" | "event-server">("submissions");
  const [dashboard, setDashboard] = useState<ActivityReviewDashboard | null>(null);
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [dashboardError, setDashboardError] = useState("");
  const [analysis, setAnalysis] = useState<ActivitySubmissionAnalysis | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisError, setAnalysisError] = useState("");
  const [dashboardV2, setDashboardV2] = useState<ActivityReviewDashboardV2 | null>(null);
  const [dashboardV2Loading, setDashboardV2Loading] = useState(false);
  const [dashboardV2Error, setDashboardV2Error] = useState("");
  const [analysisV2, setAnalysisV2] = useState<ActivitySubmissionAnalysisV2 | null>(null);
  const [analysisV2Loading, setAnalysisV2Loading] = useState(false);
  const [analysisV2Error, setAnalysisV2Error] = useState("");
  const [eventReceipts, setEventReceipts] = useState<ActivityEventReceipts | null>(null);
  const [eventReceiptsLoading, setEventReceiptsLoading] = useState(false);
  const [eventReceiptsError, setEventReceiptsError] = useState("");

  async function loadEventReceipts() {
    setEventReceiptsLoading(true);
    setEventReceiptsError("");
    try {
      setEventReceipts(await getJson<ActivityEventReceipts>(`/activity-versions/${props.fallbackActivity.id}/event-receipts/`));
    } catch (error) {
      setEventReceiptsError(errorMessage(error));
    } finally {
      setEventReceiptsLoading(false);
    }
  }

  useEffect(() => {
    if (tab !== "event-server") {
      return;
    }
    void loadEventReceipts();
    const timer = window.setInterval(() => {
      void loadEventReceipts();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [tab, props.fallbackActivity.id]);

  async function openDashboard() {
    setTab("dashboard");
    if (dashboard || dashboardLoading) {
      return;
    }
    setDashboardLoading(true);
    setDashboardError("");
    try {
      setDashboard(await getJson<ActivityReviewDashboard>(`/activity-versions/${props.fallbackActivity.id}/review-dashboard/`));
    } catch (error) {
      setDashboardError(errorMessage(error));
    } finally {
      setDashboardLoading(false);
    }
  }

  async function openAnalysis() {
    setTab("analysis");
    if (analysis || analysisLoading) {
      return;
    }
    setAnalysisLoading(true);
    setAnalysisError("");
    try {
      setAnalysis(await getJson<ActivitySubmissionAnalysis>(`/activity-versions/${props.fallbackActivity.id}/submission-analysis/${props.scopeQuery}`));
    } catch (error) {
      setAnalysisError(errorMessage(error));
    } finally {
      setAnalysisLoading(false);
    }
  }

  async function openDashboardV2() {
    setTab("dashboard-2");
    if (dashboardV2 || dashboardV2Loading) {
      return;
    }
    setDashboardV2Loading(true);
    setDashboardV2Error("");
    try {
      setDashboardV2(await getJson<ActivityReviewDashboardV2>(`/activity-versions/${props.fallbackActivity.id}/review-dashboard-v2/`));
    } catch (error) {
      setDashboardV2Error(errorMessage(error));
    } finally {
      setDashboardV2Loading(false);
    }
  }

  async function openAnalysisV2() {
    setTab("analysis-2");
    if (analysisV2 || analysisV2Loading) {
      return;
    }
    setAnalysisV2Loading(true);
    setAnalysisV2Error("");
    try {
      setAnalysisV2(await getJson<ActivitySubmissionAnalysisV2>(`/activity-versions/${props.fallbackActivity.id}/submission-analysis-v2/${props.scopeQuery}`));
    } catch (error) {
      setAnalysisV2Error(errorMessage(error));
    } finally {
      setAnalysisV2Loading(false);
    }
  }

  return (
    <>
      <SectionHeader icon={<FileArchive size={20} />} title={activity?.title ?? props.fallbackActivity.title} actionLabel={isDraft ? t("Upload activity ZIP") : t("Add submission")} onAction={props.onAdd} />
      <section className="detailPanel">
        <div>
          <span className="eyebrow">{props.fallbackActivity.activityId}@{props.fallbackActivity.version}{isDraft ? ` - ${t("Draft")}` : ""}</span>
          <p>{activity?.description || props.fallbackActivity.description || t("No description.")}</p>
          {isDraft && <p>{t("This activity is registered for Event Server configuration, but the Teacher ZIP has not been uploaded yet.")}</p>}
        </div>
        <div className="metrics">
          <Metric label={t("Submissions")} value={props.metrics?.submissions ?? props.submissions.length} />
          <Metric label={t("Students")} value={props.metrics?.uniqueStudents ?? 0} />
          <Metric label={t("Average events")} value={(props.metrics?.averageEvents ?? 0).toFixed(1)} />
          <Metric label={t("With Git")} value={`${Math.round((props.metrics?.withGitRatio ?? 0) * 100)}%`} />
        </div>
        {activity?.tasks.length ? (
          <div className="taskStrip">
            {activity.tasks.map((task) => (
              <span key={task.id}>{task.task_id}: {task.title}</span>
            ))}
          </div>
        ) : null}
      </section>

      <nav className="tabs" aria-label={t("Activity")}>
        <button className={tab === "submissions" ? "active" : ""} onClick={() => setTab("submissions")}><Upload size={16} /> {t("Submissions")}</button>
        <button className={tab === "analysis" ? "active" : ""} onClick={openAnalysis}><BarChart3 size={16} /> {t("Submission analysis")}</button>
        <button className={tab === "dashboard" ? "active" : ""} onClick={openDashboard}><Activity size={16} /> {t("Dashboard")}</button>
        <button className={tab === "analysis-2" ? "active" : ""} onClick={openAnalysisV2}><BarChart3 size={16} /> {t("Submission analysis 2")}</button>
        <button className={tab === "dashboard-2" ? "active" : ""} onClick={openDashboardV2}><Activity size={16} /> {t("Dashboard 2")}</button>
        <button className={tab === "event-server" ? "active" : ""} onClick={() => setTab("event-server")}><ShieldCheck size={16} /> {t("Event server")}</button>
      </nav>

      {tab === "submissions" && (
        <>
          {props.addPanel === "submission" && (
            isDraft
              ? <ZipUploadPanel label={t("Teacher activity ZIP")} groups={props.groups} onUpload={props.onCompleteDraft} />
              : <ZipUploadPanel label={t("Submission ZIP")} groups={props.groups} includeName onUpload={props.onUpload} />
          )}
          {isDraft && (
            <section className="tablePanel warningPanel">
              <strong>{t("Draft activity")}</strong>
              <span>{t("Upload the Teacher activity ZIP to complete this draft before adding student submissions.")}</span>
            </section>
          )}
          <section className="tablePanel">
            <h2><Upload size={18} /> {t("Submissions")}</h2>
            <table>
              <thead>
                <tr>
                  <th>{t("Name")}</th>
                  <th>{t("Student")}</th>
                  <th>{t("File")}</th>
                  <th>{t("Group")}</th>
                  <th>{t("Events")}</th>
                  <th>{t("Agent")}</th>
                  <th>Git</th>
                  <th>{t("Warnings")}</th>
                  <th>{t("Imported")}</th>
                </tr>
              </thead>
              <tbody>
                {props.submissions.map((submission) => (
                  <tr key={submission.id} onClick={() => props.onOpen(submission)}>
                    <td>{submission.name || "-"}</td>
                    <td>{submission.student.display_name || submission.student.institutional_id}</td>
                    <td>
                      {submission.originalZipUrl ? (
                        <a
                          className="fileLink"
                          href={submission.originalZipUrl}
                          download={submission.originalZipName || undefined}
                          onClick={(event) => event.stopPropagation()}
                        >
                          {submission.originalZipName || t("Download ZIP")}
                        </a>
                      ) : "-"}
                    </td>
                    <td>{submission.courseGroup?.name ?? t("No group")}</td>
                    <td>{submission.event_count}</td>
                    <td>{submission.agent_interaction_count}</td>
                    <td>{submission.has_git ? t("Yes") : t("No")}</td>
                    <td>{submission.warning_count}</td>
                    <td>{new Date(submission.imported_at).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {props.submissions.length === 0 && <EmptyState text={t("No submissions for this activity yet.")} />}
          </section>
        </>
      )}

      {tab === "dashboard" && (
        <ActivityDashboardView dashboard={dashboard} loading={dashboardLoading} error={dashboardError} />
      )}

      {tab === "analysis" && (
        <SubmissionAnalysisView analysis={analysis} loading={analysisLoading} error={analysisError} />
      )}

      {tab === "dashboard-2" && (
        <ActivityDashboardViewV2 dashboard={dashboardV2} loading={dashboardV2Loading} error={dashboardV2Error} />
      )}

      {tab === "analysis-2" && (
        <SubmissionAnalysisViewV2 analysis={analysisV2} loading={analysisV2Loading} error={analysisV2Error} />
      )}

      {tab === "event-server" && (
        <ActivityEventServerView
          activity={props.fallbackActivity}
          activityDetail={activity}
          groups={props.groups}
          receipts={eventReceipts}
          loading={eventReceiptsLoading}
          error={eventReceiptsError}
          onRefresh={loadEventReceipts}
        />
      )}
    </>
  );
}
