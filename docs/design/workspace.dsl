workspace "VSCode4Education" "C4 model for the VSCode4Education learning activity ecosystem." {

    !identifiers hierarchical

    model {
        teacher = person "Teacher" "Creates learning activities, publishes activity packages, reviews submissions, and gives feedback."
        student = person "Student" "Imports learning activities, works on tasks in VS Code, uses agents as learning support, and exports submissions."
        aiAgent = person "AI Agent" "External coding assistant such as Codex, ChatGPT, Claude, or Copilot. It reads generated instructions and may record interactions when it follows the contract." "External"

        vsc4education = softwareSystem "VSCode4Education" "Ecosystem for portable programming learning activities, student evidence capture, repository storage, and teacher review." {
            teacherExtension = container "Learning Activity Tracker - Teacher" "VS Code extension used by teachers to author, validate, export, import, and review learning activities and submissions." "TypeScript, VS Code Extension" {
                teacherPanel = component "Teacher Panel Webview" "Presents authoring, validation, export, import, review, rubric, and feedback workflows inside VS Code." "VS Code Webview, TypeScript"
                activityAuthoring = component "Activity Authoring Service" "Creates and updates manifest, tasks, theory, starter, agent instructions, assessment rubrics, solutions, and resources." "TypeScript"
                teacherValidator = component "Package Validation Service" "Validates manifest, task references, starter content, agent instructions, assessment material, unsafe paths, and export compatibility." "TypeScript"
                teacherPackager = component "Teacher Packaging Service" "Exports student activity ZIPs and teacher package ZIPs while preserving the portable file contract." "TypeScript"
                submissionImporter = component "Submission Import Service" "Extracts student submissions into a teacher-selected inspection folder without executing student code." "TypeScript"
                reviewService = component "Review And Evidence Service" "Reads submissions, timelines, Git data, hash chains, agent interactions, rubrics, and feedback." "TypeScript"
                feedbackStore = component "Feedback Store" "Stores teacher feedback outside imported submissions and exports review reports." "Files, JSON, Markdown"
            }

            studentExtension = container "Learning Activity Tracker - Student" "VS Code extension used by students to import activities, manage tasks, record evidence, protect agent instructions, and export submissions." "TypeScript, VS Code Extension" {
                studentPanel = component "Student Panel Webview" "Shows activity, task state, student identity, task actions, import, and export workflows." "VS Code Webview, TypeScript"
                activityImporter = component "Activity Import Service" "Imports activity ZIPs, validates the minimum contract, copies starter files, and preserves academic material under .vsc4education." "TypeScript"
                identityService = component "Identity And Contribution Service" "Registers the student and maintains isolated contribution data under .vsc4education/contributions/<studentId>." "TypeScript"
                taskStateService = component "Task State Service" "Tracks pending, active, and completed tasks by stable task id." "TypeScript"
                eventLogger = component "Event And Evidence Logger" "Records JSONL events, task metadata, heartbeats, and local hash-chain evidence." "TypeScript"
                gitService = component "Git Integration Service" "Initializes or reuses Git repositories and creates load, task, and submission checkpoints when available." "Git, TypeScript"
                agentInstructionService = component "Agent Instruction Service" "Generates and restores AGENTS.md and asks external agents to record interactions in agent-interactions.jsonl." "TypeScript, Markdown"
                submissionExporter = component "Submission Export Service" "Creates submission ZIPs containing project files, .vsc4education, contributions, and Git history when present." "TypeScript"
            }

            repositoryApp = container "VSCode4Education Repository" "Local Django, React, and Electron application for storing activity packages and submissions, extracting derived metadata, and comparing evidence across groups." "Django, React, Electron" {
                electronShell = component "Electron Shell" "Starts the local backend, hosts or loads the frontend, and provides the desktop application shell." "Electron"
                repositoryFrontend = component "Repository Frontend" "Local UI for courses, groups, activity imports, submission imports, review dashboards, metrics, and comparisons." "React, Vite"
                repositoryApi = component "Repository API" "REST API for importing ZIPs, serving catalog data, review views, metrics, and teacher integration endpoints." "Django REST Framework"
                activityImportService = component "Activity Import Service" "Validates archive safety, parses manifest.json, stores original activity ZIPs, and extracts activity/task metadata." "Python, Django"
                repositorySubmissionImportService = component "Submission Import Service" "Validates archive safety, imports submissions, matches activity id/version, stores original submission ZIPs, and extracts evidence summaries." "Python, Django"
                metricsService = component "Metrics And Comparison Service" "Computes derived event, task, Git, agent, warning, dashboard, and comparison metrics." "Python, Django"
                reviewApiService = component "Review Projection Service" "Builds teacher-style review projections from stored original ZIPs and derived summaries." "Python, Django"
            }

            fileContract = container "Portable Activity And Submission Contract" "Versioned file-based contract shared by all tools: activity ZIPs, .vsc4education workspaces, contribution directories, events, agent logs, assessment material, and submission ZIPs." "ZIP, JSON, JSONL, YAML, Markdown" "Data Store"

            repositoryDatabase = container "Repository Database" "Stores courses, groups, activities, activity versions, tasks, students, submissions, derived summaries, warnings, checksums, and metadata. This is derived from imported artifacts." "SQLite by default" "Data Store"
            repositoryMedia = container "Repository Media Store" "Stores original imported activity ZIPs and submission ZIPs as durable artifacts." "Local filesystem" "Data Store"
            teacherWorkspace = container "Teacher Workspace" "Activity authoring files, private assessment material, exported packages, imported submissions, and external feedback files." "Local filesystem" "Data Store"
            studentWorkspace = container "Student Workspace" "Student project files, .vsc4education academic material, per-student contributions, events, agent logs, task metadata, and optional Git history." "Local filesystem" "Data Store"
        }

        externalTools = softwareSystem "External Development And AI Tools" "Tools outside VSCode4Education used by teachers, students, and agents." "External" {
            vsCode = container "Visual Studio Code" "Hosts the teacher and student extensions." "Desktop application"
            git = container "Git" "Provides source history and checkpoints when available." "CLI"
            agentTools = container "Agent Tools" "External assistant tools that may read AGENTS.md and may append interactions if they follow instructions." "Codex, ChatGPT, Claude, Copilot"
        }

        teacher -> vsc4education.teacherExtension "Authors activities, validates packages, imports submissions, reviews evidence, and exports feedback"
        student -> vsc4education.studentExtension "Imports activities, works through tasks, records evidence, and exports submissions"
        teacher -> vsc4education.repositoryApp "Manages courses, imports artifacts, views dashboards, and compares submissions"
        aiAgent -> vsc4education.studentWorkspace "Reads AGENTS.md and may append agent-interactions.jsonl when instructed"
        aiAgent -> vsc4education.teacherWorkspace "May assist teacher-side review or authoring when explicitly used"

        externalTools.vsCode -> vsc4education.teacherExtension "Hosts"
        externalTools.vsCode -> vsc4education.studentExtension "Hosts"
        vsc4education.studentExtension -> externalTools.git "Creates checkpoints and reads repository state"
        vsc4education.teacherExtension -> externalTools.git "Reads submission history and diffs"
        externalTools.agentTools -> vsc4education.studentWorkspace "Reads instructions and writes interaction logs when compliant"

        vsc4education.teacherExtension -> vsc4education.teacherWorkspace "Reads and writes activity source files, assessment material, package exports, imported submissions, and feedback"
        vsc4education.teacherExtension -> vsc4education.fileContract "Produces activity ZIPs, teacher packages, and reads submission ZIPs"
        vsc4education.studentExtension -> vsc4education.fileContract "Consumes activity ZIPs and produces submission ZIPs"
        vsc4education.studentExtension -> vsc4education.studentWorkspace "Creates project files, preserves academic material, records contributions, and packages submissions"
        vsc4education.repositoryApp -> vsc4education.fileContract "Consumes activity ZIPs and submission ZIPs without replacing the portable contract"
        vsc4education.repositoryApp -> vsc4education.repositoryDatabase "Stores catalog records and derived summaries"
        vsc4education.repositoryApp -> vsc4education.repositoryMedia "Stores original imported ZIP artifacts"

        vsc4education.teacherExtension.teacherPanel -> vsc4education.teacherExtension.activityAuthoring "Invokes authoring actions"
        vsc4education.teacherExtension.teacherPanel -> vsc4education.teacherExtension.teacherValidator "Runs validation"
        vsc4education.teacherExtension.teacherPanel -> vsc4education.teacherExtension.teacherPackager "Exports packages"
        vsc4education.teacherExtension.teacherPanel -> vsc4education.teacherExtension.submissionImporter "Imports submissions"
        vsc4education.teacherExtension.teacherPanel -> vsc4education.teacherExtension.reviewService "Displays review data"
        vsc4education.teacherExtension.teacherPanel -> vsc4education.teacherExtension.feedbackStore "Saves and exports feedback"
        vsc4education.teacherExtension.activityAuthoring -> vsc4education.teacherWorkspace "Reads and writes authoring files"
        vsc4education.teacherExtension.teacherValidator -> vsc4education.teacherWorkspace "Validates activity source tree"
        vsc4education.teacherExtension.teacherPackager -> vsc4education.teacherWorkspace "Reads source files and writes ZIP packages"
        vsc4education.teacherExtension.teacherPackager -> vsc4education.fileContract "Creates compatible activity and teacher package artifacts"
        vsc4education.teacherExtension.submissionImporter -> vsc4education.fileContract "Reads submission ZIPs"
        vsc4education.teacherExtension.submissionImporter -> vsc4education.teacherWorkspace "Extracts submissions into inspection folders"
        vsc4education.teacherExtension.reviewService -> vsc4education.teacherWorkspace "Reads imported submissions and assessment material"
        vsc4education.teacherExtension.reviewService -> externalTools.git "Reads commits and diffs"
        vsc4education.teacherExtension.feedbackStore -> vsc4education.teacherWorkspace "Persists feedback outside imported submissions"

        vsc4education.studentExtension.studentPanel -> vsc4education.studentExtension.activityImporter "Imports activity ZIPs"
        vsc4education.studentExtension.studentPanel -> vsc4education.studentExtension.identityService "Registers student identity"
        vsc4education.studentExtension.studentPanel -> vsc4education.studentExtension.taskStateService "Starts and finishes tasks"
        vsc4education.studentExtension.studentPanel -> vsc4education.studentExtension.submissionExporter "Exports submissions"
        vsc4education.studentExtension.activityImporter -> vsc4education.fileContract "Reads activity ZIPs"
        vsc4education.studentExtension.activityImporter -> vsc4education.studentWorkspace "Copies starter files and .vsc4education academic material"
        vsc4education.studentExtension.identityService -> vsc4education.studentWorkspace "Creates and updates per-student contribution files"
        vsc4education.studentExtension.taskStateService -> vsc4education.studentWorkspace "Updates state.json, current-task.json, and task metadata"
        vsc4education.studentExtension.taskStateService -> vsc4education.studentExtension.eventLogger "Records task lifecycle events"
        vsc4education.studentExtension.eventLogger -> vsc4education.studentWorkspace "Appends JSONL events and metadata"
        vsc4education.studentExtension.gitService -> vsc4education.studentWorkspace "Initializes, reads, and commits local repository state"
        vsc4education.studentExtension.gitService -> externalTools.git "Runs Git commands"
        vsc4education.studentExtension.agentInstructionService -> vsc4education.studentWorkspace "Generates, restores, and preserves agent instructions"
        vsc4education.studentExtension.submissionExporter -> vsc4education.studentWorkspace "Reads project, .vsc4education, and optional .git"
        vsc4education.studentExtension.submissionExporter -> vsc4education.fileContract "Writes submission ZIPs"

        vsc4education.repositoryApp.electronShell -> vsc4education.repositoryApp.repositoryFrontend "Loads local UI"
        vsc4education.repositoryApp.electronShell -> vsc4education.repositoryApp.repositoryApi "Starts or connects to local backend"
        vsc4education.repositoryApp.repositoryFrontend -> vsc4education.repositoryApp.repositoryApi "Calls REST API"
        vsc4education.repositoryApp.repositoryApi -> vsc4education.repositoryApp.activityImportService "Imports activity ZIPs"
        vsc4education.repositoryApp.repositoryApi -> vsc4education.repositoryApp.repositorySubmissionImportService "Imports submission ZIPs"
        vsc4education.repositoryApp.repositoryApi -> vsc4education.repositoryApp.metricsService "Requests metrics and comparisons"
        vsc4education.repositoryApp.repositoryApi -> vsc4education.repositoryApp.reviewApiService "Requests review projections"
        vsc4education.repositoryApp.activityImportService -> vsc4education.fileContract "Reads activity ZIPs"
        vsc4education.repositoryApp.activityImportService -> vsc4education.repositoryMedia "Stores original activity ZIPs"
        vsc4education.repositoryApp.activityImportService -> vsc4education.repositoryDatabase "Stores activity metadata and warnings"
        vsc4education.repositoryApp.repositorySubmissionImportService -> vsc4education.fileContract "Reads submission ZIPs"
        vsc4education.repositoryApp.repositorySubmissionImportService -> vsc4education.repositoryMedia "Stores original submission ZIPs"
        vsc4education.repositoryApp.repositorySubmissionImportService -> vsc4education.repositoryDatabase "Stores student, task, event, Git, agent, warning, and checksum summaries"
        vsc4education.repositoryApp.metricsService -> vsc4education.repositoryDatabase "Reads derived summaries"
        vsc4education.repositoryApp.reviewApiService -> vsc4education.repositoryDatabase "Reads derived summaries"
        vsc4education.repositoryApp.reviewApiService -> vsc4education.repositoryMedia "Reads original submission ZIPs on demand"

        deploymentEnvironment "Local Development / Desktop Runtime" {
            deploymentNode "Teacher Machine" "Local workstation used by the teacher." "Windows, macOS, or Linux" {
                deploymentNode "VS Code - Teacher" "Visual Studio Code process." {
                    teacherExtensionInstance = containerInstance vsc4education.teacherExtension
                }
                deploymentNode "Repository Desktop App" "Electron desktop application." {
                    repositoryAppInstance = containerInstance vsc4education.repositoryApp
                }
                teacherWorkspaceInstance = containerInstance vsc4education.teacherWorkspace
                repositoryDatabaseInstance = containerInstance vsc4education.repositoryDatabase
                repositoryMediaInstance = containerInstance vsc4education.repositoryMedia
            }

            deploymentNode "Student Machine" "Local workstation used by the student." "Windows, macOS, or Linux" {
                deploymentNode "VS Code - Student" "Visual Studio Code process." {
                    studentExtensionInstance = containerInstance vsc4education.studentExtension
                }
                studentWorkspaceInstance = containerInstance vsc4education.studentWorkspace
                gitInstance = containerInstance externalTools.git
                agentToolsInstance = containerInstance externalTools.agentTools
            }
        }
    }

    views {
        systemContext vsc4education "SystemContext" {
            include *
            autoLayout lr
            title "VSCode4Education - System Context"
            description "People, external tools, and the VSCode4Education ecosystem."
        }

        container vsc4education "Containers" {
            include *
            autoLayout lr
            title "VSCode4Education - Containers"
            description "Main runtime containers and durable stores. ZIP artifacts are the shared source of truth."
        }

        component vsc4education.teacherExtension "TeacherExtensionComponents" {
            include *
            autoLayout lr
            title "Learning Activity Tracker - Teacher components"
            description "Authoring, packaging, submission import, review, and feedback components."
        }

        component vsc4education.studentExtension "StudentExtensionComponents" {
            include *
            autoLayout lr
            title "Learning Activity Tracker - Student components"
            description "Activity import, task workflow, evidence capture, agent instruction, Git, and submission export components."
        }

        component vsc4education.repositoryApp "RepositoryComponents" {
            include *
            autoLayout lr
            title "VSCode4Education Repository components"
            description "Desktop shell, frontend, API, import services, metrics, review projections, and storage."
        }

        dynamic vsc4education "ActivityDeliveryFlow" {
            title "Activity delivery flow"
            description "Teacher creates an activity ZIP, optionally imports it into Repository, and the student imports it into a workspace."
            teacher -> vsc4education.teacherExtension "Creates and validates activity"
            vsc4education.teacherExtension -> vsc4education.teacherWorkspace "Reads manifest, tasks, theory, starter, agent, assessment, and resources"
            vsc4education.teacherExtension -> vsc4education.fileContract "Exports activity ZIP"
            vsc4education.repositoryApp -> vsc4education.fileContract "Optionally imports activity ZIP"
            vsc4education.repositoryApp -> vsc4education.repositoryMedia "Stores original ZIP"
            vsc4education.repositoryApp -> vsc4education.repositoryDatabase "Stores derived activity metadata"
            student -> vsc4education.studentExtension "Imports activity ZIP"
            vsc4education.studentExtension -> vsc4education.fileContract "Reads activity package"
            vsc4education.studentExtension -> vsc4education.studentWorkspace "Copies starter and preserves academic material"
            autoLayout lr
        }

        dynamic vsc4education "SubmissionReviewFlow" {
            title "Submission export and review flow"
            description "Student exports a submission ZIP; Repository and Teacher consume the same portable artifact."
            student -> vsc4education.studentExtension "Works on tasks and exports submission"
            vsc4education.studentExtension -> vsc4education.studentWorkspace "Reads project, .vsc4education, contributions, events, logs, and optional Git"
            vsc4education.studentExtension -> vsc4education.fileContract "Writes submission ZIP"
            vsc4education.repositoryApp -> vsc4education.fileContract "Optionally imports submission ZIP"
            vsc4education.repositoryApp -> vsc4education.repositoryMedia "Stores original submission ZIP"
            vsc4education.repositoryApp -> vsc4education.repositoryDatabase "Stores derived summaries and warnings"
            teacher -> vsc4education.teacherExtension "Imports and reviews submission"
            vsc4education.teacherExtension -> vsc4education.fileContract "Reads submission ZIP"
            vsc4education.teacherExtension -> vsc4education.teacherWorkspace "Extracts inspection copy and saves feedback"
            autoLayout lr
        }

        deployment vsc4education "Local Development / Desktop Runtime" "LocalDevelopmentDeployment" {
            include *
            autoLayout lr
            title "VSCode4Education - Local deployment"
            description "Typical local runtime: VS Code extensions on teacher/student machines and Repository as a local desktop app."
        }

        styles {
            element "Person" {
                shape Person
                background #084c61
                color #ffffff
            }

            element "Software System" {
                background #177e89
                color #ffffff
            }

            element "Container" {
                background #2d728f
                color #ffffff
            }

            element "Component" {
                background #66a5ad
                color #000000
            }

            element "Data Store" {
                shape Cylinder
                background #f4d35e
                color #000000
            }

            element "External" {
                background #6c757d
                color #ffffff
            }

            relationship "Relationship" {
                color #555555
            }
        }

        theme default

        terminology {
            person "Actor"
            softwareSystem "Software system"
            container "Container"
            component "Component"
            deploymentNode "Deployment node"
        }
    }
}
