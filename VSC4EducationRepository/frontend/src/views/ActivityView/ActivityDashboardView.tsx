import { t } from "../../i18n";
import type { ActivityReviewDashboard } from "../../types";
import { Metric } from "../../components/Metric";
import { EmptyState } from "../../components/EmptyState";
import { StatsTable } from "../../components/StatsTable";
import { DistributionTable } from "../../components/DistributionTable";
import { CountList } from "../../components/CountList";
import { formatStat } from "../../lib/format";

export function ActivityDashboardView(props: { dashboard: ActivityReviewDashboard | null; loading: boolean; error: string }) {
  const dashboard = props.dashboard;
  if (props.loading) {
    return <EmptyState text={t("Calculating submission dashboard...")} />;
  }
  if (props.error) {
    return <section className="tablePanel warningPanel"><h2>{t("Could not load dashboard")}</h2><p>{props.error}</p></section>;
  }
  if (!dashboard) {
    return <EmptyState text={t("Open the Dashboard tab to calculate aggregate metrics.")} />;
  }

  return (
    <>
      <section className="detailPanel">
        <div className="metrics">
          <Metric label={t("Reviewed submissions")} value={`${dashboard.reviewedSubmissionCount}/${dashboard.submissionCount}`} />
          <Metric label={t("Students")} value={dashboard.studentCount} />
          <Metric label={t("Average observable agency")} value={`${formatStat(dashboard.agency.score.avg)}/100`} />
          <Metric label={t("With agents")} value={`${Math.round(dashboard.agentUse.withAgentInteractionsRatio * 100)}%`} />
        </div>
        <div className="metrics">
          <Metric label={t("Median active time")} value={`${formatStat(dashboard.summary.activeMinutes?.median)} min`} />
          <Metric label={t("Median unique lines")} value={formatStat(dashboard.summary.uniqueLinesTouched?.median)} />
          <Metric label={t("Median modified files")} value={formatStat(dashboard.summary.filesModified?.median)} />
          <Metric label={t("Valid integrity")} value={dashboard.integrity.valid ?? 0} />
        </div>
      </section>

      <div className="twoColumns">
        <section className="tablePanel">
          <h2>{t("Observable agency distribution")}</h2>
          <DistributionTable values={dashboard.agency.levels} />
        </section>
        <section className="tablePanel">
          <h2>{t("Integrity")}</h2>
          <DistributionTable values={dashboard.integrity} />
        </section>
      </div>

      {(dashboard.agency.topPositives.length > 0 || dashboard.agency.topConcerns.length > 0) && (
        <div className="twoColumns">
          <section className="tablePanel">
            <h2>{t("Frequent strengths")}</h2>
            <CountList values={dashboard.agency.topPositives} />
          </section>
          <section className="tablePanel">
            <h2>{t("Frequent indicators to review")}</h2>
            <CountList values={dashboard.agency.topConcerns} />
          </section>
        </div>
      )}

      <section className="tablePanel">
        <h2>{t("Aggregate summary")}</h2>
        <StatsTable
          rows={[
            [t("Active time"), dashboard.summary.activeMinutes, "min"],
            [t("Unique lines"), dashboard.summary.uniqueLinesTouched, ""],
            [t("Modified files"), dashboard.summary.filesModified, ""],
            [t("File changes"), dashboard.summary.fileChangeEvents, ""],
            [t("Agent interactions"), dashboard.summary.agentInteractions, ""],
            [t("Student messages"), dashboard.agentUse.studentMessages, ""],
            [t("Agent responses"), dashboard.agentUse.agentResponses, ""],
          ]}
        />
      </section>

      <section className="tablePanel">
        <h2>{t("Metrics by dimension")}</h2>
        {dashboard.metricGroups.map((group) => (
          <div className="metricGroup" key={group.dimension}>
            <h3>{t(group.dimension)}</h3>
            <StatsTable rows={group.metrics.map((metric) => [t(metric.name), metric.stats, metric.unit ?? "", metric])} />
          </div>
        ))}
      </section>

      {dashboard.warnings.length > 0 && (
        <section className="tablePanel warningPanel">
          <h2>{t("Submissions without complete dashboard")}</h2>
          {dashboard.warnings.map((warning) => (
            <div className="warningItem" key={`${warning.submissionId}-${warning.code}`}>
              <strong>{warning.studentId} - {warning.code}</strong>
              <span>{t(warning.message)}</span>
            </div>
          ))}
        </section>
      )}
    </>
  );
}
