# C4 architecture model

This folder contains a Structurizr DSL workspace for the VSCode4Education C4
architecture model.

## Files

- [workspace.dsl](workspace.dsl): C4 model and views for Structurizr.

## Usage

Open `workspace.dsl` in Structurizr Lite, Structurizr Cloud, Structurizr On-Prem,
or the Structurizr CLI.

The model includes:

- system context view;
- container view for the full ecosystem;
- component views for the teacher extension, student extension, and Repository;
- dynamic views for the activity delivery and submission review flows;
- deployment view for the local development/runtime setup;
- styles and terminology.

The architectural focus is the portable file contract:

```text
teacher activity ZIP -> student workspace -> submission ZIP -> repository import
-> teacher review
```

Repository database rows, metrics, and summaries are modeled as derived data.
The source of truth remains the activity and submission artifacts.

