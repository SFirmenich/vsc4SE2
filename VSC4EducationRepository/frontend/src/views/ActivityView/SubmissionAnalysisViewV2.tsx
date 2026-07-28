import { useState } from "react";
import { X } from "lucide-react";
import { t } from "../../i18n";
import type { ActivitySubmissionAnalysisV2 } from "../../types";
import { Metric } from "../../components/Metric";
import { EmptyState } from "../../components/EmptyState";
import { buildAnalysisMetricsV2, submissionV2ChartLabel } from "../../features/analysis-v2/buildAnalysisMetricsV2";
import { AnalysisChart } from "../../features/analysis/AnalysisChart";
import type { AnalysisMetricSeries } from "../../features/analysis/types";

export function SubmissionAnalysisViewV2(props: { analysis: ActivitySubmissionAnalysisV2 | null; loading: boolean; error: string }) {
  const [selectedMetric, setSelectedMetric] = useState<AnalysisMetricSeries | null>(null);
  const metrics = buildAnalysisMetricsV2(props.analysis?.submissions ?? []);
  const flagged = (props.analysis?.submissions ?? []).filter((row) => !!row.interpretationFlag);

  if (props.loading) {
    return <EmptyState text={t("Calculating submission analysis...")} />;
  }
  if (props.error) {
    return <section className="tablePanel warningPanel"><h2>{t("Could not load analysis")}</h2><p>{props.error}</p></section>;
  }
  if (!props.analysis) {
    return <EmptyState text={t("Open the Submission analysis tab to calculate per-submission metrics.")} />;
  }
  if (!metrics.length) {
    return <EmptyState text={t("There are not enough metrics to chart.")} />;
  }

  return (
    <>
      <section className="detailPanel">
        <div className="metrics">
          <Metric label={t("Reviewed submissions")} value={`${props.analysis.reviewedSubmissionCount}/${props.analysis.submissionCount}`} />
          <Metric label={t("Charts")} value={metrics.length} />
          <Metric label={t("Interpretation flags")} value={flagged.length} />
          <Metric label={t("Warnings")} value={props.analysis.warnings.length} />
        </div>
      </section>

      <section className="analysisGrid" aria-label={t("Submission analysis")}>
        {metrics.map((metric) => (
          <button className="analysisCard" key={metric.key} onClick={() => setSelectedMetric(metric)}>
            <strong>{t(metric.title)}</strong>
            <small>{t(metric.dimension)}</small>
            <AnalysisChart metric={metric} size="mini" />
          </button>
        ))}
      </section>

      {flagged.length > 0 && (
        <section className="tablePanel warningPanel">
          <h2>{t("Interpretation flags")}</h2>
          {flagged.map((row) => (
            <div className="warningItem" key={row.submissionId}>
              <strong>{submissionV2ChartLabel(row)}</strong>
              <span>{row.interpretationFlag}</span>
            </div>
          ))}
        </section>
      )}

      {props.analysis.warnings.length > 0 && (
        <section className="tablePanel warningPanel">
          <h2>{t("Submissions without complete analysis")}</h2>
          {props.analysis.warnings.map((warning) => (
            <div className="warningItem" key={`${warning.submissionId}-${warning.code}`}>
              <strong>{warning.studentId} - {warning.code}</strong>
              <span>{t(warning.message)}</span>
            </div>
          ))}
        </section>
      )}

      {selectedMetric && (
        <div className="dialogOverlay" role="presentation" onClick={() => setSelectedMetric(null)}>
          <dialog className="chartDialog" open aria-labelledby="chartDialogTitleV2" onClick={(event) => event.stopPropagation()}>
            <div className="dialogHeader">
              <div>
                <h2 id="chartDialogTitleV2">{t(selectedMetric.title)}</h2>
                <p>{t(selectedMetric.dimension)}{selectedMetric.unit ? ` - ${t(selectedMetric.unit)}` : ""}</p>
              </div>
              <button className="iconButton" onClick={() => setSelectedMetric(null)} title={t("Close")}>
                <X size={17} />
              </button>
            </div>
            <AnalysisChart metric={selectedMetric} size="large" />
          </dialog>
        </div>
      )}
    </>
  );
}
