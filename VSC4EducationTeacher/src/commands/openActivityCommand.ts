import * as vscode from "vscode";
import { pathExists } from "../utils/fs";
import { ActivityDesignerPanel } from "../webview/ActivityDesignerPanel";

export function openActivityCommand(
  context: vscode.ExtensionContext
): () => Promise<void> {
  return async () => {
    const folder = await vscode.window.showOpenDialog({
      canSelectFolders: true,
      canSelectFiles: false,
      canSelectMany: false,
      openLabel: "Open activity"
    });
    if (!folder?.[0]) return;
    if (!(await pathExists(`${folder[0].fsPath}/manifest.json`))) {
      void vscode.window.showErrorMessage(
        "The selected folder does not contain manifest.json"
      );
      return;
    }
    await context.workspaceState.update("activeActivityRoot", folder[0].fsPath);
    await ActivityDesignerPanel.show(folder[0].fsPath);
  };
}
