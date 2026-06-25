import { ActivitySnapshot } from '../services/LearningActivityService';

export function getStudentPanelHtml(
	snapshot: ActivitySnapshot | undefined,
	nonce: string
): string {
	const initialData = JSON.stringify(snapshot ?? null).replace(/</g, '\\u003c');
	return `<!DOCTYPE html>
<html lang="es">
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
		.grid {
			display: grid;
			grid-template-columns: minmax(0, 2fr) minmax(260px, 1fr);
			gap: 16px;
			margin-top: 20px;
		}
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
		ul { padding-left: 20px; }
		li { margin: 6px 0; }
		pre {
			white-space: pre-wrap;
			word-break: break-word;
			font-family: var(--vscode-editor-font-family);
			font-size: 12px;
		}
		.empty { max-width: 600px; margin: 80px auto; text-align: center; }
		@media (max-width: 800px) { .grid { grid-template-columns: 1fr; } }
	</style>
</head>
<body>
	<div id="app"></div>
	<script nonce="${nonce}">
		const vscode = acquireVsCodeApi();
		let snapshot = ${initialData};

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
						<p class="muted">No hay una actividad cargada en esta ventana.</p>
						<div class="actions">
							<button data-command="loadZip">Cargar ZIP</button>
							<button class="secondary" data-command="loadUrl">Cargar desde URL</button>
						</div>
					</div>\`;
				bindActions();
				return;
			}
			if (!snapshot.profile || !snapshot.state) {
				app.innerHTML = \`
					<div class="empty card">
						<h1>\${escapeHtml(snapshot.manifest.title)}</h1>
						<p class="muted">Debes registrar tu identidad antes de empezar tareas o generar evidencias.</p>
						<button data-command="registerStudent">Registrar estudiante</button>
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
							<button data-command="startTask" data-task-id="\${escapeHtml(task.id)}" \${canStart ? '' : 'disabled'}>Empezar tarea</button>
							<button data-command="finishTask" data-task-id="\${escapeHtml(task.id)}" \${canFinish ? '' : 'disabled'}>Terminar tarea</button>
						</div>
					</article>\`;
			}).join('');

			const events = snapshot.recentEvents.map(event =>
				\`<li><strong>\${escapeHtml(event.event)}</strong> <span class="muted">\${escapeHtml(event.timestamp)}\${event.taskId ? \` · \${escapeHtml(event.taskId)}\` : ''}</span></li>\`
			).join('');

			app.innerHTML = \`
				<header>
					<div>
						<h1>\${escapeHtml(snapshot.manifest.title)}</h1>
						<p class="muted">\${escapeHtml(snapshot.manifest.description ?? '')}</p>
						<p><strong>Estudiante:</strong> \${escapeHtml(snapshot.profile.displayName)} (\${escapeHtml(snapshot.profile.studentId)})</p>
					</div>
					<button data-command="exportSubmission">Exportar entrega</button>
				</header>
				<div class="grid">
					<main><div class="section-title"><h2>Tareas</h2></div>\${tasks}</main>
					<aside>
						<section class="card">
							<h2>Repositorio Git</h2>
							<pre>\${escapeHtml(snapshot.gitStatus)}</pre>
						</section>
						<section class="card task">
							<h2>Eventos recientes</h2>
							<ul>\${events || '<li class="muted">Sin eventos.</li>'}</ul>
						</section>
					</aside>
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
