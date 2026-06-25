import * as path from "path";
import { SubmissionFeedback } from "../types/Feedback";
import { readJson, writeJson } from "../utils/fs";
import { ZipService } from "./ZipService";

export class FeedbackService {
  constructor(private readonly zip = new ZipService()) {}

  feedbackPath(storageRoot: string, submissionId: string, studentId: string): string {
    return path.join(
      storageRoot,
      "reviews",
      submissionId,
      `${studentId}.feedback.json`
    );
  }

  async save(
    storageRoot: string,
    feedback: SubmissionFeedback
  ): Promise<string> {
    const target = this.feedbackPath(
      storageRoot,
      feedback.submissionId,
      feedback.studentId
    );
    await writeJson(target, { ...feedback, updatedAt: new Date().toISOString() });
    return target;
  }

  load(
    storageRoot: string,
    submissionId: string,
    studentId: string
  ): Promise<SubmissionFeedback> {
    return readJson<SubmissionFeedback>(
      this.feedbackPath(storageRoot, submissionId, studentId)
    );
  }

  async export(
    storageRoot: string,
    submissionId: string,
    destination: string
  ): Promise<void> {
    await this.zip.createFromDirectory(
      path.join(storageRoot, "reviews", submissionId),
      destination,
      new Set()
    );
  }
}
