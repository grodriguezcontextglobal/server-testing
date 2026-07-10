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

## Automatic Graphify selection. Source second. Broad exploration last.

When `graphify-out/graph.json` exists, Claude must use Graphify as the primary repository-discovery mechanism whenever repository discovery is required.

The user must not be required to:

* mention Graphify
* invoke `graphify query`
* provide Graphify keywords
* identify repository symbols
* select between `query`, `explain`, `path`, or `affected`

The user communicates the requested engineering outcome in natural language.

Claude automatically determines the correct Graphify command.

Use this decision hierarchy:

```text
Exact symbol explicitly known
→ graphify explain "<exact symbol>"

Exact file known but implementation symbol uncertain
→ graphify explain "<exact file>"
→ resolve the contained functional symbol when necessary

No exact symbol known
→ graphify query "<specific engineering question>" --budget 800
→ select concrete candidates
→ graphify explain "<candidate>"
→ verify resolution

Relationship between two known elements
→ graphify explain "<A>"
→ graphify explain "<B>"
→ graphify path "<A>" "<B>"

Change-impact question around a known symbol
→ graphify affected "<exact symbol>"

Weak or incomplete Graphify result
→ targeted exact-symbol filesystem verification
→ minimal source inspection
```

Do not begin with a broad query when an exact symbol is already known.

Do not begin with `path` until both endpoints have been resolved independently.

Do not modify code directly from query output.

The expected workflow is:

```text
Natural-language task
  ↓
Claude selects Graphify command automatically
  ↓
Exact symbol resolution
  ↓
Graph quality verification
  ↓
Minimal source inspection
  ↓
Scoped plan
  ↓
Implementation
  ↓
Targeted validation
  ↓
graphify update .
```

Graphify is a context-discovery mechanism.

Source code remains the final authority.

---

## Phase 1 — Automatic Graph Discovery

When repository discovery is necessary and `graphify-out/graph.json` exists, Claude must select the Graphify strategy automatically.

### Exact symbol provided

When the request identifies an exact function, controller, service, route handler, class, module, schema, file, or utility, begin with:

```powershell
graphify explain "<exact symbol>"
```

Examples:

```powershell
graphify explain "assignDevice"
graphify explain "retrievePackageList"
graphify explain "eventController"
```

Verify whether Graphify resolved:

* the intended file
* the intended function or class
* a similarly named but unrelated symbol

Do not treat file nodes and contained function nodes as interchangeable.

### No exact symbol provided

When the user describes a bug, feature, endpoint behavior, database operation, or business workflow without naming its implementation symbol, derive a scoped engineering question and run:

```powershell
graphify query "<specific engineering question>" --budget 800
```

Examples:

```powershell
graphify query "Which route, controller, and database operation handle deleting all records for a company?" --budget 800
```

```powershell
graphify query "Which modules validate device assignment before inventory is updated?" --budget 800
```

```powershell
graphify query "What handles request timeout behavior during large company deletion transactions?" --budget 800
```

Claude must create the query automatically from the user's natural-language task.

The user must not be asked to provide Graphify keywords.

### Mandatory query verification

A query result is a candidate-discovery result, not implementation proof.

After every query:

1. Identify the strongest concrete symbols.
2. Reject generic or unrelated high-degree nodes.
3. Run `graphify explain` for the selected symbols.
4. Verify the resolved path and symbol.
5. Use targeted source inspection to confirm runtime behavior.
6. Continue only after the implementation location is supported.

Do not edit directly from a query result.

### Relationship analysis

When two exact elements may interact:

```powershell
graphify explain "<A>"
graphify explain "<B>"
graphify path "<A>" "<B>"
```

Never start with `path` when either endpoint is unresolved.

An ambiguous path is non-conclusive.

A path through generic infrastructure such as:

* database clients
* shared middleware
* configuration modules
* generic utilities
* common response helpers
* logging modules

does not by itself establish direct runtime interaction.

### Impact analysis

When changing a known controller, service, utility, schema, or route handler, use when appropriate:

```powershell
graphify affected "<exact symbol>"
```

Use impact analysis automatically when the change could affect multiple callers or contracts.

### Query budget

Start with:

```text
800
```

Escalate only when necessary:

```text
800 → 1200 → 1500
```

Do not automatically use large query budgets.

### Graphify recovery

If Graphify returns:

* no useful result
* ambiguous matches
* unrelated symbols
* weak containment-only information
* a very large noisy subgraph

use this recovery order:

```text
narrower engineering query
→ exact candidate explain
→ targeted exact-symbol search
→ minimal source inspection
```

Do not repeatedly issue equivalent queries with minor wording changes.

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

## Native CLI rule

Always invoke Graphify directly:

```powershell
graphify explain "<symbol>"
graphify query "<question>" --budget 800
graphify path "<A>" "<B>"
graphify affected "<symbol>"
graphify update .
```

Never invoke Graphify through:

```text
npx
npm exec
pnpm exec
yarn
python -m
pipx run
```

Do not probe Graphify installation before first use.

Only investigate installation after a direct `graphify ...` command fails.

## Preferred automatic discovery order

### Level 1 — Exact symbol explanation

```powershell
graphify explain "<exact symbol>"
```

Use when an exact implementation symbol is already known.

### Level 2 — Scoped candidate discovery

```powershell
graphify query "<specific engineering question>" --budget 800
```

Use when the implementation symbol is unknown or multiple modules may participate.

Always validate returned candidates with `explain`.

### Level 3 — Resolved relationship path

```powershell
graphify explain "<A>"
graphify explain "<B>"
graphify path "<A>" "<B>"
```

Use only after both endpoints are known.

### Level 4 — Impact analysis

```powershell
graphify affected "<exact symbol>"
```

Use when evaluating change propagation.

### Level 5 — Generated wiki

Use:

```text
graphify-out/wiki/index.md
```

for broad repository navigation when focused commands are insufficient.

### Level 6 — Architecture report

Read:

```text
graphify-out/GRAPH_REPORT.md
```

only for repository-wide architectural analysis or when focused discovery remains insufficient.

### Level 7 — Raw repository exploration

Use broad grep or recursive source inspection only after Graphify and targeted filesystem verification fail.

---

# 14. Default Workflow Summary

For most non-trivial tasks:

```text
1. Understand the user's natural-language outcome.
2. Classify the task.
3. Determine whether an exact implementation symbol is known.
4. If known, run `graphify explain`.
5. If unknown, derive and run one scoped `graphify query --budget 800`.
6. Validate query candidates with `graphify explain`.
7. Resolve both endpoints before using `graphify path`.
8. Use `graphify affected` when change propagation matters.
9. Verify ambiguous or incomplete graph results with targeted search.
10. Inspect the minimum relevant source files.
11. Establish a concise root-cause or implementation plan.
12. Make the smallest complete change.
13. Run targeted validation.
14. Expand validation only when justified.
15. Run `graphify update .`.
16. Report changes, validation, and remaining risks.
```

The user must never need to invoke Graphify or provide Graphify keywords.

The guiding principle is:

> The user describes the desired engineering outcome. Claude automatically uses Graphify to decide which code deserves attention, verifies the result, and inspects only what the evidence requires.

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

<!-- ## Preferred discovery order

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

--- -->

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