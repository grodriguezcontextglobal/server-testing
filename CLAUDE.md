# CLAUDE.md

## Purpose

This file defines how Claude must work inside this repository.

The primary goals are:

1. Minimize unnecessary repository exploration.
2. Reduce Claude context and token consumption.
3. Use the existing Graphify knowledge graph before reading source files broadly.
4. Make small, scoped, evidence-based changes.
5. Preserve existing architecture and project conventions.
6. Validate changes before considering work complete.
7. Keep the knowledge graph synchronized with the codebase.

Claude must treat these rules as the default operating procedure for all development, debugging, refactoring, review, and architecture tasks in this repository.

---

# 1. Core Operating Principle

## Graph first. Source second. Broad exploration last.

When `graphify-out/graph.json` exists, Claude must use Graphify as the primary repository discovery mechanism.

Do not begin a task by recursively browsing directories, reading many files, running broad grep searches, or loading large architecture reports.

The expected workflow is:

```text
Task
  ↓
Graphify query
  ↓
Scoped relationships
  ↓
Minimal source inspection
  ↓
Plan
  ↓
Implementation
  ↓
Targeted validation
  ↓
Graphify update
```

The purpose of Graphify is to reduce the amount of repository content that must enter Claude's context.

---

# 2. Mandatory Task Phases

Claude must work through the following phases.

Not every phase requires a long written response. Small tasks should remain lightweight.

## Phase 0 — Task Classification

Before modifying code, determine the task type:

* bug fix
* feature
* refactor
* test
* code review
* architecture investigation
* performance issue
* security issue
* documentation
* configuration or infrastructure

Identify:

* requested outcome
* likely subsystem
* explicit constraints
* acceptance criteria
* whether code changes are actually required

Do not edit files merely because a task mentions a problem.

For debugging tasks, first establish the likely failure path.

---

## Phase 1 — Graph Discovery

When `graphify-out/graph.json` exists, start with a targeted Graphify query.

Examples:

```powershell
graphify query "Where is authentication handled and which modules depend on it?"
```

```powershell
graphify query "What code handles inventory bulk actions?"
```

```powershell
graphify query "Which controllers, services, and routes participate in device assignment?"
```

```powershell
graphify query "What files are related to the reported error?"
```

Questions should describe the actual engineering task, not merely a filename.

### Relationship analysis

When the task involves two known components, symbols, files, modules, or concepts:

```powershell
graphify path "<A>" "<B>"
```

Use this to understand:

* dependency paths
* call relationships
* cross-module coupling
* potential change propagation

### Focused concept analysis

For a known feature or domain concept:

```powershell
graphify explain "<concept>"
```

Use this before opening many source files.

### Rules

* Prefer one strong Graphify query over several vague queries.
* Refine the query only when the first result is insufficient.
* Do not repeatedly query the same concept with trivial wording changes.
* Reuse information already discovered during the current task.
* Do not run Graphify mechanically when the exact required file and change are already known and verified.

---

## Phase 2 — Minimal Source Inspection

After Graphify identifies the relevant area, inspect only the smallest useful set of source files.

Start with:

1. primary implementation file
2. direct caller or route
3. direct dependency when relevant
4. closest existing tests

Expand only when evidence requires it.

### Forbidden default behavior

Do not start with:

```text
read the entire repository
list every directory recursively
grep every occurrence of a broad term
read dozens of possibly related files
load all controllers
load all routes
load all tests
read the complete graph report
```

Do not use broad exploration as a substitute for reasoning.

### Evidence-driven expansion

Open another file only when at least one of these is true:

* Graphify identifies it as relevant.
* A currently inspected file imports or calls it.
* A failing test or stack trace points to it.
* The implementation cannot be understood without it.
* Validation indicates the change has broader impact.

---

## Phase 3 — Scoped Plan

Before a non-trivial modification, establish a concise implementation plan.

The plan should identify:

* root cause or working hypothesis
* files expected to change
* behavior expected to remain unchanged
* validation strategy

Keep the plan proportional to the task.

Do not produce long speculative plans for small fixes.

### Scope discipline

Prefer:

```text
2 files changed for a 2-file problem
```

over:

```text
8 files refactored because they looked related
```

Do not introduce unrelated cleanup.

Do not redesign architecture unless the task requires it.

Do not modify adjacent code solely for stylistic preference.

---

## Phase 4 — Implementation

Implement the smallest complete change that satisfies the task.

### Preserve existing project behavior

Before introducing a new pattern:

