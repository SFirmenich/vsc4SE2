import * as vscode from "vscode";
import { ActivityValidationService } from "../services/ActivityValidationService";

export function validateActivityCommand(
  context: vscode.ExtensionContext,
  validation = new ActivityValidationService()
): () => Promise<void> {
  return async () => {
    const root = context.workspaceState.get<string>("activeActivityRoot");
    if (!root) {
      void vscode.window.showWarningMessage("Open an activity first");
      return;
    }
    const result = await validation.validate(root);
    const document = await vscode.workspace.openTextDocument({
      language: "markdown",
      content: [
        "# Activity validation",
        "",
        `Result: **${result.valid ? "valid" : "invalid"}**`,
        "",
        ...(["errors", "warnings", "info"] as const).flatMap((group) => [
          `## ${group}`,
          "",
          ...(result[group].length
            ? result[group].map(
                (issue) => `- \`${issue.code}\`: ${issue.message}`
              )
            : ["- None"]),
          ""
        ])
      ].join("\n")
    });
    await vscode.window.showTextDocument(document, { preview: true });
  };
}
