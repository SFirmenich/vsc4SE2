# Rubrics

The main rubric is stored at `rubrics/main.json`. Criteria support an ID,
title, description, weight, related task IDs, and ordered numeric levels.

Validation checks unique valid IDs, existing task references, non-negative
weights, a total weight of 100, and non-empty strictly increasing levels.
The 100-point total is currently a warning so authors can save incomplete
drafts, while structurally invalid criteria block activity export.
