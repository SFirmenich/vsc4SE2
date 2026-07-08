import * as vscode from "vscode";
import { exportFeedbackCommand } from "./commands/exportFeedbackCommand";
import { importSubmissionCommand } from "./commands/importSubmissionCommand";
import { openReviewPanelCommand } from "./commands/openReviewPanelCommand";
import { openTeacherPanelCommand } from "./commands/openTeacherPanelCommand";

export function activate(context: vscode.ExtensionContext): void {
  const teacherPanel = openTeacherPanelCommand(context);
  const commands: Array<[string, () => Promise<void>]> = [
    ["teacherActivity.openPanel", teacherPanel],
    ["teacherActivity.create", teacherPanel],
    ["teacherActivity.open", teacherPanel],
    ["teacherActivity.validate", teacherPanel],
    ["teacherActivity.export", teacherPanel],
    ["teacherSubmission.import", importSubmissionCommand(context)],
    ["teacherSubmission.openReview", openReviewPanelCommand(context)],
    ["teacherSubmission.exportFeedback", exportFeedbackCommand(context)]
  ];
  context.subscriptions.push(
    ...commands.map(([id, handler]) =>
      vscode.commands.registerCommand(id, async () => {
        try {
          await handler();
        } catch (error) {
          void vscode.window.showErrorMessage(
            error instanceof Error ? error.message : String(error)
          );
        }
      })
    )
  );
}

export function deactivate(): void {}
