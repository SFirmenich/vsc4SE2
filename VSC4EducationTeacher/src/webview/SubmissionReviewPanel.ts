import { promises as fs } from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { AgencyMetricsService } from "../services/AgencyMetricsService";
import { FeedbackService } from "../services/FeedbackService";
import { GitReviewService } from "../services/GitReviewService";
import { IntegrityService } from "../services/IntegrityService";
import { ExternalIntegrityService } from "../services/ExternalIntegrityService";
import { SubmissionReviewService } from "../services/SubmissionReviewService";
import { SubmissionFeedback } from "../types/Feedback";
import { Rubric } from "../types/Rubric";
import { ImportedSubmission } from "../types/Submission";
import { pathExists, readJson } from "../utils/fs";
import { EvidenceCryptoService } from "../services/EvidenceCryptoService";
import { submissionReviewHtml } from "./submissionReviewHtml";

export class SubmissionReviewPanel {
  private static current: SubmissionReviewPanel | undefined;

  static async show(
    submission: ImportedSubmission,
    storageRoot: string,
    extensionUri: vscode.Uri
  ): Promise<void> {
    if (this.current) {
      this.current.submission = submission;
      this.current.storageRoot = storageRoot;
      this.current.panel.reveal(vscode.ViewColumn.One);
      await this.current.refresh();
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      "learningActivityTeacherReview",
      "Submission Review",
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [extensionUri]
      }
    );
    this.current = new SubmissionReviewPanel(
      panel,
      submission,
      storageRoot,
      extensionUri
    );
    panel.onDidDispose(() => {
      this.current = undefined;
    });
    await this.current.refresh();
  }

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private submission: ImportedSubmission,
    private storageRoot: string,
    private readonly extensionUri: vscode.Uri,
    private readonly review = new SubmissionReviewService(),
    private readonly integrity = new IntegrityService(),
    private readonly externalIntegrity = new ExternalIntegrityService(),
    private readonly agencyMetrics = new AgencyMetricsService(),
    private readonly git = new GitReviewService(),
    private readonly feedback = new FeedbackService(),
    private readonly evidence = new EvidenceCryptoService()
  ) {
    panel.webview.onDidReceiveMessage((message) => this.handle(message));
  }

  private async refresh(): Promise<void> {
    const integrity: Record<string, unknown> = {};
    const externalIntegrity: Record<string, unknown> = {};
    const privateKey = await this.evidence.findPrivateKey(this.submission.metadataPath);
    for (const contribution of this.submission.contributions) {
      const target = path.join(
        this.submission.metadataPath,
        "contributions",
        contribution.studentId,
        "events.jsonl"
      );
      integrity[contribution.studentId] = this.integrity.verify(
        (await pathExists(target)) ? await fs.readFile(target, "utf8") : "",
        privateKey
      );
      externalIntegrity[contribution.studentId] = this.externalIntegrity.verify(
        contribution.events,
        this.submission.manifest
      );
    }
    const rubricPath = path.join(
      this.submission.metadataPath,
      "rubrics",
      "main.json"
    );
    const rubric = (await pathExists(rubricPath))
      ? await readJson<Rubric>(rubricPath)
      : undefined;
    const commits =
      this.submission.hasGit
        ? await this.git.commits(this.submission.projectPath).catch(() => [])
        : [];
    this.panel.webview.html = submissionReviewHtml(
      this.panel.webview,
      this.extensionUri,
      {
        submission: this.submission,
        rubric,
        summaries: this.submission.contributions.map((item) =>
          this.review.summarize(item)
        ),
        agencyMetrics: this.submission.contributions.map((item) =>
          this.agencyMetrics.calculate(item, this.submission.manifest)
        ),
        integrity,
        externalIntegrity,
        commits
      }
    );
  }

  private async handle(message: {
    type: string;
    commit?: string;
    feedback?: SubmissionFeedback;
    message?: string;
  }): Promise<void> {
    try {
      if (message.type === "commitFiles" && message.commit) {
        const files = await this.git.filesForCommit(
          this.submission.projectPath,
          message.commit
        );
        await this.panel.webview.postMessage({ type: "commitFiles", files });
      } else if (message.type === "saveFeedback" && message.feedback) {
        await this.feedback.save(this.storageRoot, message.feedback);
        void vscode.window.showInformationMessage("Feedback saved");
      } else if (message.type === "exportFeedback") {
        const destination = await vscode.window.showSaveDialog({
          filters: { "ZIP archive": ["zip"] },
          defaultUri: vscode.Uri.file(`${this.submission.id}-feedback.zip`)
        });
        if (destination) {
          await this.feedback.export(
            this.storageRoot,
            this.submission.id,
            destination.fsPath
          );
        }
      } else if (message.type === "error") {
        void vscode.window.showErrorMessage(message.message ?? "Invalid input");
      }
    } catch (error) {
      void vscode.window.showErrorMessage(
        error instanceof Error ? error.message : String(error)
      );
    }
  }
}
