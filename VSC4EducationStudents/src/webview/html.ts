import { ActivitySnapshot } from '../services/LearningActivityService';
import { StudentPanelStrings } from '../i18n';

export function getStudentPanelHtml(
	snapshot: ActivitySnapshot | undefined,
	nonce: string,
	strings: StudentPanelStrings
): string {
	const initialData = JSON.stringify(snapshot ?? null).replace(/</g, '\\u003c');
	const encodedStrings = JSON.stringify(strings).replace(/</g, '\\u003c');
	return `<!DOCTYPE html>
<html lang="${strings.language}">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
	<title>Learning Activity Tracker</title>
	<style>
		:root { color-scheme: light dark; }
		body {
			padding: 24px;
			color: var(--vscode-foreground);
			background: var(--vscode-editor-background);
			font-family: var(--vscode-font-family);
		}
		header, .section-title, .task-header, .actions {
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: 12px;
		}
		h1 { margin: 0 0 8px; font-size: 24px; }
		h2 { margin: 0; font-size: 17px; }
		.muted { color: var(--vscode-descriptionForeground); }
		.grid { margin-top: 20px; }
		.card {
			padding: 16px;
			border: 1px solid var(--vscode-panel-border);
			border-radius: 6px;
			background: var(--vscode-sideBar-background);
		}
		.task { margin-top: 12px; }
		.badge {
			padding: 3px 8px;
			border-radius: 999px;
			background: var(--vscode-badge-background);
			color: var(--vscode-badge-foreground);
			font-size: 12px;
		}
		.badge.active { background: var(--vscode-statusBarItem-warningBackground); }
		.badge.completed { background: var(--vscode-testing-iconPassed); color: var(--vscode-editor-background); }
		button {
			padding: 7px 12px;
			border: 0;
			border-radius: 2px;
			color: var(--vscode-button-foreground);
			background: var(--vscode-button-background);
			cursor: pointer;
		}
		button:hover { background: var(--vscode-button-hoverBackground); }
		button.secondary {
			color: var(--vscode-button-secondaryForeground);
			background: var(--vscode-button-secondaryBackground);
		}
		button:disabled { opacity: .5; cursor: default; }
		.empty { max-width: 600px; margin: 80px auto; text-align: center; }
	</style>
</head>
<body>
	<div id="app"></div>
	<script nonce="${nonce}">
		const vscode = acquireVsCodeApi();
		let snapshot = ${initialData};
		const s = ${encodedStrings};

		function escapeHtml(value) {
			return String(value ?? '')
				.replaceAll('&', '&amp;')
				.replaceAll('<', '&lt;')
				.replaceAll('>', '&gt;')
				.replaceAll('"', '&quot;')
				.replaceAll("'", '&#039;');
		}

		function send(command, taskId) {
			vscode.postMessage({ command, taskId });
		}

		function render() {
			const app = document.getElementById('app');
			if (!snapshot) {
				app.innerHTML = \`
					<div class="empty card">
						<h1>Learning Activity Tracker</h1>
						<p class="muted">\${escapeHtml(s.noActivity)}</p>
						<div class="actions">
							<button data-command="loadZip">\${escapeHtml(s.loadZip)}</button>
							<button class="secondary" data-command="loadUrl">\${escapeHtml(s.loadUrl)}</button>
						</div>
					</div>\`;
				bindActions();
				return;
			}
			if (!snapshot.profile || !snapshot.state) {
				app.innerHTML = \`
					<div class="empty card">
						<h1>\${escapeHtml(snapshot.manifest.title)}</h1>
						<p class="muted">\${escapeHtml(s.registerRequired)}</p>
						<button data-command="registerStudent">\${escapeHtml(s.registerStudent)}</button>
					</div>\`;
				bindActions();
				return;
			}

			const tasks = snapshot.manifest.tasks.map(task => {
				const state = snapshot.state.tasks[task.id] ?? { status: 'pending' };
				const canStart = !snapshot.state.currentTaskId && state.status === 'pending';
				const canFinish = snapshot.state.currentTaskId === task.id && state.status === 'active';
				return \`
					<article class="task card">
						<div class="task-header">
							<div>
								<h2>\${escapeHtml(task.title)}</h2>
								<div class="muted">\${escapeHtml(task.id)}</div>
							</div>
							<span class="badge \${state.status}">\${escapeHtml(state.status)}</span>
						</div>
						\${task.description ? \`<p>\${escapeHtml(task.description)}</p>\` : ''}
						<div class="actions">
							<div class="actions">
								<button data-command="startTask" data-task-id="\${escapeHtml(task.id)}" \${canStart ? '' : 'disabled'}>\${escapeHtml(s.startTask)}</button>
								\${task.file ? \`<button class="secondary" data-command="openTaskFile" data-task-id="\${escapeHtml(task.id)}">\${escapeHtml(s.viewTask)}</button>\` : ''}
							</div>
							<button data-command="finishTask" data-task-id="\${escapeHtml(task.id)}" \${canFinish ? '' : 'disabled'}>\${escapeHtml(s.finishTask)}</button>
						</div>
					</article>\`;
			}).join('');

			app.innerHTML = \`
				<header>
					<div>
						<h1>\${escapeHtml(snapshot.manifest.title)}</h1>
						<p class="muted">\${escapeHtml(snapshot.manifest.description ?? '')}</p>
						<p><strong>\${escapeHtml(s.student)}:</strong> \${escapeHtml(snapshot.profile.displayName)} (\${escapeHtml(snapshot.profile.studentId)})</p>
					</div>
					<button data-command="exportSubmission">\${escapeHtml(s.exportSubmission)}</button>
				</header>
				<div class="grid">
					<main><div class="section-title"><h2>\${escapeHtml(s.tasks)}</h2></div>\${tasks}</main>
				</div>\`;
			bindActions();
		}

		function bindActions() {
			for (const button of document.querySelectorAll('button[data-command]')) {
				button.addEventListener('click', () => {
					send(button.dataset.command, button.dataset.taskId);
				});
			}
		}

		window.addEventListener('message', event => {
			if (event.data.command === 'refresh') {
				snapshot = event.data.snapshot;
				render();
			}
		});

		render();
	</script>
</body>
</html>`;
}
