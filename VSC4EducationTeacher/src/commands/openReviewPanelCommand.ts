import * as vscode from "vscode";
import { ImportedSubmission } from "../types/Submission";
import { SubmissionReviewPanel } from "../webview/SubmissionReviewPanel";

export function openReviewPanelCommand(
  context: vscode.ExtensionContext
): () => Promise<void> {
  return async () => {
    const submission =
      context.workspaceState.get<ImportedSubmission>("activeSubmission");
    if (!submission) {
      void vscode.window.showWarningMessage("Import a submission first");
      return;
    }
    await SubmissionReviewPanel.show(
      submission,
      context.globalStorageUri.fsPath,
      context.extensionUri
    );
  };
}
