import type { ActivityEventReceipts, ActivityVersion, ActivityVersionDetail, CourseGroup } from "../../types";
import { EventServerConfigPanel } from "./EventServerConfigPanel";
import { EventSessionsPanel } from "./EventSessionsPanel";

export function ActivityEventServerView(props: {
  activity: ActivityVersion;
  activityDetail: ActivityVersionDetail | null;
  groups: CourseGroup[];
  receipts: ActivityEventReceipts | null;
  loading: boolean;
  error: string;
  onRefresh: () => Promise<void>;
}) {
  return (
    <>
      <EventServerConfigPanel activity={props.activity} activityDetail={props.activityDetail} groups={props.groups} />
      <EventSessionsPanel receipts={props.receipts} loading={props.loading} error={props.error} onRefresh={props.onRefresh} />
    </>
  );
}
