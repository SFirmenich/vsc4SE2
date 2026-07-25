import { t } from "../i18n";
import { formatCounts, formatStat } from "../lib/format";
import type { ActivityReviewDashboard } from "../types";

export function StatsTable(props: { rows: [string, ActivityReviewDashboard["summary"][string] | undefined, string, { valueCounts?: Record<string, number>; nonNumericCount?: number }?][] }) {
  return (
    <table>
      <thead>
        <tr>
          <th>{t("Metric")}</th>
          <th>{t("Avg.")}</th>
          <th>{t("Min")}</th>
          <th>P25</th>
          <th>{t("Median")}</th>
          <th>P75</th>
          <th>P90</th>
          <th>{t("Max")}</th>
          <th>{t("N")}</th>
        </tr>
      </thead>
      <tbody>
        {props.rows.map(([label, stats, unit, extra]) => (
          <tr key={label}>
            <td>
              <strong>{label}</strong>
              {extra?.nonNumericCount ? <small className="mutedInline"> {formatCounts(extra.valueCounts ?? {})}</small> : null}
            </td>
            <td>{formatStat(stats?.avg, unit)}</td>
            <td>{formatStat(stats?.min, unit)}</td>
            <td>{formatStat(stats?.p25, unit)}</td>
            <td>{formatStat(stats?.median, unit)}</td>
            <td>{formatStat(stats?.p75, unit)}</td>
            <td>{formatStat(stats?.p90, unit)}</td>
            <td>{formatStat(stats?.max, unit)}</td>
            <td>{stats?.count ?? 0}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
