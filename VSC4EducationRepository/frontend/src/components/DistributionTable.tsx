import { t } from "../i18n";
import { distributionLabel } from "../lib/format";

export function DistributionTable(props: { values: Record<string, number> }) {
  const entries = Object.entries(props.values);
  if (!entries.length) {
    return <p>{t("No data.")}</p>;
  }
  return (
    <table>
      <tbody>
        {entries.map(([label, count]) => (
          <tr key={label}><td>{distributionLabel(label)}</td><td>{count}</td></tr>
        ))}
      </tbody>
    </table>
  );
}
