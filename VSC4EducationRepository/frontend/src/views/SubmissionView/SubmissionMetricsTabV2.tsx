import { t } from "../../i18n";
import type { AgencyIndexV2, SubmissionReviewV2 } from "../../types";
import { EmptyState } from "../../components/EmptyState";
import { Metric } from "../../components/Metric";

const ATOM_GROUPS: { prefix: string; label: string }[] = [
  { prefix: "T", label: "Traceability atoms" },
  { prefix: "C", label: "Engagement atoms" },
  { prefix: "A", label: "Authorship atoms" },
  { prefix: "S", label: "Agent support atoms" },
];

function IndexCard(props: { label: string; index: AgencyIndexV2 }) {
  const index = props.index;
  return (
    <div className="tablePanel">
      <h2>{props.label}</h2>
      <div className="metrics">
        <Metric label={t("Score")} value={`${index.score}/100`} />
        <Metric label={t("Confidence")} value={t(index.confidence)} />
      </div>
      {index.note && <p className="mutedText">{t(index.note)}</p>}
      {index.flags.length > 0 ? (
        <ul className="signalList warningText">
          {index.flags.map((flag) => (
            <li key={flag}>{t(flag)}</li>
          ))}
        </ul>
      ) : (
        <p className="mutedText">{t("No flags for this index.")}</p>
      )}
    </div>
  );
}

export function SubmissionMetricsTabV2(props: { review: SubmissionReviewV2 | null }) {
  const review = props.review;
  if (!review) {
    return <EmptyState text={t("No v2 metrics available for this submission.")} />;
  }

  const groupedAtoms = ATOM_GROUPS.map((group) => ({
    ...group,
    entries: Object.entries(review.atoms ?? {}).filter(([id]) => id.startsWith(group.prefix)),
  })).filter((group) => group.entries.length > 0);

  return (
    <>
      {review.interpretationFlag && (
        <section className="tablePanel warningPanel">
          <h2>{t("Interpretation flag")}</h2>
          <p>{t(review.interpretationFlag)}</p>
        </section>
      )}

      <div className="twoColumns">
        <IndexCard label={t("Traceability")} index={review.traceability} />
        <IndexCard label={t("Engagement")} index={review.engagement} />
        <IndexCard label={t("Authorship")} index={review.authorship} />
        <IndexCard label={t("Agent support")} index={review.agentSupport} />
      </div>

      <section className="tablePanel">
        <h2>{t("Engagement subdimensions")}</h2>
        <div className="metrics">
          {Object.entries(review.engagement.subdimensions).map(([name, value]) => (
            <Metric key={name} label={t(name)} value={`${value}/100`} />
          ))}
        </div>
      </section>

      <section className="tablePanel">
        <h2>{t("Executive summary")}</h2>
        <div className="metrics">
          <Metric label={t("Summary score")} value={`${review.summary.score}/100`} />
          <Metric label={t("Summary level")} value={t(review.summary.level)} />
        </div>
        {review.summary.flags.length > 0 ? (
          <ul className="signalList warningText">
            {review.summary.flags.map((flag) => (
              <li key={flag}>{t(flag)}</li>
            ))}
          </ul>
        ) : (
          <p className="mutedText">{t("No summary flags.")}</p>
        )}
      </section>

      {groupedAtoms.map((group) => (
        <div className="metricGroup" key={group.prefix}>
          <h3>{t(group.label)}</h3>
          <table>
            <thead>
              <tr>
                <th>{t("N")}</th>
                <th>{t("Value")}</th>
              </tr>
            </thead>
            <tbody>
              {group.entries.map(([id, value]) => (
                <tr key={id}>
                  <td><code>{id}</code></td>
                  <td>{value ?? t("No data.")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </>
  );
}
