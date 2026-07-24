import * as vscode from "vscode";

export function t(message: string, ...args: Array<string | number | boolean>): string {
  return vscode.l10n.t(message, ...args);
}

export function locale(): string {
  return vscode.env.language?.toLowerCase().startsWith("es") ? "es" : "en";
}