1. search for an existing local implementation
2. inspect nearby conventions
3. reuse existing utilities, hooks, services, schemas, or components when appropriate

Prefer consistency with the repository over generic textbook patterns.

### Change rules

* Keep diffs focused.
* Avoid unrelated formatting.
* Avoid opportunistic renames.
* Avoid speculative abstractions.
* Avoid new dependencies unless necessary.
* Do not silently change public contracts.
* Do not remove behavior without evidence that it is obsolete.
* Preserve backward compatibility unless breaking changes are explicitly requested.

### Refactoring

A refactor must have a concrete reason, such as:

* duplicated logic
* correctness risk
* maintainability problem directly affecting the task
* testability
* performance
* explicit user request

"Cleaner" alone is not sufficient justification for broad changes.

---

## Phase 5 — Validation

Never consider a code change complete solely because the edit was applied successfully.

Run the narrowest meaningful validation first.

Preferred order:

1. relevant focused tests
2. affected test file
3. package or module tests
4. type checking
5. linting
6. build
7. broader test suite when justified

Examples:

```powershell
pnpm test -- <relevant-test>
```

```powershell
pnpm test
```

```powershell
pnpm lint
```

```powershell
pnpm build
```

Use the commands defined by the repository rather than inventing project commands.

### Validation rules

* Do not claim a test passed unless it was run.
* Do not claim the build succeeds unless it was run.
* Clearly distinguish:

  * validated
  * not validated
  * blocked by environment
* When validation fails, determine whether failure is:

  * caused by the change
  * pre-existing
  * environment-related

Do not hide failing validation.

---

## Phase 6 — Graph Synchronization

After modifying code, run:

```powershell
graphify update .
```

This keeps the AST-based knowledge graph synchronized with the repository.

This step is required after code modifications when Graphify is configured and available.

Do not run repeated full graph updates during every small intermediate edit.

Run the update after the implementation has stabilized.

---

## Phase 7 — Completion Report

At completion, report only useful information.

Include:

* what changed
* why it changed
* validation performed
* any unresolved risk or blocker

Example:

```text
Implemented:
- Fixed inventory assignment validation in X.
- Reused the existing Y helper instead of duplicating logic.
- Added regression coverage for Z.

Validated:
- Relevant Vitest suite passed.
- Build passed.
- Graphify graph updated.

Remaining:
- None.
```

Do not provide a long diary of every command executed.

---

# 3. Graphify Usage Policy

This project has a knowledge graph under:

```text
graphify-out/
```

It may contain:

* graph data
* god nodes
* community structure
* cross-file relationships
* generated wiki navigation
* architecture reports

## Preferred discovery order

### Level 1 — Targeted query

```powershell
graphify query "<engineering question>"
```

Default starting point for codebase questions.

---

### Level 2 — Relationship path

```powershell
graphify path "<A>" "<B>"
```

Use when investigating how two known elements connect.

---

### Level 3 — Focused explanation

```powershell
graphify explain "<concept>"
```

Use for understanding a known subsystem, feature, or domain concept.

---

### Level 4 — Generated wiki

When available:

```text
graphify-out/wiki/index.md
```

Use it for broad navigation.

Prefer the wiki over manually browsing large parts of the source tree.

---

### Level 5 — Architecture report

Read:

```text
graphify-out/GRAPH_REPORT.md
```

only when:

* performing broad architecture review
* Graphify query/path/explain is insufficient
* investigating system-wide coupling
* explicitly requested

Do not load the complete report for routine feature work or small bug fixes.

---

### Level 6 — Raw repository exploration

Use broad grep, recursive browsing, or large-scale source inspection only when the previous levels fail to provide enough evidence.

This is the fallback, not the default.

---

# 4. Context and Quota Efficiency

Claude must actively minimize unnecessary context consumption.

## Do

* use targeted Graphify queries
* inspect small file sets
* reuse already gathered context
* summarize findings internally before expanding
* prefer exact symbol searches
* use failing stack traces as navigation evidence
* inspect nearby tests before searching globally
* stop exploring when enough evidence exists to act safely

## Do not

* repeatedly reread unchanged files
* repeatedly inspect the same Graphify output
* run equivalent searches with minor wording changes
* load large generated files without a concrete need
* read all tests to understand one feature
* read all routes to understand one endpoint
* read all controllers to modify one controller
* investigate unrelated code while implementing a scoped task
* spend context proving facts already established

### Context checkpoint

Before expanding exploration, ask:

```text
What specific unanswered question requires more repository context?
```

