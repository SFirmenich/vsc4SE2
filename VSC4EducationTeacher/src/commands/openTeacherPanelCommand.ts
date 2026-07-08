import * as vscode from "vscode";
import { TeacherPanel } from "../webview/TeacherPanel";

export type TeacherPanelMode = "activity" | "review";

export function openTeacherPanelCommand(
  context: vscode.ExtensionContext,
  mode?: TeacherPanelMode
): () => Promise<void> {
  return async () => {
    await TeacherPanel.show(context, mode);
  };
}
