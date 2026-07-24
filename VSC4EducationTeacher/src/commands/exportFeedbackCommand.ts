import * as vscode from "vscode";
import { t } from "../i18n";
import { FeedbackService } from "../services/FeedbackService";
import { ImportedSubmission } from "../types/Submission";

export function exportFeedbackCommand(
  context: vscode.ExtensionContext,
  feedback = new FeedbackService()
): () => Promise<void> {
  return async () => {
    const submission =
      context.workspaceState.get<ImportedSubmission>("activeSubmission");
    if (!submission) {
      void vscode.window.showWarningMessage(t("Import a submission first"));
      return;
    }
    const destination = await vscode.window.showSaveDialog({
      filters: { [t("ZIP archive")]: ["zip"] },
      defaultUri: vscode.Uri.file(`${submission.id}-feedback.zip`)
    });
    if (!destination) return;
    await feedback.export(
      context.globalStorageUri.fsPath,
      submission.id,
      destination.fsPath
    );
    void vscode.window.showInformationMessage(t("Feedback exported"));
  };
}