If no concrete unanswered question exists, do not continue exploring.

---

# 5. Debugging Protocol

For bug reports, use this order:

```text
Symptom
  ↓
Observed failure
  ↓
Likely execution path
  ↓
Graphify discovery
  ↓
Minimal source inspection
  ↓
Root-cause hypothesis
  ↓
Reproduction or evidence
  ↓
Smallest safe fix
  ↓
Regression validation
```

## Debugging rules

* Do not patch symptoms before understanding the likely cause.
* Do not assume the first suspicious line is the root cause.
* Follow actual data and control flow.
* Check boundaries:

  * client → API
  * route → controller
  * controller → service
  * service → database
  * state → rendering
* Preserve evidence from:

  * error messages
  * stack traces
  * request payloads
  * HTTP methods
  * failing assertions
  * database errors

When a working hypothesis is uncertain, say so and test it.

---

# 6. Code Review Protocol

For review tasks, prioritize:

1. correctness
2. regressions
3. security
4. data integrity
5. broken contracts
6. race conditions
7. error handling
8. performance risks
9. missing tests

Do not focus primarily on style.

Findings should include:

* severity
* exact location
* concrete failure mode
* why it matters
* suggested correction when useful

Do not invent hypothetical issues without a plausible execution path.

---

# 7. Testing Policy

When behavior changes, evaluate whether regression coverage is needed.

Prefer tests that validate externally observable behavior.

Do not create brittle tests that merely mirror implementation details.

For bug fixes:

```text
Bug exists
  ↓
Regression case represents bug
  ↓
Fix applied
  ↓
Regression case passes
```

When practical, confirm the test would fail without the fix.

---

# 8. Architecture Preservation

Before changing boundaries between modules, determine:

* current ownership of behavior
* incoming dependencies
* outgoing dependencies
* affected callers
* potential side effects

Use:

```powershell
graphify path "<A>" "<B>"
```

and:

```powershell
graphify query "<architecture relationship question>"
```

Do not infer architecture solely from directory names.

The knowledge graph is evidence, but source code remains the final authority.

---

# 9. Generated and Large Files

Avoid loading large generated artifacts into context unless necessary.

Examples include:

* lockfiles
* build output
* coverage output
* generated Graphify data
* large reports
* vendored code
* minified files

Do not read `node_modules` for routine application tasks.

When framework behavior must be verified, prefer the relevant local documentation or exact package implementation rather than broad dependency exploration.

---

# 10. Git Safety

Before destructive or history-altering Git operations, inspect repository state.

Never casually execute:

```powershell
git reset --hard
git clean -fd
git checkout -- .
git restore .
git rebase
git push --force
```

Do not discard user work.

Do not overwrite unrelated uncommitted changes.

When the working tree is dirty:

* distinguish existing changes from Claude's changes
* preserve unrelated modifications
* keep the task diff scoped

Do not create commits unless explicitly requested.

Do not push unless explicitly requested.

---

# 11. Dependency Policy

Before adding a dependency, verify:

1. the repository does not already provide the capability
2. a small local implementation is not more appropriate
3. the dependency is compatible with the current stack
4. the dependency is actually necessary

Do not add packages merely for convenience.

Use the package manager already configured by the repository.

---

# 12. Stop Conditions

Stop exploring and proceed when:

* the execution path is understood
* the relevant files are identified
* the root cause is sufficiently supported
* the implementation scope is clear
* validation can be defined

Stop modifying when:

* acceptance criteria are satisfied
* targeted validation passes
* no known task-related regression remains
* Graphify has been updated when applicable

Do not continue refactoring after the requested task is complete.

---

# 13. Decision Hierarchy

When instructions conflict, use this priority:

1. explicit user request
2. repository-specific requirements
3. safety and data preservation
4. this `CLAUDE.md`
5. established local code conventions
6. general engineering preferences

Never override an explicit user requirement merely because another pattern seems preferable.

---

# 14. Default Workflow Summary

For most non-trivial tasks:

```text
1. Understand the requested outcome.
2. Classify the task.
3. Run one targeted Graphify query.
4. Use path/explain only when needed.
5. Inspect the minimum relevant source files.
6. Establish a concise root-cause or implementation plan.
7. Make the smallest complete change.
8. Run targeted validation.
9. Expand validation only when justified.
10. Run `graphify update .`.
11. Report changes, validation, and remaining risks.
```

The repository must not be explored broadly by default.

The guiding principle is:

> Use the knowledge graph to decide what code deserves Claude's attention, then inspect and modify only what evidence requires.
