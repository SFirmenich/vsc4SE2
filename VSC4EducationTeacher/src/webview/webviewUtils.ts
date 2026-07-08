import * as vscode from "vscode";

export function nonce(): string {
  const characters =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from(
    { length: 32 },
    () => characters[Math.floor(Math.random() * characters.length)]
  ).join("");
}

export function webviewDocument(
  webview: vscode.Webview,
  title: string,
  body: string,
  script: string,
  scriptSources: vscode.Uri[] = []
): string {
  const scriptNonce = nonce();
  const sourceScripts = scriptSources
    .map(
      (source) =>
        `<script nonce="${scriptNonce}" src="${source.toString()}"></script>`
    )
    .join("\n");
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${scriptNonce}';">
  <title>${escapeHtml(title)}</title>
  <style>
    :root { color-scheme: light dark; }
    body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 0; margin: 0; }
    header { padding: 16px 20px; border-bottom: 1px solid var(--vscode-panel-border); position: sticky; top: 0; background: var(--vscode-editor-background); z-index: 2; }
    main { padding: 20px; max-width: 1100px; margin: auto; }
    nav { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 12px; }
    button { border: 1px solid var(--vscode-button-border, transparent); color: var(--vscode-button-foreground); background: var(--vscode-button-background); padding: 7px 12px; cursor: pointer; }
    button:hover { background: var(--vscode-button-hoverBackground); }
    button.secondary { color: var(--vscode-foreground); background: var(--vscode-button-secondaryBackground); }
    button.mode-card { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; min-height: 86px; padding: 14px 16px; text-align: left; white-space: normal; }
    button.mode-card strong { display: block; font-size: 15px; line-height: 1.25; }
    button.mode-card span { display: block; color: var(--vscode-button-foreground); font-size: 12px; font-weight: 400; line-height: 1.35; opacity: 0.82; }
    input, textarea, select { box-sizing: border-box; width: 100%; padding: 7px; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border); }
    textarea { min-height: 90px; resize: vertical; font-family: var(--vscode-editor-font-family); }
    label { display: block; margin: 10px 0 4px; font-weight: 600; }
    section { display: none; }
    section.active { display: block; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 12px; }
    .card { border: 1px solid var(--vscode-panel-border); padding: 14px; margin: 12px 0; }
    .card-title { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
    .metric { min-height: 82px; display: flex; flex-direction: column; gap: 6px; justify-content: center; }
    .metric-label { display: inline-flex; align-items: center; gap: 6px; position: relative; }
    .metric strong { display: block; font-size: 26px; line-height: 1.1; }
    .metric small { color: var(--vscode-descriptionForeground); }
    .info-tooltip { position: relative; display: inline-flex; align-items: center; justify-content: center; width: 16px; height: 16px; border: 1px solid var(--vscode-panel-border); border-radius: 50%; color: var(--vscode-foreground); font-size: 11px; line-height: 1; cursor: help; }
    .info-tooltip [role="tooltip"] { display: none; position: absolute; left: 22px; top: -8px; z-index: 3; width: min(360px, 70vw); padding: 10px; border: 1px solid var(--vscode-panel-border); background: var(--vscode-editor-background); color: var(--vscode-foreground); box-shadow: 0 4px 14px rgba(0,0,0,0.25); font-size: 12px; line-height: 1.4; font-weight: 400; }
    .info-tooltip:hover [role="tooltip"], .info-tooltip:focus [role="tooltip"] { display: block; }
    .bars { display: grid; gap: 8px; }
    .bar-row { display: grid; grid-template-columns: 52px 1fr 40px; align-items: center; gap: 8px; }
    .bar-track { height: 10px; background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border); }
    .bar-track span { display: block; height: 100%; background: var(--vscode-progressBar-background); }
    .chart { min-height: 150px; width: 100%; overflow: hidden; }
    .chart svg { display: block; width: 100%; height: auto; }
    .chart text { font-family: var(--vscode-font-family); font-size: 11px; }
    .row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
    .row > * { width: auto; }
    .badge, .reliability { display: inline-flex; align-items: center; width: fit-content; border: 1px solid var(--vscode-panel-border); padding: 1px 6px; font-size: 11px; line-height: 1.5; }
    .badge { color: var(--vscode-button-foreground); background: var(--vscode-button-background); }
    .reliability.direct { color: var(--vscode-charts-green); }
    .reliability.estimated { color: var(--vscode-charts-yellow); }
    .reliability.limited { color: var(--vscode-editorWarning-foreground); }
    .agency-group table { table-layout: fixed; }
    .agency-group th:nth-child(1), .agency-group td:nth-child(1) { width: 44px; }
    .agency-group th:nth-child(3), .agency-group td:nth-child(3) { width: 120px; }
    .muted { color: var(--vscode-descriptionForeground); }
    .error { color: var(--vscode-errorForeground); }
    .warning { color: var(--vscode-editorWarning-foreground); }
    pre { white-space: pre-wrap; overflow-wrap: anywhere; background: var(--vscode-textCodeBlock-background); padding: 12px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { text-align: left; padding: 7px; border-bottom: 1px solid var(--vscode-panel-border); vertical-align: top; }
    code { font-family: var(--vscode-editor-font-family); }
  </style>
</head>
<body>
${body}
${sourceScripts}
<script nonce="${scriptNonce}">${script}</script>
</body>
</html>`;
}

export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
