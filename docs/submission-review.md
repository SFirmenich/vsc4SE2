# Submission review

Import a student ZIP with `Learning Activity Teacher: Import Student
Submission`. The command asks for an inspection folder, extracts the archive
into a uniquely named subfolder there, and adds the imported project to the
current VS Code workspace. ZIP entry count and uncompressed-size limits are
still enforced.

The review panel exposes student selection, task/event/file filters, timelines,
summary metrics, Git commits, changed files, agent interactions, integrity, the
rubric, and feedback. It never executes student code or installs dependencies.

Feedback is stored under `reviews/<submissionId>/`, outside the imported
project. Export produces a ZIP containing those review JSON files.

`VSC4EducationRepository` can import the same submission ZIPs to store the
original archives, associate them with courses and groups, and compare aggregate
metrics across students. That repository workflow complements teacher review;
it does not change the submission format and does not execute student code.

Repository also exposes a submission detail review view derived from the stored
original ZIP. It includes a principal summary, recorded agent conversations,
agency metrics, and event hash-chain integrity indicators. These views reuse the
portable submission evidence and remain review aids; they are not automatic
grades or tamper-proof authorship proofs.
