import * as d3 from "d3";
import { t } from "../../i18n";
import { formatStat } from "../../lib/format";
import type { AnalysisMetricSeries, AnalysisPoint } from "./types";

export function AnalysisChart(props: { metric: AnalysisMetricSeries; size: "mini" | "large" }) {
  const width = props.size === "large" ? 1120 : 260;
  const height = props.size === "large" ? 520 : 132;
  if (props.metric.kind === "category") {
    return <CategoryChart metric={props.metric} width={width} height={height} detailed={props.size === "large"} />;
  }
  return <NumericChart metric={props.metric} width={width} height={height} detailed={props.size === "large"} />;
}

function NumericChart(props: { metric: AnalysisMetricSeries; width: number; height: number; detailed: boolean }) {
  const margin = props.detailed ? { top: 24, right: 26, bottom: 92, left: 62 } : { top: 12, right: 8, bottom: 12, left: 8 };
  const values = props.metric.points.filter((point): point is AnalysisPoint & { value: number } => typeof point.value === "number" && Number.isFinite(point.value));
  const domainMax = d3.max(values, (point) => point.value) ?? 1;
  const x = d3.scaleBand<string>()
    .domain(values.map((point) => String(point.id)))
    .range([margin.left, props.width - margin.right])
    .padding(values.length > 80 ? 0.05 : 0.18);
  const y = d3.scaleLinear()
    .domain([Math.min(0, d3.min(values, (point) => point.value) ?? 0), domainMax || 1])
    .nice()
    .range([props.height - margin.bottom, margin.top]);
  const ticks = y.ticks(props.detailed ? 6 : 3);

  return (
    <svg className="analysisChart" viewBox={`0 0 ${props.width} ${props.height}`} role="img" aria-label={t(props.metric.title)}>
      {props.detailed && ticks.map((tick) => (
        <g key={tick}>
          <line x1={margin.left} x2={props.width - margin.right} y1={y(tick)} y2={y(tick)} className="chartGridLine" />
          <text x={margin.left - 10} y={y(tick)} className="chartAxisText" textAnchor="end" dominantBaseline="middle">{formatStat(tick)}</text>
        </g>
      ))}
      {props.metric.kind === "dot" ? values.map((point) => (
        <circle key={point.id} cx={(x(String(point.id)) ?? 0) + x.bandwidth() / 2} cy={y(point.value)} r={props.detailed ? 5 : 2.8} className="chartDot">
          <title>{point.label}: {formatStat(point.value, props.metric.unit ?? "")}</title>
        </circle>
      )) : values.map((point) => {
        const barX = x(String(point.id)) ?? 0;
        const barY = y(Math.max(0, point.value));
        const barHeight = Math.abs(y(point.value) - y(0));
        return (
          <rect key={point.id} x={barX} y={barY} width={Math.max(1, x.bandwidth())} height={Math.max(1, barHeight)} className="chartBar">
            <title>{point.label}: {formatStat(point.value, props.metric.unit ?? "")}</title>
          </rect>
        );
      })}
      {props.detailed && values.filter((_, index) => shouldShowXAxisLabel(index, values.length)).map((point) => (
        <text key={point.id} x={(x(String(point.id)) ?? 0) + x.bandwidth() / 2} y={props.height - margin.bottom + 18} className="chartAxisText" textAnchor="end" transform={`rotate(-35 ${(x(String(point.id)) ?? 0) + x.bandwidth() / 2} ${props.height - margin.bottom + 18})`}>
          {point.label}
        </text>
      ))}
    </svg>
  );
}

function CategoryChart(props: { metric: AnalysisMetricSeries; width: number; height: number; detailed: boolean }) {
  const margin = props.detailed ? { top: 24, right: 30, bottom: 76, left: 160 } : { top: 12, right: 8, bottom: 12, left: 8 };
  const counts = Array.from(d3.rollup(props.metric.points, (items) => items.length, (point) => String(point.value)), ([label, count]) => ({ label, count }))
    .sort((left, right) => d3.descending(left.count, right.count));
  const x = d3.scaleLinear()
    .domain([0, d3.max(counts, (item) => item.count) ?? 1])
    .nice()
    .range([margin.left, props.width - margin.right]);
  const y = d3.scaleBand<string>()
    .domain(counts.map((item) => item.label))
    .range([margin.top, props.height - margin.bottom])
    .padding(0.22);

  return (
    <svg className="analysisChart" viewBox={`0 0 ${props.width} ${props.height}`} role="img" aria-label={t(props.metric.title)}>
      {counts.map((item) => (
        <g key={item.label}>
          {props.detailed && <text x={margin.left - 10} y={(y(item.label) ?? 0) + y.bandwidth() / 2} className="chartAxisText" textAnchor="end" dominantBaseline="middle">{t(item.label)}</text>}
          <rect x={margin.left} y={y(item.label)} width={Math.max(1, x(item.count) - margin.left)} height={Math.max(1, y.bandwidth())} className="chartBar alt">
            <title>{t(item.label)}: {item.count}</title>
          </rect>
          {props.detailed && <text x={x(item.count) + 8} y={(y(item.label) ?? 0) + y.bandwidth() / 2} className="chartAxisText" dominantBaseline="middle">{item.count}</text>}
        </g>
      ))}
    </svg>
  );
}

function shouldShowXAxisLabel(index: number, count: number) {
  if (count <= 24) return true;
  if (count <= 80) return index % 4 === 0;
  return index % 10 === 0;
}
