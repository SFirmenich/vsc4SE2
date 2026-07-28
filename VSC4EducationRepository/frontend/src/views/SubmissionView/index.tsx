import { useState } from "react";
import { Activity, BarChart3, Bot, ShieldCheck, Upload, UserRound } from "lucide-react";
import { t } from "../../i18n";
import type { SubmissionDetail, SubmissionEventSessions, SubmissionReview, SubmissionReviewV2 } from "../../types";
import { SectionHeader } from "../../components/SectionHeader";
import { Metric } from "../../components/Metric";
import { integrityLabel } from "../../lib/format";
import { SubmissionMainTab } from "./SubmissionMainTab";
import { SubmissionAgentsTab } from "./SubmissionAgentsTab";
import { SubmissionMetricsTab } from "./SubmissionMetricsTab";
import { SubmissionMetricsTabV2 } from "./SubmissionMetricsTabV2";
import { SubmissionIntegrityTab } from "./SubmissionIntegrityTab";

export function SubmissionView(props: {
  submission: SubmissionDetail;
  review: SubmissionReview | null;
  reviewV2: SubmissionReviewV2 | null;
  eventSessions: SubmissionEventSessions | null;
}) {
  const submission = props.submission;
  const review = props.review;
  const observableAgency = review?.agencyMetrics.observableAgency;
  const [tab, setTab] = useState<"main" | "agents" | "metrics" | "metrics-2" | "integrity">("main");

  return (
    <>
      <SectionHeader icon={<UserRound size={20} />} title={submission.name || submission.student.display_name || submission.student.institutional_id} />
      <section className="detailPanel">
        <div className="metrics">
          {submission.name && <Metric label={t("Name")} value={submission.name} />}
          <Metric label={t("Events")} value={submission.event_count} />
          <Metric label={t("Agent interactions")} value={submission.agent_interaction_count} />
          <Metric label="Git" value={submission.has_git ? t("Yes") : t("No")} />
          <Metric label={t("Warnings")} value={submission.warning_count} />
        </div>
        {review && (
          <div className="metrics">
            <Metric label={t("Observable agency")} value={observableAgency ? `${t(observableAgency.level)} (${observableAgency.score}/100)` : t("No data.")} />
            <Metric label={t("Confidence")} value={observableAgency?.confidence ? t(observableAgency.confidence) : t("No data.")} />
            <Metric label={t("Unique lines")} value={review.summary.uniqueLinesTouched} />
            <Metric label={t("Active time")} value={`${review.summary.activeMinutes} min`} />
            <Metric label={t("Integrity")} value={integrityLabel(review.integrity.status)} />
          </div>
        )}
      </section>

      <nav className="tabs" aria-label={t("Submission")}>
        <button className={tab === "main" ? "active" : ""} onClick={() => setTab("main")}><Activity size={16} /> {t("Main")}</button>
        <button className={tab === "agents" ? "active" : ""} onClick={() => setTab("agents")}><Bot size={16} /> {t("Agent use")}</button>
        <button className={tab === "metrics" ? "active" : ""} onClick={() => setTab("metrics")}><Upload size={16} /> {t("Metrics")}</button>
        <button className={tab === "metrics-2" ? "active" : ""} onClick={() => setTab("metrics-2")}><BarChart3 size={16} /> {t("Metrics 2")}</button>
        <button className={tab === "integrity" ? "active" : ""} onClick={() => setTab("integrity")}><ShieldCheck size={16} /> {t("Integrity")}</button>
      </nav>

      {tab === "main" && <SubmissionMainTab submission={submission} review={review} />}
      {tab === "agents" && <SubmissionAgentsTab review={review} />}
      {tab === "metrics" && <SubmissionMetricsTab review={review} />}
      {tab === "metrics-2" && <SubmissionMetricsTabV2 review={props.reviewV2} />}
      {tab === "integrity" && <SubmissionIntegrityTab submission={submission} review={review} eventSessions={props.eventSessions} />}

      {submission.warnings.length > 0 && (
        <section className="tablePanel warningPanel">
          <h2>{t("Alerts")}</h2>
          {submission.warnings.map((warning) => (
            <div className="warningItem" key={warning.id}>
              <strong>{warning.code}</strong>
              <span>{warning.message}</span>
            </div>
          ))}
        </section>
      )}
    </>
  );
}
