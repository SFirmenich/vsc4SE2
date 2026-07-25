import { t } from "../../i18n";
import type { ObservableAgencyAssessment } from "../../types";
import { EmptyState } from "../../components/EmptyState";
import { translateSignal } from "../../lib/format";

export function ObservableAgencyPanel(props: { agency: ObservableAgencyAssessment | undefined }) {
  const agency = props.agency;
  if (!agency) {
    return <EmptyState text={t("No observable agency assessment is available.")} />;
  }
  return (
    <>
      <section className="tablePanel">
        <h2>{t("Observable agency")}</h2>
        <p className="mutedText">{t("Observable agency help")}</p>
        <table>
          <thead>
            <tr>
              <th>{t("Dimension")}</th>
              <th>{t("Score")}</th>
              <th>{t("Weight")}</th>
            </tr>
          </thead>
          <tbody>
            {agency.dimensions.map((dimension) => (
              <tr key={dimension.name}>
                <td>{t(dimension.name)}</td>
                <td>{dimension.score}/100</td>
                <td>{dimension.weight}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <div className="twoColumns">
        <section className="tablePanel">
          <h2>{t("Main strengths")}</h2>
          {agency.strengths.length ? (
            <ul className="signalList">{agency.strengths.map((item) => <li key={item}>{translateSignal(item)}</li>)}</ul>
          ) : <p>{t("No dimensions are above the strength threshold.")}</p>}
        </section>
        <section className="tablePanel">
          <h2>{t("Indicators to review")}</h2>
          {agency.flags.length ? (
            <ul className="signalList warningText">{agency.flags.map((item) => <li key={item}>{t(item)}</li>)}</ul>
          ) : <p>{t("No immediate alerts.")}</p>}
        </section>
      </div>
    </>
  );
}
