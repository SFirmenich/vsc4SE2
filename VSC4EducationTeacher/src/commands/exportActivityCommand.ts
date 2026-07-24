import * as path from "path";
import * as vscode from "vscode";
import { t } from "../i18n";
import { ActivityPackageService } from "../services/ActivityPackageService";

export function exportActivityCommand(
  context: vscode.ExtensionContext,
  packages = new ActivityPackageService()
): () => Promise<void> {
  return async () => {
    const root = context.workspaceState.get<string>("activeActivityRoot");
    if (!root) {
      void vscode.window.showWarningMessage(t("Open an activity first"));
      return;
    }
    const destination = await vscode.window.showSaveDialog({
      filters: { [t("ZIP archive")]: ["zip"] },
      defaultUri: vscode.Uri.file(
        path.join(path.dirname(root), `${path.basename(root)}.zip`)
      )
    });
    if (!destination) return;
    await packages.export(root, destination.fsPath, true);
    void vscode.window.showInformationMessage(t("Activity package exported"));
  };
}
