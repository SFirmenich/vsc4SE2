import { RefreshCw, ShieldCheck } from "lucide-react";
import { t } from "../../i18n";
import type { ActivityEventReceipts } from "../../types";
import { Metric } from "../../components/Metric";
import { EmptyState } from "../../components/EmptyState";
import { shortHash } from "../../lib/format";

export function EventSessionsPanel(props: {
  receipts: ActivityEventReceipts | null;
  loading: boolean;
  error: string;
  onRefresh: () => Promise<void>;
}) {
  const receipts = props.receipts;
  const sessions = receipts?.sessions ?? [];

  return (
    <>
      <section className="detailPanel">
        <div>
          <span className="eyebrow">{t("Event server")}</span>
          <p>{t("Repository receipts show events received and signed by the configured Repository. This view refreshes automatically.")}</p>
        </div>
        <div className="metrics">
          <Metric label={t("Sessions")} value={receipts?.sessionCount ?? 0} />
          <Metric label={t("Receipts")} value={receipts?.receiptCount ?? 0} />
          <Metric label={t("Status")} value={props.loading ? t("Refreshing") : t("Live")} />
        </div>
        <button className="ghostButton" onClick={() => void props.onRefresh()}><RefreshCw size={17} /> {t("Refresh")}</button>
      </section>
      {props.error && <section className="tablePanel warningPanel"><strong>{t("Could not load event receipts")}</strong><span>{props.error}</span></section>}
      <section className="tablePanel">
        <h2><ShieldCheck size={18} /> {t("Event sessions")}</h2>
        <table>
          <thead>
            <tr>
              <th>{t("Student")}</th>
              <th>{t("Group")}</th>
              <th>{t("Receipts")}</th>
              <th>{t("Started")}</th>
              <th>{t("Closed")}</th>
              <th>{t("Last event hash")}</th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((session) => (
              <tr key={session.id}>
                <td><strong>{session.studentName || session.studentId}</strong><br /><small>{session.contributionId}</small></td>
                <td>{session.courseGroup ?? t("No group")}</td>
                <td>{session.receiptCount}</td>
                <td>{new Date(session.startedAt).toLocaleString()}</td>
                <td>{session.closedAt ? new Date(session.closedAt).toLocaleString() : "-"}</td>
                <td><code>{shortHash(session.lastEventHash)}</code></td>
              </tr>
            ))}
          </tbody>
        </table>
        {!sessions.length && <EmptyState text={t("No event server sessions yet.")} />}
      </section>
      {sessions.map((session) => (
        <section className="tablePanel" key={`receipts-${session.id}`}>
          <h2>{session.studentName || session.studentId} - {t("Registered events")}</h2>
          <table>
            <thead>
              <tr>
                <th>{t("Server time")}</th>
                <th>{t("Event ID")}</th>
                <th>{t("Event hash")}</th>
                <th>{t("Previous hash")}</th>
                <th>{t("Signing key")}</th>
              </tr>
            </thead>
            <tbody>
              {session.receipts.slice(-80).reverse().map((receipt) => (
                <tr key={receipt.eventId}>
                  <td>{new Date(receipt.serverReceivedAt).toLocaleString()}</td>
                  <td><code>{receipt.eventId}</code></td>
                  <td><code>{shortHash(receipt.eventHash)}</code></td>
                  <td><code>{shortHash(receipt.previousHash)}</code></td>
                  <td>{receipt.signingKeyId}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {session.receiptCount > 80 && <p>{t("Showing the latest 80 receipts for this session.")}</p>}
        </section>
      ))}
    </>
  );
}
