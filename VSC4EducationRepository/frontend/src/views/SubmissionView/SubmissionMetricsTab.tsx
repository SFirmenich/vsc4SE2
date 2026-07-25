import { t } from "../../i18n";
import type { SubmissionReview } from "../../types";
import { EmptyState } from "../../components/EmptyState";
import { formatMetricValue } from "../../lib/format";

export function SubmissionMetricsTab(props: { review: SubmissionReview | null }) {
  const review = props.review;
  return (
    <section className="tablePanel">
      <h2>{t("Agency metrics")}</h2>
      {review ? review.agencyMetrics.groups.map((group) => (
        <div className="metricGroup" key={group.dimension}>
          <h3>{t(group.dimension)}</h3>
          <table>
            <thead>
              <tr>
                <th>{t("N")}</th>
                <th>{t("Metric")}</th>
                <th>{t("Value")}</th>
                <th>{t("Evidence")}</th>
                <th>{t("Reading")}</th>
              </tr>
            </thead>
            <tbody>
              {group.metrics.map((metric) => (
                <tr key={metric.id}>
                  <td><code>{metric.id}</code></td>
                  <td><strong>{t(metric.name)}</strong>{metric.priority && <span className="badge">{t("Priority")}</span>}<br /><small className={`reliability ${metric.reliability}`}>{t(metric.reliability)}</small></td>
                  <td><strong>{formatMetricValue(metric.value)}{metric.unit ? ` ${t(metric.unit)}` : ""}</strong></td>
                  <td>{t(metric.detail)}<br /><small>{metric.evidenceCount} {t("events/signals")}</small></td>
                  <td>{t(metric.interpretation)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )) : <EmptyState text={t("Deep metrics could not be loaded.")} />}
    </section>
  );
}
