import * as vscode from "vscode";
import { TeacherPanel } from "../webview/TeacherPanel";

export function openTeacherPanelCommand(
  context: vscode.ExtensionContext
): () => Promise<void> {
  return async () => {
    await TeacherPanel.show(context);
  };
}
