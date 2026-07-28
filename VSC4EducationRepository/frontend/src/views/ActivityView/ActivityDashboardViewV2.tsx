import { t } from "../../i18n";
import type { ActivityReviewDashboardV2, AgencyIndexStatsV2 } from "../../types";
import { Metric } from "../../components/Metric";
import { EmptyState } from "../../components/EmptyState";
import { StatsTable } from "../../components/StatsTable";
import { DistributionTable } from "../../components/DistributionTable";
import { CountList } from "../../components/CountList";
import { formatStat } from "../../lib/format";

export function ActivityDashboardViewV2(props: { dashboard: ActivityReviewDashboardV2 | null; loading: boolean; error: string }) {
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

  const indices: [string, AgencyIndexStatsV2][] = [
    [t("Traceability"), dashboard.traceability],
    [t("Engagement"), dashboard.engagement],
    [t("Authorship"), dashboard.authorship],
    [t("Agent support"), dashboard.agentSupport],
  ];

  return (
    <>
      <section className="detailPanel">
        <div className="metrics">
          <Metric label={t("Reviewed submissions")} value={`${dashboard.reviewedSubmissionCount}/${dashboard.submissionCount}`} />
          <Metric label={t("Students")} value={dashboard.studentCount} />
          <Metric label={t("Average summary score")} value={`${formatStat(dashboard.summary.score.avg)}/100`} />
          <Metric label={t("Interpretation flags")} value={dashboard.interpretationFlagCount} />
        </div>
      </section>

      <div className="twoColumns">
        <section className="tablePanel">
          <h2>{t("Summary level distribution")}</h2>
          <DistributionTable values={dashboard.summary.levels} />
        </section>
        <section className="tablePanel">
          <h2>{t("Traceability confidence")}</h2>
          <DistributionTable values={dashboard.traceability.confidenceLevels} />
        </section>
      </div>

      <section className="tablePanel">
        <h2>{t("Executive indices")}</h2>
        <StatsTable
          rows={[
            [t("Traceability"), dashboard.traceability.score, ""],
            [t("Engagement"), dashboard.engagement.score, ""],
            [t("Authorship"), dashboard.authorship.score, ""],
            [t("Agent support"), dashboard.agentSupport.score, ""],
            [t("Summary"), dashboard.summary.score, ""],
          ]}
        />
      </section>

      <div className="twoColumns">
        {indices.map(([label, stats]) => (
          <section className="tablePanel" key={label}>
            <h2>{label} - {t("Frequent indicators to review")}</h2>
            <CountList values={stats.topFlags} />
          </section>
        ))}
      </div>

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
