import * as vscode from "vscode";
import { StudentAgencyMetrics } from "../types/AgencyMetrics";
import { ImportedSubmission } from "../types/Submission";
import { Rubric } from "../types/Rubric";
import { escapeHtml, webviewDocument } from "./webviewUtils";

export interface SubmissionReviewModel {
  submission: ImportedSubmission;
  rubric?: Rubric;
  summaries: Record<string, unknown>[];
  agencyMetrics: StudentAgencyMetrics[];
  integrity: Record<string, unknown>;
  commits: unknown[];
}

const tabs = [
  ["activity", "Activity"],
  ["students", "Report"],
  ["agency-metrics", "Agency metrics"],
  ["timeline", "Evidence"],
  ["git", "Git"],
  ["agents", "Agent"],
  ["integrity", "Integrity"],
  ["rubric", "Rubric"],
  ["feedback", "Feedback"]
];

export function submissionReviewHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  model: SubmissionReviewModel
): string {
  const encoded = JSON.stringify(model).replace(/</g, "\\u003c");
  const d3Uri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "node_modules", "d3", "dist", "d3.min.js")
  );
  const body = `<header>
  <strong>Submission Review</strong>
  <div class="muted">${escapeHtml(model.submission.manifest.title)} - Imported ${escapeHtml(model.submission.importedAt)}</div>
  <nav>${tabs
    .map(
      ([id, label]) =>
        `<button class="secondary tab" data-tab="${id}">${label}</button>`
    )
    .join("")}</nav>
</header>
<main>
  <div class="grid">
    <div><label for="student">Student</label><select id="student"></select></div>
    <div><label for="task-filter">Task</label><select id="task-filter"><option value="">All tasks</option></select></div>
    <div><label for="event-filter">Event type</label><input id="event-filter" placeholder="e.g. file_changed"></div>
    <div><label for="file-filter">File</label><input id="file-filter" placeholder="path fragment"></div>
  </div>
  <section id="activity"></section>
  <section id="students" class="active"></section>
  <section id="agency-metrics"></section>
  <section id="timeline"></section>
  <section id="git"></section>
  <section id="agents"></section>
  <section id="integrity"></section>
  <section id="rubric"></section>
  <section id="feedback"></section>
</main>`;
  const script = `
const vscode = acquireVsCodeApi();
const model = ${encoded};
const byId = (id) => document.getElementById(id);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
const pretty = (value) => esc(JSON.stringify(value, null, 2));
const getEventType = (event) => event.type ?? event.event ?? 'event';
const getEventFile = (event) => event.file ?? event.data?.file ?? '-';
const minutes = (value) => Number.isFinite(Number(value)) ? String(value) : '0';
const helpText = {
  agency: 'Agency is a heuristic signal about observable student ownership: task starts, edits, time, completion and dialog with the agent. It supports teacher judgement; it is not a grade.',
  linesTouched: 'Lines touched counts unique file-line positions changed by the student. The total line touches number may count repeated edits on the same line.',
  files: 'Files counts distinct files referenced by work events. Source-like files narrows that count to common code, markup, data and Markdown extensions.',
  activeTime: 'Active time estimates session duration from event timestamps, subtracting long idle gaps. It is approximate and depends on the student tracker recording events.',
  agentUse: 'Agent use counts recorded conversation turns. Compare student prompts with agent responses, then review the messages to judge whether the agent supported learning.',
  agencySignals: 'Agency signals are positive indicators derived from the event log, such as task starts, sustained edits, completion and dialog with the agent.',
  reviewFlags: 'Review flags are prompts for closer inspection. They are not accusations; they point to patterns such as little editing after agent use or long gaps.',
  agencyMetrics: 'Agency metrics are calculated from the student events.jsonl file and grouped by observable agency dimension. They are review signals, not an automatic grade or authorship proof.',
  activityChart: 'This chart groups timestamped events by hour. It helps identify when the student worked and whether work was concentrated or spread out.',
  linesChart: 'This chart shows the files with the most unique touched lines. It helps the teacher see where the student actually edited the submission.',
  agentChart: 'This chart compares recorded student messages and agent responses. A balanced or unbalanced ratio needs interpretation alongside the actual conversation.',
  activity: 'Activity shows the learning package metadata included with the submission: title, description, tasks and expected structure.',
  evidenceCard: 'Evidence cards show compact raw events after filters. Use them to verify where a report signal came from.',
  gitCard: 'Git cards show commits detected in the submitted repository. They are useful evidence, but absence of commits does not prove absence of work.',
  agentCard: 'Agent conversation cards show recorded student-agent messages. Completeness depends on whether the tools followed the recording instructions.',
  integrity: 'Integrity checks whether the local event hash chain is consistent. A valid chain is local consistency evidence, not forensic proof.',
  rubric: 'The rubric is the assessment structure included with the submission package. Use report evidence to support criterion-level feedback.',
  feedback: 'Feedback is saved outside the imported submission and can be exported as a ZIP for return or archiving.'
};
let selectedStudent = model.submission.contributions[0]?.studentId ?? '';

function contribution() { return model.submission.contributions.find((item) => item.studentId === selectedStudent); }
function render() {
  byId('student').innerHTML = model.submission.contributions.map((item) => \`<option value="\${esc(item.studentId)}">\${esc(item.studentId)}</option>\`).join('');
  byId('student').value = selectedStudent;
  byId('task-filter').innerHTML = '<option value="">All tasks</option>' + (model.submission.manifest.tasks ?? []).map((task) => \`<option value="\${esc(task.id)}">\${esc(task.title)}</option>\`).join('');
  byId('activity').innerHTML = \`\${sectionTitle('Activity', helpText.activity)}<div class="card">\${cardTitle(model.submission.manifest.title, helpText.activity)}<p>\${esc(model.submission.manifest.description ?? '')}</p><pre>\${pretty(model.submission.manifest)}</pre></div>\`;
  renderStudent();
}
function renderStudent() {
  const item = contribution();
  if (!item) { document.querySelectorAll('section:not(#activity)').forEach((section) => section.innerHTML = '<p>No contribution selected.</p>'); return; }
  const summary = model.summaries.find((value) => value.studentId === selectedStudent);
  const task = byId('task-filter').value;
  const eventTypeFilter = byId('event-filter').value.toLowerCase();
  const file = byId('file-filter').value.toLowerCase();
  const events = item.events.filter((event) => (!task || event.taskId === task) && (!eventTypeFilter || String(getEventType(event)).toLowerCase().includes(eventTypeFilter)) && (!file || String(getEventFile(event)).toLowerCase().includes(file)));
  byId('students').innerHTML = renderTeacherReport(summary);
  drawD3Report(summary);
  byId('agency-metrics').innerHTML = renderAgencyMetrics(model.agencyMetrics.find((value) => value.studentId === selectedStudent));
  byId('timeline').innerHTML = renderEvidenceTimeline(events);
  byId('git').innerHTML = \`\${sectionTitle('Git repository', helpText.gitCard)}<p>Detected: \${model.submission.hasGit ? 'yes' : 'no'}</p>\` + model.commits.map((commit) => \`<div class="card">\${cardTitleHtml(\`<code>\${esc(commit.hash?.slice(0, 10))}</code> \${esc(commit.message)}\`, helpText.gitCard)}<span class="muted">\${esc(commit.author)} - \${esc(commit.timestamp)}</span><br><button data-commit="\${esc(commit.hash)}">Show changed files</button></div>\`).join('');
  byId('agents').innerHTML = \`\${sectionTitle('Agent conversations', helpText.agentCard)}<p class="muted">Completeness depends on the agent and student tooling following the recording instructions.</p>\` + item.agentInteractions.map((interaction) => \`<div class="card">\${cardTitle(\`\${interaction.actor}\${interaction.agent ? ' - ' + interaction.agent : ''}\`, helpText.agentCard)}<span class="muted">\${esc(interaction.timestamp)}</span><p>\${esc(interaction.message)}</p></div>\`).join('') + (item.interactionErrors.length ? \`<pre class="warning">\${pretty(item.interactionErrors)}</pre>\` : '');
  byId('integrity').innerHTML = \`\${sectionTitle('Integrity', helpText.integrity)}<div class="card">\${cardTitle('Event chain check', helpText.integrity)}<p class="muted">A valid chain is local consistency evidence, not forensic proof or absolute authenticity.</p><pre>\${pretty(model.integrity[selectedStudent])}</pre></div>\`;
  byId('rubric').innerHTML = \`\${sectionTitle('Rubric', helpText.rubric)}<div class="card">\${cardTitle('Rubric data', helpText.rubric)}<pre>\${pretty(model.rubric ?? { message: 'No rubric found in submission' })}</pre></div>\`;
  byId('feedback').innerHTML = \`\${sectionTitle('Feedback', helpText.feedback)}<div class="card">\${cardTitle('Review feedback', helpText.feedback)}<p class="muted">Saved outside the imported submission.</p><label>Status</label><select id="feedback-status"><option value="pending">Pending</option><option value="completed">Completed</option></select><label>General comment</label><textarea id="general-comment"></textarea><label>Criterion evaluations (JSON)</label><textarea id="evaluations" style="min-height:300px">\${esc(JSON.stringify((model.rubric?.criteria ?? []).map((criterion) => ({ criterionId: criterion.id, level: 0, score: 0, comment: '', evidence: [] })), null, 2))}</textarea><p><button id="save-feedback">Save feedback</button> <button id="export-feedback">Export feedback</button></p></div>\`;
  document.querySelectorAll('[data-commit]').forEach((button) => button.addEventListener('click', () => vscode.postMessage({ type: 'commitFiles', commit: button.dataset.commit })));
  byId('save-feedback').addEventListener('click', () => { try { vscode.postMessage({ type: 'saveFeedback', feedback: { submissionId: model.submission.id, studentId: selectedStudent, status: byId('feedback-status').value, updatedAt: new Date().toISOString(), generalComment: byId('general-comment').value, evaluations: JSON.parse(byId('evaluations').value) } }); } catch { vscode.postMessage({ type: 'error', message: 'Evaluation JSON is invalid' }); } });
  byId('export-feedback').addEventListener('click', () => vscode.postMessage({ type: 'exportFeedback' }));
}
function renderTeacherReport(summary) {
  const agency = summary?.agency ?? {};
  const activity = Array.isArray(summary?.activityByHour) ? summary.activityByHour : [];
  return \`
    <h2>Teacher report</h2>
    <p class="muted">Quick signals for review. These support teacher judgement; they are not an automatic grade.</p>
    <div class="grid">
      \${metricCard('Agency', esc(agency.level ?? 'unknown'), \`\${esc(agency.score ?? 0)}/6 evidence score\`, helpText.agency)}
      \${metricCard('Lines touched', esc(summary?.uniqueLinesTouched ?? 0), \`\${esc(summary?.lineTouchCount ?? 0)} total line touches\`, helpText.linesTouched)}
      \${metricCard('Files', esc(summary?.filesModified ?? 0), \`\${esc(summary?.sourceFilesModified ?? 0)} source-like files\`, helpText.files)}
      \${metricCard('Active time', minutes(summary?.activeMinutes), 'minutes excluding long gaps', helpText.activeTime)}
      \${metricCard('Edit rhythm', esc(summary?.editBursts ?? 0), \`\${esc(summary?.fileChangeEvents ?? 0)} file change events\`, editRhythmHelp(summary))}
      \${metricCard('Agent use', esc(summary?.agentInteractions ?? 0), \`\${esc(summary?.studentAgentMessages ?? 0)} student / \${esc(summary?.agentResponses ?? 0)} agent\`, helpText.agentUse)}
    </div>
    <div class="grid">
      <div class="card">
        \${cardTitle('Agency signals', helpText.agencySignals)}
        \${signalList(agency.positives, 'No positive signals calculated.')}
      </div>
      <div class="card">
        \${cardTitle('Review flags', helpText.reviewFlags)}
        \${signalList(agency.concerns, 'No immediate flags.')}
      </div>
    </div>
    <div class="card">
      \${cardTitle('Interaction view', helpText.activityChart)}
      <div id="activity-chart" class="chart"></div>
      \${activityBars(activity)}
    </div>
    <div class="grid">
      <div class="card">
        \${cardTitle('Lines by file', helpText.linesChart)}
        <div id="lines-chart" class="chart"></div>
      </div>
      <div class="card">
        \${cardTitle('Student / agent balance', helpText.agentChart)}
        <div id="agent-chart" class="chart"></div>
      </div>
    </div>\`;
}
function renderAgencyMetrics(metrics) {
  if (!metrics?.groups?.length) return \`\${sectionTitle('Agency metrics', helpText.agencyMetrics)}<p>No metrics available for this contribution.</p>\`;
  const totals = metrics.groups.reduce((acc, group) => {
    group.metrics.forEach((metric) => {
      acc.total += 1;
      if (metric.priority) acc.priority += 1;
      acc[metric.reliability] = (acc[metric.reliability] ?? 0) + 1;
    });
    return acc;
  }, { total: 0, priority: 0, direct: 0, estimated: 0, limited: 0 });
  return \`
    \${sectionTitle('Agency metrics', helpText.agencyMetrics)}
    <p class="muted">Calculated from the imported event log for \${esc(metrics.studentId)}. Prioritized metrics are marked for first-pass review.</p>
    <div class="grid">
      \${metricCard('Metrics', esc(totals.total), \`\${esc(totals.priority)} prioritized\`, helpText.agencyMetrics)}
      \${metricCard('Direct', esc(totals.direct), 'computed directly from events', helpText.agencyMetrics)}
      \${metricCard('Estimated', esc(totals.estimated), 'uses event-derived heuristics', helpText.agencyMetrics)}
      \${metricCard('Limited', esc(totals.limited), 'needs extra context to read strongly', helpText.agencyMetrics)}
    </div>
    \${metrics.groups.map(renderMetricGroup).join('')}\`;
}
function renderMetricGroup(group) {
  return \`<div class="card agency-group">
    \${cardTitle(group.dimension, helpText.agencyMetrics)}
    <table>
      <thead><tr><th>N</th><th>Metric</th><th>Value</th><th>Evidence</th><th>How to read it</th></tr></thead>
      <tbody>\${group.metrics.map(renderAgencyMetric).join('')}</tbody>
    </table>
  </div>\`;
}
function renderAgencyMetric(metric) {
  const badge = metric.priority ? '<span class="badge">Priority</span>' : '';
  const reliability = \`<span class="reliability \${esc(metric.reliability)}">\${esc(metric.reliability)}</span>\`;
  const value = \`\${esc(metric.value)}\${metric.unit ? ' ' + esc(metric.unit) : ''}\`;
  return \`<tr>
    <td><code>\${esc(metric.id)}</code></td>
    <td><strong>\${esc(metric.name)}</strong> \${badge}<br><span class="muted">\${reliability}</span></td>
    <td><strong>\${value}</strong></td>
    <td><span class="muted">\${esc(metric.detail)}</span><br><small>\${esc(metric.evidenceCount)} source events/signals</small></td>
    <td>\${esc(metric.interpretation)}</td>
  </tr>\`;
}
function metricCard(label, value, detail, help) {
  return \`<div class="card metric"><span class="muted metric-label">\${label}\${helpIcon(help)}</span><strong>\${value}</strong><small>\${detail}</small></div>\`;
}
function helpIcon(help) {
  return help ? \`<span class="info-tooltip" tabindex="0" aria-label="\${esc(help)}">?<span role="tooltip">\${esc(help)}</span></span>\` : '';
}
function cardTitle(label, help) {
  return cardTitleHtml(esc(label), help);
}
function cardTitleHtml(label, help) {
  return \`<h3 class="card-title">\${label}\${helpIcon(help)}</h3>\`;
}
function sectionTitle(label, help) {
  return \`<h2 class="card-title">\${esc(label)}\${helpIcon(help)}</h2>\`;
}
function editRhythmHelp(summary) {
  const fileChangeEvents = Number(summary?.fileChangeEvents) || 0;
  return \`Edit rhythm counts editing bursts: groups of file changes separated by short pauses. Minimum is 0 when no file changes were recorded. For this submission the maximum possible is \${fileChangeEvents}, because each file change could be its own burst. Interpret it as work rhythm evidence: higher values suggest separated editing sessions; lower values suggest concentrated editing. It does not measure code quality or autonomy by itself.\`;
}
function signalList(values, empty) {
  return Array.isArray(values) && values.length
    ? \`<ul>\${values.map((value) => \`<li>\${esc(value)}</li>\`).join('')}</ul>\`
    : \`<p class="muted">\${esc(empty)}</p>\`;
}
function activityBars(values) {
  if (!values.length) return '<p class="muted">No timestamped activity to chart.</p>';
  const max = Math.max(...values.map((item) => Number(item.count) || 0), 1);
  return \`<div class="bars fallback-bars">\${values.map((item) => \`<div class="bar-row"><code>\${esc(item.hour)}:00</code><div class="bar-track"><span style="width:\${Math.max(4, ((Number(item.count) || 0) / max) * 100)}%"></span></div><small>\${esc(item.count)}</small></div>\`).join('')}</div>\`;
}
function chartColors() {
  const style = getComputedStyle(document.documentElement);
  return {
    text: style.getPropertyValue('--vscode-foreground').trim() || '#333',
    muted: style.getPropertyValue('--vscode-descriptionForeground').trim() || '#777',
    border: style.getPropertyValue('--vscode-panel-border').trim() || '#ccc',
    accent: style.getPropertyValue('--vscode-progressBar-background').trim() || '#0e70c0',
    agent: style.getPropertyValue('--vscode-charts-green').trim() || '#388a34',
    warning: style.getPropertyValue('--vscode-editorWarning-foreground').trim() || '#b89500'
  };
}
function drawD3Report(summary) {
  if (!window.d3 || !summary) return;
  document.querySelectorAll('.fallback-bars').forEach((item) => item.remove());
  drawActivityChart(summary.activityByHour ?? []);
  drawLinesChart(summary.linesByFile ?? []);
  drawAgentChart([
    { label: 'Student', value: Number(summary.studentAgentMessages) || 0 },
    { label: 'Agent', value: Number(summary.agentResponses) || 0 }
  ]);
}
function drawActivityChart(values) {
  const target = byId('activity-chart');
  if (!target) return;
  const data = Array.isArray(values) ? values.map((item) => ({ label: String(item.hour).padStart(2, '0') + ':00', value: Number(item.count) || 0 })) : [];
  drawBars(target, data, { horizontal: false, empty: 'No timestamped activity to chart.' });
}
function drawLinesChart(values) {
  const target = byId('lines-chart');
  if (!target) return;
  const data = Array.isArray(values) ? values.map((item) => ({ label: String(item.file), value: Number(item.lines) || 0 })).sort((a, b) => b.value - a.value).slice(0, 8) : [];
  drawBars(target, data, { horizontal: true, empty: 'No line-level file evidence recorded.' });
}
function drawAgentChart(values) {
  const target = byId('agent-chart');
  if (!target) return;
  const data = values.filter((item) => item.value > 0);
  target.innerHTML = '';
  if (!data.length) {
    target.innerHTML = '<p class="muted">No agent conversation recorded.</p>';
    return;
  }
  const colors = chartColors();
  const width = Math.max(260, target.clientWidth || 360);
  const height = 190;
  const radius = Math.min(width, height) / 2 - 16;
  const svg = d3.select(target).append('svg').attr('viewBox', \`0 0 \${width} \${height}\`);
  const group = svg.append('g').attr('transform', \`translate(\${width / 2}, \${height / 2})\`);
  const pie = d3.pie().value((item) => item.value);
  const arc = d3.arc().innerRadius(radius * 0.55).outerRadius(radius);
  const palette = [colors.accent, colors.agent];
  group.selectAll('path').data(pie(data)).join('path')
    .attr('d', arc)
    .attr('fill', (_item, index) => palette[index % palette.length])
    .attr('stroke', colors.border);
  group.selectAll('text').data(pie(data)).join('text')
    .attr('transform', (item) => \`translate(\${arc.centroid(item)})\`)
    .attr('text-anchor', 'middle')
    .attr('dominant-baseline', 'middle')
    .attr('fill', colors.text)
    .text((item) => item.data.value);
  const legend = svg.append('g').attr('transform', 'translate(12, 12)');
  data.forEach((item, index) => {
    const row = legend.append('g').attr('transform', \`translate(0, \${index * 22})\`);
    row.append('rect').attr('width', 10).attr('height', 10).attr('fill', palette[index % palette.length]);
    row.append('text').attr('x', 16).attr('y', 10).attr('fill', colors.text).text(\`\${item.label}: \${item.value}\`);
  });
}
function drawBars(target, data, options) {
  target.innerHTML = '';
  if (!data.length) {
    target.innerHTML = \`<p class="muted">\${esc(options.empty)}</p>\`;
    return;
  }
  const colors = chartColors();
  const width = Math.max(280, target.clientWidth || 640);
  const height = options.horizontal ? Math.max(150, data.length * 34 + 28) : 180;
  const margin = options.horizontal ? { top: 8, right: 36, bottom: 24, left: 150 } : { top: 12, right: 16, bottom: 34, left: 34 };
  const svg = d3.select(target).append('svg').attr('viewBox', \`0 0 \${width} \${height}\`);
  if (options.horizontal) {
    const x = d3.scaleLinear().domain([0, d3.max(data, (item) => item.value) || 1]).range([margin.left, width - margin.right]);
    const y = d3.scaleBand().domain(data.map((item) => item.label)).range([margin.top, height - margin.bottom]).padding(0.22);
    svg.append('g').selectAll('rect').data(data).join('rect')
      .attr('x', margin.left)
      .attr('y', (item) => y(item.label))
      .attr('width', (item) => x(item.value) - margin.left)
      .attr('height', y.bandwidth())
      .attr('fill', colors.accent);
    svg.append('g').selectAll('text.file-label').data(data).join('text')
      .attr('class', 'file-label')
      .attr('x', margin.left - 8)
      .attr('y', (item) => (y(item.label) ?? 0) + y.bandwidth() / 2)
      .attr('text-anchor', 'end')
      .attr('dominant-baseline', 'middle')
      .attr('fill', colors.text)
      .text((item) => item.label.length > 24 ? '...' + item.label.slice(-24) : item.label);
    svg.append('g').selectAll('text.value-label').data(data).join('text')
      .attr('x', (item) => x(item.value) + 6)
      .attr('y', (item) => (y(item.label) ?? 0) + y.bandwidth() / 2)
      .attr('dominant-baseline', 'middle')
      .attr('fill', colors.muted)
      .text((item) => item.value);
    return;
  }
  const x = d3.scaleBand().domain(data.map((item) => item.label)).range([margin.left, width - margin.right]).padding(0.24);
  const y = d3.scaleLinear().domain([0, d3.max(data, (item) => item.value) || 1]).nice().range([height - margin.bottom, margin.top]);
  svg.append('g').attr('transform', \`translate(0,\${height - margin.bottom})\`).call(d3.axisBottom(x).tickSizeOuter(0)).selectAll('text').attr('fill', colors.text);
  svg.append('g').attr('transform', \`translate(\${margin.left},0)\`).call(d3.axisLeft(y).ticks(4)).selectAll('text').attr('fill', colors.muted);
  svg.selectAll('.domain,.tick line').attr('stroke', colors.border);
  svg.append('g').selectAll('rect').data(data).join('rect')
    .attr('x', (item) => x(item.label))
    .attr('y', (item) => y(item.value))
    .attr('width', x.bandwidth())
    .attr('height', (item) => y(0) - y(item.value))
    .attr('fill', colors.accent);
}
function renderEvidenceTimeline(events) {
  if (!events.length) return '<h2>Evidence timeline</h2><p>No matching events.</p>';
  return '<h2>Evidence timeline</h2><p class="muted">Compact event trail for drilling into the report above.</p>' + events.map((event) => {
    const details = Object.fromEntries(Object.entries(event).filter(([key]) => !['content','fileContent','hash','previousHash'].includes(key)));
    return \`<div class="card">\${cardTitle(\`\${event.timestamp ?? 'No timestamp'} - \${getEventType(event)}\`, helpText.evidenceCard)}<span class="muted">Task: \${esc(event.taskId ?? '-')} - File: \${esc(getEventFile(event))}</span><pre>\${pretty(details)}</pre></div>\`;
  }).join('');
}
document.querySelectorAll('.tab').forEach((button) => button.addEventListener('click', () => document.querySelectorAll('section').forEach((section) => section.classList.toggle('active', section.id === button.dataset.tab))));
byId('student').addEventListener('change', () => { selectedStudent = byId('student').value; renderStudent(); });
['task-filter','event-filter','file-filter'].forEach((id) => byId(id).addEventListener('input', renderStudent));
window.addEventListener('message', (event) => { if (event.data.type === 'commitFiles') alert(event.data.files.join('\\n') || 'No changed files'); });
render();`;
  return webviewDocument(webview, "Submission Review", body, script, [d3Uri]);
}
