import { t } from "../i18n";

export function formatStat(value: number | undefined, unit = "") {
  if (value === undefined) {
    return "-";
  }
  const formatted = Number.isInteger(value) ? String(value) : value.toFixed(2);
  return unit ? `${formatted} ${unit}` : formatted;
}

export function formatCounts(values: Record<string, number>) {
  return Object.entries(values).map(([label, count]) => `${t(label)}: ${count}`).join(", ");
}

export function formatMetricValue(value: string | number) {
  return typeof value === "string" ? t(value) : value;
}

export function shortHash(value: string | null | undefined) {
  return value ? `${value.slice(0, 12)}...` : "-";
}

export function translateSignal(value: string) {
  const separator = value.indexOf(":");
  if (separator < 0) {
    return t(value);
  }
  return `${t(value.slice(0, separator))}${value.slice(separator)}`;
}

export function integrityLabel(status: string) {
  if (status === "valid") return t("valid");
  if (status === "invalid") return t("invalid");
  if (status === "incomplete") return t("incomplete");
  return t("not available");
}

export function distributionLabel(value: string) {
  return ["valid", "invalid", "incomplete", "not_available"].includes(value) ? integrityLabel(value) : value;
}
