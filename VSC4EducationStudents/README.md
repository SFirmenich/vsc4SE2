# VSC4SE2 Student

VSC4SE2 Student helps students work with programming activities prepared by their
teacher directly in Visual Studio Code.

Use it to import an activity, review assigned tasks, track your local progress,
and export a final submission for review.

## Basic Use

1. Open Visual Studio Code.
2. Run `Learning Activity: Load Activity from ZIP` or `Learning Activity: Load Activity from URL`.
3. Select the activity provided by your teacher.
4. Register your student information when prompted.
5. Open `Learning Activity: Open Student Panel`.
6. Work through the assigned tasks.
7. When finished, run `Learning Activity: Export Submission` and submit the generated file as instructed by your teacher.

## Main Commands

- `Learning Activity: Load Activity from ZIP`
- `Learning Activity: Load Activity from URL`
- `Learning Activity: Open Student Panel`
- `Learning Activity: Register Student`
- `Learning Activity: Start Task`
- `Learning Activity: Finish Task`
- `Learning Activity: Export Submission`

## Recorded Information

The extension may record local activity progress, such as started and completed
tasks, file-change metadata, integrated terminal usage, and Git checkpoints when
enabled.

This information is included in the exported submission so the teacher can review
both the final work and the learning process.

## Privacy

The extension works with local project files. It does not access private
conversations from external AI tools. If an activity includes instructions for AI
assistants, those instructions are handled through local files in the project.

## Requirements

- A compatible version of Visual Studio Code.
- Git, when required by the activity configuration.
