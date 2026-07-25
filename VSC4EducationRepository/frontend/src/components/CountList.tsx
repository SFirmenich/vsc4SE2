import { t } from "../i18n";

export function CountList(props: { values: { label: string; count: number }[] }) {
  if (!props.values.length) {
    return <p>{t("No data.")}</p>;
  }
  return <ul className="signalList">{props.values.map((item) => <li key={item.label}>{t(item.label)}: {item.count}</li>)}</ul>;
}
