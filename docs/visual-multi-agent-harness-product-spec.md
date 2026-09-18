# Visual Multi-Agent Harness

## Living Product Specification and Product Audit

**Status:** Living document  
**Version:** 0.3  
**Last updated:** September 18, 2026  
**Working title:** TBD. “Orbit” was used only as a temporary interface concept name.  
**Category:** Visual multi-agent planning, skill intelligence, orchestration, supervision, and integration harness for software work  

---

## 1. Executive summary

The product is a visual control plane for coding agents. A user connects a repository, supplies a broad software goal, and receives an editable, dependency-aware execution plan. The system determines what work exists before deciding how many agents are useful. It then selects or creates task-specific agent assignments, equips each assignment with the appropriate skills and tools, isolates the work, coordinates dependencies, streams understandable progress, verifies the outputs, and prepares the combined result for human review.

The product should answer, at a glance:

1. What work needs to happen?
2. Why was each task or agent created?
3. Why is this work being done in parallel, sequentially, or by one agent?
4. Which skills, instructions, models, tools, and permissions does each assignment have?
5. What is each agent doing now?
6. What is blocked, what caused the block, and what decision is needed?
7. How does each task affect the rest of the plan?
8. What changed in the repository?
9. What evidence proves the work is complete?
10. What will happen if the user approves, redirects, retries, or cancels something?
11. Which durable methodology is governing this session, which parts are active, and why?

The central product thesis is:

> **Agent execution is becoming widely available. Clear coordination, instruction quality, skill selection, impact visibility, and user comprehension remain unsolved.**

The product is therefore not primarily “a way to run several agents.” Its distinctive value is the intelligent and highly visual layer that decides how work should be structured, explains every important decision, equips agents correctly, shows dependencies and consequences, and prevents parallel work from becoming chaos.

### Recommended positioning

> **Turn one feature request into a safe, explainable agent plan—then watch every task, skill, dependency, and code change move together.**

Alternative shorter line:

> **See how your agents work together.**

Alternative category statement:

> **A visual operating system for planning, equipping, supervising, and integrating coding agents.**

The “visual operating system” language describes the long-term vision. The initial product should use the narrower “visual agent control plane” or “explainable multi-agent harness” description so the value remains concrete.

---

## 2. Honest product audit

### 2.1 Overall assessment

The underlying problem is strong. Developers can increasingly start many agents, but they still struggle to understand what should be delegated, what context each agent needs, whether two agents will conflict, whether the right skill was used, why an agent is blocked, and whether the combined result is trustworthy.

The market risk is also high. Parallel agent execution, worktrees, custom agent profiles, skills, task lists, unified session views, and visual status monitoring are rapidly becoming standard features. As of this research snapshot:

- OpenAI Codex promotes parallel agents, worktrees, skills, cloud environments, and agentic command-center workflows.
- Claude Code supports subagents, agent teams, skills, shared tasks, inter-agent communication, worktrees, and a new Projects experience for supervising multiple agents.
- VS Code positions itself as a home for multi-agent development with multiple providers, unified session visibility, skills, instructions, MCP tools, and agent plugins.
- Open-source orchestration interfaces already offer multi-provider teams, Kanban boards, live maps, cost analytics, detailed logs, permission modes, and diff review.

Therefore, “a clean dashboard where several agents run” is not enough by itself.

### 2.2 Strongest differentiated wedge

The most defensible product combination is:

1. **Instruction intelligence** — analyze `CLAUDE.md`, `AGENTS.md`, repository rules, agent definitions, skills, hooks, MCP configuration, tests, and deployment procedures.
2. **Skill architecture** — determine which instructions should remain global, become scoped rules, become reusable skills, be removed as duplicates, or be replaced by trusted existing skills.
3. **Methodology profiles** — save, compose, version, explain, and reuse a complete way of working across sessions without reducing it to one large prompt.
4. **Explainable planning** — show why every task exists, why a particular agent/profile/model was chosen, and why parallelization is or is not appropriate.
5. **Impact mapping** — show what each task consumes, produces, blocks, unblocks, and may break.
6. **Visual supervision** — let users understand the system through a living graph rather than through several disconnected terminal or chat windows.
7. **Reliable integration** — control file ownership, worktree isolation, merge order, verification, and repair loops.
8. **Run learning** — measure which methodologies, instructions, skills, decompositions, and agent configurations actually improve outcomes.

Each of these can exist separately elsewhere. The differentiated product is the way they work together.

### 2.3 Current scorecard

| Dimension | Current assessment | Why |
| --- | ---: | --- |
| Problem importance | 9/10 | Multi-agent coordination, context control, and trust are real and growing problems. |
| Visual product potential | 9/10 | Dependencies, activity, impact, and reusable capabilities are naturally visual. |
| Raw “multi-agent dashboard” differentiation | 4/10 | Major platforms and open-source products already cover much of this. |
| Differentiation with instruction and skill intelligence | 8.5/10 | Up-front assessment and explainable skill routing are substantially stronger. |
| Differentiation with methodology profiles | 8.5/10 | Versioned, portable, inspectable context composition is more valuable than basic prompt presets and connects the product's other systems. |
| Differentiation with impact mapping and run learning | 9/10 | This moves the product from monitoring to decision support. |
| MVP feasibility | 8/10 | A useful version can be built around one runtime and two to three agents. |
| Technical complexity at full vision | 9/10 | Reliable execution, cross-provider support, security, and integration are difficult. |
| Platform-copying risk | High | Providers can add dashboards and graphs. The moat must be deeper than presentation. |

### 2.4 What is and is not the moat

Easy to copy:

- Neon nodes
- A task graph
- Agent cards
- Live status indicators
- Multiple chat panels
- Token and cost charts
- A skill marketplace

Harder to copy:

- A high-quality instruction and skill compiler
- A versioned methodology compiler with explicit scope, precedence, enforcement strength, and session reproducibility
- A reliable decision policy for one agent versus subagent versus agent team
- Cross-provider task and event normalization
- Accurate pre-run and live impact analysis
- Skill provenance, trust, evaluation, and recommendation data
- Historical evidence about which skill/task/model configurations succeed
- A correction loop that learns from user changes to plans and assignments
- A visual language that consistently makes complex agent activity understandable

The visual design attracts and retains attention. The coordination intelligence and outcome data create defensibility.

---

## 3. Confirmed product decisions

The following decisions are treated as accepted unless this document is later revised:

1. The system is a harness around existing models and agent runtimes, not a new foundation model.
2. The system begins with repository and instruction assessment.
3. It can inspect a large `CLAUDE.md` or `AGENTS.md` and recommend what should remain global, become scoped, or become a skill.
4. It can recommend built-in, local, organizational, and trusted open-source skills.
5. It explains why every agent or assignment was created.
6. It shows what every agent is doing in user-understandable language.
7. It shows how each task affects other tasks and agents.
8. It uses a highly visual interaction model rather than a collection of undifferentiated chats.
9. Its visual direction is dark, spacious, breathable, and selectively lively.
10. Light blue, amber/orange-yellow, and purple-pink highlights identify stable capability categories.
11. Active agents and capabilities are visually highlighted; available but unused capabilities remain visible and subdued.
12. A graph or atlas view shows the full agent/skill system and usage patterns.
13. The system prevents or surfaces file conflicts before agents overwrite each other.
14. It uses isolated worktrees or equivalent execution environments for writing agents.
15. It includes a final integration and verification stage.
16. It shows auditable actions and evidence, not private chain-of-thought.
17. It recommends fewer agents when parallelism would add cost or risk without meaningful speed or quality benefits.
18. The core data model should remain provider-neutral even if the first version supports one runtime.
19. The first MVP is a private, single-user prototype for the product owner, not an installable or public release.
20. The initial prototype is local-first and optimized for rapid validation before distribution, collaboration, billing, or enterprise concerns.
21. Implementation guidance should define outcomes, invariants, interfaces, risks, and rationale without unnecessarily prescribing internal code structure or exact libraries.
22. The model or engineer building the product may choose or revise technical details when repository evidence or implementation learning supports a better approach, provided the product invariants and acceptance evidence remain intact.
23. Model and runtime integrations must enter through replaceable adapters. The first working integration may be specific, but provider assumptions must not become core domain logic.
24. Reusable templates should standardize important boundaries—task contracts, methodology manifests, events, runtime adapters, validation results, and UI states—without turning the codebase into a rigid generator framework.

---

## 4. Product vision and principles

### 4.1 Vision

Software teams should be able to supervise AI work with the same clarity they expect when coordinating skilled human collaborators. Users should not need to understand terminal multiplexers, agent configuration directories, context windows, or worktree commands to benefit from specialized parallel agents.

The product should make a complex run feel calm:

- The user can see the whole system.
- The user can understand why it has its current shape.
- The user can enter at any level of detail.
- The system surfaces only decisions that matter.
- Activity is visible without becoming noise.
- Risk is visible before damage occurs.
- Completion is supported by evidence.

### 4.2 Product principles

#### Tasks before agents

The planner must determine the necessary work before deciding how many agents to create. Fixed “CSS agent,” “backend agent,” and “database agent” personas may exist as reusable profiles, but the running assignments should be formed around concrete tasks.

#### Explain decisions, not hidden reasoning

The system should state observable reasons and evidence:

- “Created separately because these files do not overlap.”
- “Waiting for the exported pricing type.”
- “Selected the accessibility skill because the task adds an interactive dialog.”
- “Kept this work with one agent because all changes touch the same component.”

It should not expose or imply access to private model chain-of-thought.

#### Parallelism must earn its cost

Every additional agent adds context, coordination, review, and merge cost. The planner must be rewarded for correct topology, not maximum agent count.

#### Progressive disclosure

The first view should answer “what is happening?” Deeper views should progressively reveal instructions, skills, messages, logs, commands, diffs, and metrics.

#### Visual semantics must remain stable

Color, line style, opacity, size, and motion must each have a defined meaning. They must not change meaning between pages.

#### System state outranks agent self-report

Status should be calculated from events, subprocess state, dependencies, validations, file changes, and approvals. Agent messages may supplement state but should not be the only source of truth.

#### Human control is a feature

Approval, pause, redirect, retry, replace, re-scope, merge, and cancel actions must feel native rather than exceptional.

#### Safe defaults, visible consequences

The user should see what an approval enables and what downstream work it affects before taking the action.

#### Local-first where practical

Repository content, credentials, skills, and logs should remain local unless the selected runtime or user configuration requires otherwise. The UI must clearly identify when information crosses a provider boundary.

#### Guardrails, not prescriptions

The specification should be strict about user-visible behavior, safety boundaries, data integrity, and acceptance evidence. It should remain flexible about internal implementation details that a capable builder can judge from the actual repository and available runtime APIs.

Every substantial recommendation should communicate:

- the outcome it protects;
- the risk or failure mode behind it;
- whether it is a product invariant, a recommended default, or an open hypothesis;
- what evidence would justify a different implementation;
- how the alternative must be validated.

The implementation model should not be forced to follow arbitrary folder layouts, class names, library choices, or abstractions merely because they were imagined before coding began. It may deviate from a recommendation when it records the reason, preserves compatibility at the relevant boundary, and demonstrates the result through tests or observable behavior.

#### Stable contracts, flexible internals

Invest architectural effort in seams that are known to vary:

- runtime and model adapters;
- event normalization;
- methodology compilation;
- task and dependency state;
- permissions;
- validation;
- persistence;
- visual projections.

Keep the implementation behind those seams simple until real usage proves additional abstraction is necessary. Modularity should make likely changes inexpensive; it should not attempt to predict every future provider or feature.

---

## 5. Target users and jobs to be done

### 5.1 Initial target users

The first private prototype is built for the product owner as the sole active user. This is a validation strategy, not the final market definition: it allows the complete local workflow to be tested against real web repositories before onboarding, collaboration, packaging, billing, and generalized provider support are added.

#### AI-forward solo developers

They already use Claude Code, Codex, Cursor, or similar tools and are starting to manage multiple sessions manually. They want speed without losing understanding.

#### Technical builders from nontraditional backgrounds

They can describe products and judge outcomes but may not know how to design an agent topology, scope file ownership, or choose among skills and tools. Visual explanation is especially valuable for this group.

#### Small product and agency teams

They handle frontend, backend, integration, client feedback, and deployment across several projects. They need repeatable workflows, clear review gates, and cost control.

#### Technical product managers and engineering leads

They want to translate a feature goal into reviewable work, supervise progress, and understand risk without reading every transcript.

### 5.2 Later target users

- Larger engineering organizations with organizational skills and policies
- Platform teams managing approved agent configurations
- Compliance-heavy teams that need auditability
- Open-source maintainers coordinating issue and review agents
- Non-coding workflows once the coding harness is proven

### 5.3 Primary jobs to be done

When I submit a broad feature request, help me:

- understand the work required;
- see which parts can safely happen together;
- select the correct instructions, skills, tools, and agents;
- prevent overlapping or contradictory work;
- watch progress without reading raw logs;
- intervene at the right moment;
- verify that the result meets the intended goal;
- understand the cost and quality tradeoffs;
- improve how future work is planned.

### 5.4 User anxiety the product must remove

- “I do not know what the agents are actually doing.”
- “I do not know whether two agents are editing the same thing.”
- “I do not know why it created this many agents.”
- “I do not know whether the right context or skill was loaded.”
- “I do not know if a task is truly complete.”
- “I do not know whether I should interrupt it.”
- “I do not know what will break if I change this task.”
- “I do not know why the final merge failed.”
- “I do not know whether I am spending tokens on unnecessary coordination.”

---

## 6. Strategic product weights

These weights describe how much each pillar should influence roadmap and product decisions. They total 100.

| Product pillar | Weight | Rationale |
| --- | ---: | --- |
| Instruction, methodology, and skill intelligence | 20 | The best opportunity to add value before execution, preserve proven ways of working, and reduce context waste. |
| Explainable planning and coordination | 18 | Central to trust and the product’s distinctive promise. |
| Reliable orchestration and integration | 16 | The product fails if parallel work cannot be safely combined. |
| Visual interaction and comprehension | 15 | The principal experiential differentiator and reason the complexity becomes usable. |
| Safety, permissions, and reversibility | 12 | Necessary for real repository access and external actions. |
| Verification and quality evidence | 10 | Prevents “finished” from meaning only that an agent stopped. |
| Provider and runtime abstraction | 5 | Important strategically, but one adapter is enough for the MVP. |
| Learning, history, and analytics | 3 | Creates a future data advantage after reliable runs exist. |
| Marketplace and ecosystem | 1 | Valuable later; dangerous and distracting too early. |

### Weight interpretation

- A beautiful graph without reliable planning is a visualization demo.
- A reliable runner without visual explanation is another agent manager.
- A skill marketplace without trust and evaluation is a security liability.
- Cross-provider support without a unified data model creates a shallow launcher.
- Analytics without enough successful runs create decorative dashboards.

---

## 7. Competitive landscape and strategic response

### 7.1 Capabilities becoming baseline

| Capability | Market direction | Product response |
| --- | --- | --- |
| Parallel coding agents | Becoming standard | Do not position this alone as unique. |
| Worktree or branch isolation | Becoming expected | Treat it as required infrastructure. |
| Custom subagents and roles | Widely available | Improve assignment quality and explainability. |
| Skills and reusable instructions | Becoming an open ecosystem | Focus on assessment, trust, routing, and measurement. |
| Unified agent session views | Available in major developer tools | Differentiate through dependency and impact understanding. |
| Agent chats and logs | Commodity | Convert raw activity into concise evidence and status. |
| Token/cost analytics | Increasingly common | Connect cost to task value and planning decisions. |
| Diff review | Expected | Add cross-agent provenance and integration context. |

### 7.2 Platform encroachment

The largest strategic threat is that model providers add increasingly complete multi-agent project views. Claude Code’s Projects announcement on September 17, 2026 is especially important because it groups multiple coding sessions under shared goals and central coordination. This directly overlaps with the broadest version of this idea.

The response should not be to compete feature-for-feature with provider interfaces. The product should instead become the cross-provider intelligence and comprehension layer:

- normalize different runtimes;
- assess instructions and skills across ecosystems;
- show one consistent dependency and impact model;
- evaluate when each runtime or model should be used;
- preserve project knowledge independent of a provider;
- provide higher-quality visual planning and intervention.

### 7.3 Strategic implication

The initial product should be useful with one runtime but structurally independent of it. Provider-specific capabilities should enter through adapters, not leak into the core task, skill, event, and permission schemas.

---

## 8. End-to-end product workflow

### Stage 1: Connect and inspect

1. User opens or connects a repository.
2. System inventories the project structure, package managers, languages, frameworks, tests, CI, deployment configuration, and instruction files.
3. System discovers existing agent profiles, skills, MCP servers, hooks, plugins, and permission rules.
4. System creates a repository capability snapshot.

### Stage 2: Assess instructions and skills

1. System classifies every instruction by scope and type.
2. It detects duplication, conflicts, stale commands, ambiguous language, missing validation, and unnecessary global context.
3. It proposes what should remain global, become directory-scoped, become a skill, or be removed.
4. It suggests compatible built-in, local, organizational, or trusted third-party skills.
5. User previews and approves exact changes.

### Stage 3: Receive a goal

1. User enters a broad goal, issue, specification, or bug report.
2. System recommends one or more compatible methodology profiles and explains why each applies.
3. User confirms the methodology stack and can inspect its effective rules, preferences, skills, validators, tools, and context cost.
4. System identifies conflicts and missing decisions that materially affect architecture or scope.
5. It asks only necessary clarifying questions.
6. It pins the approved methodology versions and creates an initial task model.

### Stage 4: Plan the work

1. Planner decomposes the goal into deliverables.
2. It identifies dependencies, shared contracts, file scopes, validation requirements, and risk.
3. It decides which tasks are sequential and which are safely parallel.
4. It selects agent profiles, models, skills, tools, and permissions.
5. It estimates coordination cost and suggests the smallest useful team.
6. It explains the plan in the graph and in a concise written summary.

### Stage 5: Human plan review

The user can:

- approve the plan;
- change task boundaries;
- combine or split tasks;
- add or remove agents;
- change skills or models;
- limit files or permissions;
- add acceptance criteria;
- change budget or concurrency;
- require an approval checkpoint;
- save the topology as a reusable workflow.

### Stage 6: Execute

1. System creates isolated worktrees or environments.
2. Ready tasks begin according to the dependency graph and concurrency limit.
3. The run map updates from structured runtime events.
4. Agents receive task-specific context packs.
5. The system monitors scope, tools, commands, file changes, validation, and spend.
6. Blocked or risky work pauses and requests the smallest necessary decision.

### Stage 7: Coordinate and adapt

1. Outputs and contracts are handed to downstream tasks.
2. Unexpected dependencies are proposed as graph changes.
3. Failed validation triggers a bounded repair loop.
4. Users can message, pause, redirect, replace, or reassign an agent.
5. Material plan changes require approval and remain visible in history.

### Stage 8: Integrate and verify

1. Completed work is combined in dependency order.
2. The integration environment runs required validations.
3. A review agent checks scope, regressions, security baseline, and evidence.
4. The user receives a concise integration report and full diff access.
5. The user approves merge, requests repair, exports the work, or cancels.

### Stage 9: Learn

1. System records plan edits, skill activations, conflicts, failures, retries, cost, and outcomes.
2. It identifies reusable skills or instruction changes.
3. It recommends improvements for the next run.
4. It never silently changes critical repository instructions; recommendations remain reviewable.

---

## 9. Repository and instruction assessment

### 9.1 Assessment trigger

Run a complete assessment:

- when a repository is first connected;
- when the user explicitly requests it;
- after major changes to instruction, skill, agent, CI, or deployment files.

Run an incremental assessment:

- when a new task is submitted;
- when relevant files have changed;
- when a new skill, MCP server, or agent profile becomes available;
- when a prior run exposed an instruction failure.

Do not rescan the entire repository before every prompt. Store content hashes and rescan only affected inputs.

### 9.2 Sources to inspect

- `CLAUDE.md`
- `AGENTS.md`
- `README.md`
- Contributing and architecture documents
- Directory-scoped instruction files
- Agent definitions
- Skill directories and `SKILL.md` files
- MCP configuration
- Hooks and automation configuration
- Package manifests and lockfiles
- Test configuration
- CI/CD workflows
- Deployment configuration
- Database migrations and schema files
- Code owners and repository policy files
- Formatting, linting, and type-checking configuration
- Environment variable examples, never secret values

### 9.3 Instruction classification

Each instruction should be classified across these dimensions:

| Dimension | Examples |
| --- | --- |
| Scope | User, organization, repository, directory, language, task, lifecycle stage |
| Type | Fact, constraint, procedure, style rule, safety rule, validation rule, preference |
| Activation | Always, file match, task match, explicit invocation, approval-gated |
| Authority | User, organization, repository maintainer, third party |
| Freshness | Current, uncertain, stale, contradicted |
| Executability | Descriptive only, command, script, workflow |
| Risk | Read-only, repository write, command execution, network, secret, external side effect |

### 9.4 Recommended transformations

#### Keep global

Use for compact facts and constraints that apply to nearly every task:

- supported stack;
- repository layout conventions;
- non-negotiable safety rules;
- standard validation commands;
- architectural boundaries.

#### Make directory-scoped

Use when instructions apply to a particular package, application, language, or folder.

#### Extract into a skill

Use when the content describes a repeatable multi-step procedure, includes references or scripts, or applies only to certain task categories.

#### Convert into an agent profile

Use when instructions define a recurring specialist with a purpose, model preference, tool boundary, and permission profile.

#### Convert into a deterministic workflow or hook

Use when the procedure should always happen the same way, such as linting after edits or running a migration check before merge.

#### Remove or archive

Use for duplicates, stale setup commands, contradictory rules superseded by stronger authority, or instructions already enforced by tooling.

### 9.5 Assessment finding format

Every finding should show:

- source location;
- current instruction excerpt or summary;
- classification;
- detected problem or opportunity;
- proposed action;
- exact preview or diff;
- expected benefit;
- risk;
- confidence;
- whether user approval is required.

### 9.6 Conflict handling

The system should detect:

- two global instructions that contradict each other;
- global and directory instructions with unclear precedence;
- a skill that contradicts repository policy;
- two skills that claim the same task but prescribe different procedures;
- obsolete commands or file paths;
- instructions that require unavailable tools;
- a skill whose permission needs exceed the repository policy.

Do not silently choose among same-authority conflicts. Present the conflict and explain the consequences of each resolution.

---

## 10. Skill intelligence system

### 10.1 Skill sources

The product should distinguish:

1. **Runtime built-ins** — shipped by the selected agent product.
2. **Model or platform capabilities** — capabilities advertised by a provider but not represented as a portable skill package.
3. **User skills** — reusable personal skills across projects.
4. **Organization skills** — approved skills governed by a team.
5. **Repository skills** — version-controlled with one codebase.
6. **Generated skills** — proposed from recurring instructions or successful run patterns.
7. **Third-party skills** — open-source or commercial packages.

The UI must never present these sources as equally trusted.

### 10.2 Progressive disclosure

At planning time, load only compact skill metadata:

- name;
- description;
- source;
- version;
- risk tier;
- supported runtimes;
- activation conditions.

Load full instructions only after the skill is selected for a task. Load references, scripts, and assets only when the procedure needs them.

### 10.3 Skill recommendation score

A proposed scoring model:

| Factor | Weight |
| --- | ---: |
| Task relevance | 30% |
| Trust and provenance | 20% |
| Evidence of successful validation | 15% |
| Runtime and repository compatibility | 15% |
| Maintenance and freshness | 10% |
| Non-duplication with active skills | 5% |
| Estimated context and execution cost | 5% |

The score should be explainable. The user should be able to see why a lower-trust but highly relevant skill was not selected automatically.

### 10.4 Trust tiers

| Tier | Description | Default behavior |
| --- | --- | --- |
| A | Built-in or organization-approved | May be suggested and activated according to policy. |
| B | Repository-local and version-controlled | May be activated after repository trust is established. |
| C | Signed or reviewed third-party skill | Show provenance and request installation approval. |
| D | Unverified third-party skill | Inspect in sandbox; never auto-install or execute scripts. |
| Blocked | Known unsafe, incompatible, or policy-violating | Do not activate; explain why. |

### 10.5 Third-party skill review

Before installation, show:

- publisher and repository;
- version and commit/hash;
- license;
- last update;
- requested tools;
- network access;
- file access;
- scripts and executable content;
- dependencies;
- supported runtimes;
- known conflicts;
- evaluation history;
- exact files that will be added.

Skills are a supply-chain surface because they can include instructions, scripts, templates, and references. Treat installation like adding executable development tooling, not like adding a harmless prompt.

### 10.6 Skill lifecycle

1. Discover
2. Inspect
3. Compare
4. Approve
5. Pin version
6. Activate for a task
7. Observe usage
8. Evaluate contribution
9. Revise or replace
10. Retire

### 10.7 Skill effectiveness

The product should eventually measure:

- activation precision;
- whether the skill’s required validations ran;
- task completion rate with and without the skill;
- correction and retry rate;
- context cost;
- user acceptance or removal;
- regressions attributable to the skill;
- runtime compatibility failures.

Avoid claiming causal improvement from a small number of runs. Report evidence and confidence.

---

## 10A. Methodology profiles and reusable ways of working

### 10A.1 Product judgment

This is a core product layer, not a secondary prompt-library feature. Users should be able to save and title a complete methodology such as:

- “Luxury Editorial Website”
- “Product MVP — Scope First”
- “Production TypeScript — Minimal Diffs”
- “Investor-Facing Real Estate Site”
- “Security-Sensitive Deployment”

A methodology represents how a category of work should be approached. It can combine prompt-handling behavior, hard rules, soft preferences or “vibes,” relevant skills, tool and permission policy, output expectations, and validation requirements. It should then be easy to select, inspect, apply to a new session, update, compare, or fork.

The dangerous implementation is a saved mega-prompt. That approach is initially simple but becomes opaque, repetitive, difficult to merge, expensive in context, and weak for advanced users. The recommended implementation is a **versioned methodology manifest** that references independently managed components and compiles the smallest effective context for the current task.

Recommended naming:

- User-facing object: **Methodology** or **Working Method**
- Internal architecture: **Methodology Manifest** and **Context Compiler**
- Avoid using “prompt preset” as the main category; it understates the system and encourages unstructured text blobs.

### 10A.2 What a methodology contains

| Component | Purpose | Example | Default behavior |
| --- | --- | --- | --- |
| Identity | Makes the method understandable and reusable | Title, description, owner, tags, version | Always visible |
| Purpose and applicability | Defines when it should be recommended | Website, product discovery, production coding, deployment | Evaluated before session start |
| Prompt-handling policy | Defines how the system should interpret and clarify requests | Ask for audience and conversion goal before designing | Runs during intake and planning |
| Hard rules | Defines requirements that must not be violated | Never deploy without approval; no horizontal overflow at 320px | Enforce deterministically where possible |
| Soft principles | Guides judgment without pretending to be mandatory | Prefer minimal diffs; explain important tradeoffs | May yield to explicit task needs |
| Vibe | Captures aesthetic, tonal, and experiential intent | Dark, spacious, editorial, restrained neon | Used by relevant creative tasks only |
| Skill references | Attaches versioned procedures without duplicating them | Accessibility review, responsive design, release checklist | Loaded only when activated |
| Agent and model policy | Defines preferred worker capabilities | Strong reasoning for architecture; fast model for mechanical checks | Applied during assignment |
| Tool and permission policy | Defines allowed or gated actions | Browser allowed; production writes require approval | Enforced by the permission engine |
| Output contract | Defines expected deliverables and format | Implementation, test evidence, decision log | Added to task contracts |
| Validators | Defines objective completion evidence | Typecheck, unit tests, screenshots at 320/768/1440 | Required before completion |
| Examples and anti-examples | Clarifies ambiguous concepts such as “premium” or “minimal” | Approved reference and a rejected visual treatment | Loaded only for relevant tasks |
| Provenance | Explains where each component came from | User-authored, repository-derived, organization-approved | Always inspectable |

### 10A.3 Rule classes must remain distinct

The product must not treat every sentence as equivalent context.

1. **Hard rules** are non-negotiable constraints. Each rule must display its enforcement strength: prompt-only, schema-checked, hook-enforced, permission-enforced, test-enforced, or externally enforced. The UI must never label a prompt-only instruction as guaranteed.
2. **Skills** are repeatable procedures. They should remain separate, versioned packages and load only when a task needs them.
3. **Prompt-handling policies** govern intake and decision behavior: when to clarify, when to state assumptions, when to propose a plan, and which decisions require approval.
4. **Vibes and preferences** shape tone, interaction, design, or code style. They are intentionally soft, lower-precedence, and overridable.
5. **Project facts** describe the current system. They belong in project memory or repository instructions, not inside a generic methodology unless referenced.
6. **Validators** prove that a result satisfies the method. They are not merely reminders.

This distinction is essential because natural-language instructions influence a model but do not create deterministic enforcement. Requirements with real safety or quality consequences should be backed by permissions, hooks, schemas, tests, or CI whenever possible.

### 10A.4 Composition and precedence

A session may combine multiple compatible methodologies. Example:

1. Organization security baseline
2. User working preferences
3. Project or repository instructions
4. “Product MVP — Scope First” methodology
5. “Luxury Editorial Website” methodology
6. Task-specific contract
7. Skills activated on demand

The compiler must:

- apply a documented, deterministic precedence order;
- preserve provenance for every effective instruction;
- reject incompatible hard rules rather than resolving them silently;
- distinguish an override from an accidental conflict;
- deduplicate semantically equivalent content;
- calculate the expected context cost;
- show which components are active, dormant, overridden, or blocked;
- produce an inspectable effective-context preview before launch.

Composition should support limited inheritance or `extends`, but avoid deep inheritance trees. Prefer a small stack of legible layers over an object-oriented configuration maze.

### 10A.5 Session-start experience

The ideal flow is:

1. User enters a goal.
2. System recommends zero to three methodologies based on task type, project, prior use, and compatibility.
3. Each recommendation says why it applies, what it adds, what it can enforce, and its estimated context cost.
4. User accepts, removes, or edits the stack.
5. A preflight view shows conflicts, applicable skills, permission gates, validators, and the compiled context summary.
6. The session launches pinned to exact methodology and skill versions.

The default view should feel simple: titled cards, compact descriptions, colored category chips, and one clear “Use for this session” action. The advanced view should expose the manifest, precedence trace, diff, and generated effective context.

### 10A.6 Visual model

Represent a selected methodology as a central node connected to its rules, skills, validators, agent policies, and aesthetic preferences. Only currently active components glow; available but inactive components remain dim. Selecting any component explains:

- why it is present;
- which methodology contributed it;
- which tasks or agents consume it;
- whether it is advisory or enforced;
- what would change if it were removed;
- whether it conflicts with another layer.

This can become a dedicated **Context Stack** view and a filtered layer in the broader Agent and Skill Atlas. The graph should support comprehension and impact analysis rather than becoming a decorative constellation.

### 10A.7 Updating, versioning, and propagation

Methodologies require document-like lifecycle controls:

- draft, review, publish, deprecate, and archive states;
- semantic or sequential versions;
- human-readable diffs;
- rollback and fork;
- owner and approval policy;
- changelog and provenance;
- compatibility declarations for runtimes and projects.

An active session must remain pinned to the version with which it began. If a methodology changes, show “new version available” and offer explicit choices:

- apply on the next turn;
- restart or fork the session with the new version;
- keep the current version;
- make the new version the default only for future sessions.

Never silently mutate an active session. Never apply one update to all existing sessions without an explicit, scoped approval.

The system may propose an update after repeated corrections—for example, “You removed animated gradients in four website runs; add ‘avoid decorative motion’ to this methodology?” Proposed learning remains a draft until approved and should include supporting evidence.

### 10A.8 Advanced-user requirements

The feature is highly valuable to advanced users only if it offers more than convenience. Advanced users need:

- config-as-code representation in YAML or JSON;
- API and CLI access;
- Git synchronization or export;
- composition with explicit precedence;
- exact version pinning and reproducible sessions;
- deterministic enforcement options;
- portability adapters for `AGENTS.md`, `CLAUDE.md`, scoped rule files, and `SKILL.md` packages;
- compiled-context inspection;
- evaluation suites and outcome analytics;
- organization ownership, approvals, signing, and audit history;
- no lock-in to one model provider or runtime.

Without these capabilities, advanced users will treat the feature as a beginner-oriented prompt organizer and continue using repository files, dotfiles, scripts, and CI directly.

### 10A.9 Complexity and value audit

| Implementation level | Build complexity | Broad-user value | Advanced-user value | Assessment |
| --- | ---: | ---: | ---: | --- |
| Saved text prompt with a title | 2/10 | 5/10 | 3/10 | Useful prototype, weak product layer |
| Structured reusable methodology | 5/10 | 8/10 | 7/10 | Strong early feature |
| Composable, versioned methodology compiler | 8/10 | 9/10 | 9.5/10 | Recommended long-term core |
| Cross-provider export, policy enforcement, and evaluations | 9/10 | 8/10 | 10/10 | Powerful moat, later phases |

Overall judgment:

- Product importance: **9/10**
- Differentiation potential: **8.5/10**
- MVP complexity: **6/10**
- Full-system complexity: **8.5/10**
- Advanced-user value if implemented correctly: **9.5/10**

The feature's greatest strategic value is that it connects instruction assessment, skill selection, planning, permissions, verification, memory, and analytics into one coherent object.

### 10A.10 MVP boundary

The first version should support:

1. Create, clone, title, describe, tag, and archive a methodology.
2. Structured sections for purpose, prompt handling, hard rules, preferences/vibe, skill references, and validators.
3. Global, user, project, and task-category scope.
4. Select or accept a recommended methodology when starting a session.
5. Combine at most three profiles with a fixed precedence model.
6. Preview effective context, enforcement strength, conflicts, and estimated context cost.
7. Pin a session to an immutable version.
8. Update through draft, diff, publish, and rollback.
9. Import from and export to one runtime's native instruction format.

Defer automatic methodology generation, deep inheritance, broad cross-provider translation, organization-wide rollout, and causal performance claims until the simpler lifecycle is reliable.

### 10A.11 Example manifest

```yaml
id: website.luxury-editorial
title: Luxury Editorial Website
version: 3
scope: website
extends:
  - product.scope-first@2
applies_when:
  - task.type in [landing-page, marketing-site]
prompt_policy:
  clarify_when: [audience, conversion_goal, required_pages]
hard_rules:
  - id: mobile-overflow
    requirement: "No horizontal overflow at 320px"
    enforcement: visual-test
preferences:
  visual_tone: "dark, spacious, editorial, restrained neon"
skills:
  - responsive-design@2
  - accessibility-review@1
validators:
  - "npm run typecheck"
  - browser_widths: [320, 768, 1440]
```

The manifest is the source of composition and provenance. The generated prompt or runtime configuration is a disposable compiled output, not the canonical object.

---

## 11. Planning and task decomposition

### 11.1 Planner responsibilities

The planner should:

- understand the user goal;
- identify deliverables and acceptance criteria;
- inspect relevant architecture;
- identify shared contracts first;
- identify tasks that can be isolated;
- estimate file and interface ownership;
- map dependencies;
- identify risky actions;
- select skills and tools;
- recommend execution topology;
- estimate cost and duration ranges;
- expose uncertainty;
- present alternatives when architecture choices matter.

### 11.2 Topology choices

#### Single agent

Prefer when:

- the task is sequential;
- most changes touch the same files;
- the task is small;
- coordination cost exceeds expected savings;
- one coherent context is important.

#### Subagent

Prefer when:

- a focused research, review, or log-heavy side task would pollute the main context;
- only the result needs to return;
- the subtask has narrow permissions;
- communication with other workers is unnecessary.

#### Agent team

Prefer when:

- tasks are meaningfully independent;
- agents must exchange findings or challenge each other;
- cross-layer work has stable contracts;
- parallel execution materially improves time or quality.

#### Deterministic workflow

Prefer when:

- steps and conditions are known;
- repeatability is more important than model discretion;
- the process is a standard validation, release, or maintenance routine.

### 11.3 Agent-count decision

The planner should explicitly balance:

- parallel time saved;
- boundary clarity;
- shared-file risk;
- interface stability;
- context duplication;
- communication overhead;
- merge complexity;
- review burden;
- budget;
- model/rate limits.

Every plan should include a concise statement such as:

> “Three agents are recommended. Frontend and backend can proceed independently after the shared type contract is finalized. Testing remains blocked until both complete. Additional agents would not reduce the critical path.”

The system should also visibly explain when it declines to create more agents.

### 11.4 Task contract

Each executable task should include:

- stable task ID;
- title;
- objective;
- why it exists;
- deliverable;
- acceptance criteria;
- assigned agent profile;
- selected model/runtime;
- skills;
- tools and MCP servers;
- permission scope;
- allowed files or directories;
- prohibited files or actions;
- dependencies;
- inputs consumed;
- outputs produced;
- downstream tasks affected;
- validation commands;
- expected evidence;
- risk tier;
- uncertainty and assumptions;
- estimated effort/cost range;
- checkpoint or approval requirements;
- recovery behavior.

### 11.5 Example structured plan

```json
{
  "task": {
    "id": "checkout-ui",
    "objective": "Build the responsive checkout summary",
    "why": "The UI can proceed independently once pricing types are stable",
    "agentProfile": "frontend-implementation",
    "runtime": "selected-runtime-adapter",
    "skills": [
      "react-component-development",
      "responsive-design",
      "accessibility-review"
    ],
    "allowedFiles": [
      "src/components/checkout/**",
      "tests/checkout/**"
    ],
    "dependsOn": ["pricing-contract"],
    "produces": ["checkout-summary-component", "ui-test-evidence"],
    "unblocks": ["checkout-integration-test"],
    "acceptanceCriteria": [
      "No horizontal overflow at 320px",
      "Keyboard navigation completes the flow",
      "Displayed totals match the pricing contract"
    ],
    "validation": [
      "npm run test -- checkout",
      "npm run typecheck"
    ],
    "permissionProfile": "repo-write-scoped-no-network",
    "risk": "medium"
  }
}
```

### 11.6 Plan editing

The visual plan must be editable without forcing users to edit JSON:

- drag a dependency;
- combine tasks;
- split a task;
- change an agent profile;
- remove a skill;
- add a validation check;
- change file scope;
- lower concurrency;
- add an approval gate;
- mark a decision as unresolved.

Every edit should update downstream effects and cost estimates before execution.

---

## 12. Agent model

### 12.1 Important distinctions

The product must clearly distinguish:

- **Model:** The underlying language or coding model.
- **Runtime:** The harness that executes an agent session, such as a coding CLI, SDK, or cloud runner.
- **Agent profile:** A reusable configuration describing a type of work.
- **Agent instance:** One running worker created for a specific assignment.
- **Task:** The durable unit of work.
- **Skill:** A reusable procedure or knowledge package loaded when relevant.
- **Tool:** A callable capability such as filesystem, browser, test runner, or MCP function.
- **Workflow:** A deterministic or semi-deterministic sequence of steps.

The interface should never use “agent” as an ambiguous label for all of these.

### 12.2 Agent profile fields

- name;
- purpose;
- matching description;
- preferred task categories;
- default model policy;
- tool allowlist;
- skill bundle;
- permission baseline;
- context policy;
- memory policy;
- validation expectations;
- concurrency rules;
- escalation behavior;
- supported runtimes.

### 12.3 Dynamic assignments over rigid departments

Avoid making “CSS,” “backend,” and “database” permanent workers that receive every related task. Preserve those as discoverable capability profiles, then create task-specific assignments such as:

- Checkout interaction design
- Pricing contract implementation
- Migration safety review
- Browser regression verification
- Integration review

This makes the reason, scope, and completion state concrete.

---

## 13. Visual interaction model

### 13.1 Visual north star

The interface should feel like an intelligent command center that remains calm under activity. The reference qualities are:

- deep navy rather than pure black;
- generous negative space;
- restrained, luminous highlights;
- constellation or scatterplot structures;
- thin, low-contrast connections;
- concentrated detail in inspectable panels;
- a small number of clear actions;
- subtle liveliness rather than constant animation;
- dense technical information placed inside breathable composition.

### 13.2 Altitude reference audit

The supplied Altitude landing-page screenshot demonstrates several useful patterns:

- A nearly monochromatic dark canvas allows a small amber highlight to carry strong emphasis.
- The central knowledge graph feels alive because points vary in brightness and size while most of the field remains quiet.
- Connections recede into the background instead of competing with labels.
- A selected node can reveal a denser inspector without making the entire view dense.
- Embedded product panels use borders, shadows, and surface shifts rather than heavy decoration.
- Large vertical gaps give each complex visualization room to breathe.
- The page alternates between sparse explanation and focused product detail.
- CTAs are obvious because accent color is used selectively.

Patterns to adapt:

- Knowledge graph → agent and skill atlas
- Journey visualization → execution path and dependency timeline
- Selected-node inspector → agent/task detail panel
- Amber active points → current activity, approvals, or key handoffs
- Sparse constellation → full capability inventory with dormant nodes subdued

Patterns not to copy directly:

- The marketing-page sequence and content hierarchy
- Very small explanatory text
- Using only one accent color when the product needs stable category semantics
- Decorative graph motion that does not reflect real system state
- Excessively faint contrast that harms accessibility

### 13.3 Proposed color semantics

The exact palette remains subject to visual prototyping. Initial semantic direction:

| Color family | Primary meaning | Example uses |
| --- | --- | --- |
| Light blue/cyan | Experience and interface work | UI, CSS, frontend, design-system skills |
| Amber/orange-yellow | Systems and implementation | Backend, API, infrastructure, active approval action |
| Purple/pink | Assurance and analysis | Testing, review, security, research |
| Green | Successful system state | Completed validation, healthy integration |
| Red/coral | Failure or destructive risk | Failed checks, permission denial, conflict |
| Neutral gray/navy | Structure and inactive state | Dormant agents, graph edges, background panels |

Category color and status color must be separate. A frontend task remains blue whether it is running or blocked; status is conveyed through icon, border/halo pattern, label, and motion.

### 13.4 Indicative dark-theme tokens

These are starting points, not final brand values:

- Canvas: `#0B101A`
- Primary panel: `#111827`
- Elevated panel: `#172033`
- Fine border: `#263247`
- Primary text: `#F2F5FA`
- Secondary text: `#9BA8BA`
- Cyan: `#61C8FF`
- Amber: `#F4B866`
- Purple-pink: `#D879F4`
- Green: `#58D3A4`
- Coral: `#FF7484`

Large surfaces should remain neutral. Category colors should appear in nodes, glows, small rails, icons, selected accents, activity trails, and charts rather than saturating entire chat windows.

### 13.5 Breathability rules

- Use large outer margins and clear section separation.
- Keep the primary canvas sparse.
- Put dense logs and metadata behind selection or drill-down.
- Avoid dashboard walls of equal-sized metric cards.
- Keep one dominant visual per page.
- Let the selected node own the inspector; do not open several inspectors simultaneously.
- Prefer short labels directly on nodes and full descriptions in the detail panel.
- Use whitespace to separate phases rather than surrounding every item with a box.
- Avoid permanent toolbars when contextual actions are sufficient.

### 13.6 Motion rules

Motion should convey state changes:

- a restrained halo for active work;
- a single traveling pulse when an artifact is handed downstream;
- a gentle connection highlight when a dependency becomes ready;
- a short expansion when a node is selected;
- a soft settling transition when the plan rearranges;
- no looping motion for completed or dormant work;
- no constant particle field unrelated to activity;
- full support for reduced-motion preferences.

Recommended transitions should generally remain between 150 and 300 milliseconds. Slow “breathing” may be used for current activity, but only on a small number of active nodes.

### 13.7 Visual encoding rules

| Property | Meaning |
| --- | --- |
| Position | Capability cluster or dependency layout |
| Color | Stable task/capability category |
| Halo | Currently active |
| Opacity | Dormant or unavailable |
| Dashed outer ring | Recommended but not active/installed |
| Solid outer ring | Selected |
| Size in atlas | One selected historical metric only |
| Edge direction | Dependency or artifact flow |
| Edge animation | A real current handoff |
| Warning icon | Risk or required decision |

Never encode several unrelated metrics into node size. If the atlas supports “runs,” “cost,” or “success rate,” the user should choose one metric and see the current choice clearly.

### 13.8 Accessibility

- Never rely on color alone.
- Maintain readable contrast for text and edges.
- Every node must be keyboard accessible.
- Graph information must have a list/table alternative.
- Selected, active, blocked, and recommended states require text or icon reinforcement.
- Hover-only information is prohibited for essential content.
- Motion can be reduced or disabled.
- Screen-reader labels should describe name, category, status, dependencies, and current action.

### 13.9 Agent conversation surfaces

The user should be able to speak to the coordinator or directly to one assignment, but the product should not become a wall of simultaneous chat windows.

- The coordinator conversation remains visually neutral because it spans all categories.
- An individual agent conversation receives a restrained category treatment: a colored top rail, selected-node glow, avatar/accent, and a very low-opacity surface tint.
- A frontend/CSS assignment may therefore feel light blue without placing all messages on a saturated blue background.
- Backend/system conversations use amber accents; testing/review conversations use purple-pink accents.
- Status remains separate from category color. A blocked blue frontend agent receives a warning icon and blocked label rather than changing its category color to amber.
- The conversation header always shows task, agent profile, active skills, scope, and current state.
- User messages that change scope, dependencies, or permissions must become structured plan events rather than remaining only in chat history.
- Switching between agents should preserve the selected task and graph position so the user never loses system context.
- The default view shows the structured activity summary. Full transcripts are a deeper inspection layer.

---

## 14. Information architecture

### 14.1 Primary navigation

Recommended top-level areas:

1. **Current run**
2. **Plan**
3. **Skills and instructions**
4. **Agents**
5. **Review**
6. **History**
7. **Project settings**

The MVP may combine Plan and Current Run, and combine Agents with Skills.

### 14.2 Repository intake

Show:

- repository identity and branch;
- detected stack;
- instruction sources;
- test and deployment capabilities;
- runtime availability;
- initial risk summary;
- assessment progress;
- decisions needed before first run.

### 14.3 Skill assessment view

Show findings grouped by:

- Keep global
- Scope more narrowly
- Convert to skill
- Replace with existing skill
- Conflict to resolve
- Stale or invalid
- Missing recommended capability

The default ordering should prioritize harmful conflicts and high-value improvements, not the largest number of suggestions.

### 14.4 Plan composer

The plan composer should combine:

- editable dependency graph;
- concise plan summary;
- agent count rationale;
- cost and risk range;
- unresolved decisions;
- approval checkpoints;
- launch action.

### 14.5 Live run map

The live run map should be **task-first**, not agent-first. Tasks are durable and meaningful; agent instances are replaceable workers assigned to them.

Each task node shows:

- title;
- agent/profile badge;
- state;
- current action;
- progress evidence;
- dependency count;
- risk/approval indicator.

Selecting a task opens its inspector.

### 14.6 Agent and skill atlas

The atlas is capability-first. It displays:

- available agent profiles;
- skill clusters;
- currently active assignments;
- installed and uninstalled recommendations;
- dormant capabilities;
- historical usage;
- trust status;
- runtime compatibility.

Current capabilities should glow or gain opacity. Recommended capabilities should use a distinct outline. Dormant capabilities remain plotted so users understand what is available and can discover relevant options when a new task arrives.

### 14.7 Review and integration

Show:

- combined change summary;
- provenance by task and agent;
- merge order;
- conflicts and their resolution;
- acceptance criteria and evidence;
- tests, type checks, builds, screenshots, and security checks;
- rejected or deferred findings;
- final human actions.

### 14.8 History

Show runs as outcomes, not chat archives:

- goal;
- plan topology;
- important decisions;
- skills and models used;
- duration and cost;
- conflicts and retries;
- validation result;
- final status;
- reusable learning.

### 14.9 Methodology library and context stack

The methodology library should show titled, searchable cards with scope, owner, current version, trust, recent use, and outcome evidence. Selecting a methodology opens its components and provenance. Starting a session opens a compact Context Stack where the user can accept recommendations, reorder only where policy permits, inspect conflicts, and preview the compiled effective context.

The same object should support two interaction levels:

- **Guided view:** plain-language sections, switches, examples, impact labels, and clear update actions.
- **Expert view:** manifest source, version diff, precedence trace, runtime compilation output, context budget, evaluation results, and API/CLI identifiers.

---

## 15. Task and agent inspector

Every selected task should answer the following without opening raw logs:

### Identity

- Task name
- Assigned agent/profile
- Category
- Status
- Risk tier

### Why

- Why the task exists
- Why it is separate from adjacent tasks
- Why this agent/profile/model was selected
- Why these skills were selected
- Why it can or cannot run now
- Confidence and assumptions

### Scope

- Objective
- Deliverable
- Allowed files
- Prohibited files/actions
- Tools and permissions
- Inputs consumed
- Outputs promised

### Activity

- Current action in plain language
- Recent structured events
- Commands running
- Files changed
- Validation progress
- Context and cost usage

### Relationships

- Depends on
- Blocks
- Unblocks
- Shares contracts with
- Potential file overlap
- Downstream effects of changing or canceling it

### Completion

- Acceptance criteria
- Evidence per criterion
- Review findings
- Diff link
- Retry/repair history

### Controls

- Message
- Pause
- Resume
- Redirect
- Narrow or expand scope
- Change skill/model
- Reassign
- Retry
- Replace agent
- Cancel
- Approve requested action

---

## 16. Dependency and impact system

### 16.1 Dependency types

The graph should distinguish:

- hard execution dependency;
- artifact or contract dependency;
- review dependency;
- approval dependency;
- environmental dependency;
- potential file-overlap risk;
- optional informational relationship.

Hard dependencies control readiness. Informational relationships do not.

### 16.2 Three impact layers

#### Declared impact

Created during planning:

- task A produces a type consumed by task B;
- task C must pass before review D;
- task E owns a migration required by backend F.

#### Observed impact

Detected while agents work:

- an exported symbol changed;
- a shared file was modified;
- an API schema changed;
- a migration appeared;
- a package dependency changed;
- a failing test spans multiple task scopes.

#### Realized impact

Confirmed after integration:

- downstream task reopened;
- integration tests failed;
- merge conflict occurred;
- shared contract was compatible;
- validation remained green.

### 16.3 Impact derivation

Use a combination of:

- declared task contracts;
- import and dependency graphs;
- exported symbol changes;
- API schema comparison;
- database migration analysis;
- package manifest changes;
- test-to-code relationships;
- changed-file overlap;
- runtime events;
- validation results.

Model-generated impact explanations should summarize system evidence, not substitute for it.

### 16.4 Example messages

- “Changing the pricing type will reopen Checkout UI and Integration QA.”
- “This task modified a file outside its approved scope. Execution is paused.”
- “The API task completed, but the expected schema artifact was not produced.”
- “Two tasks now touch `src/types/order.ts`; choose a single owner before continuing.”
- “Canceling this task removes the only planned validation for mobile overflow.”

---

## 17. Execution harness

### 17.1 Harness responsibilities

The harness controls:

- agent creation and termination;
- runtime and model selection;
- task scheduling;
- dependency readiness;
- context assembly;
- skill activation;
- MCP and tool availability;
- permission evaluation;
- worktree/environment creation;
- file ownership;
- event normalization;
- progress and blocker detection;
- retries and timeouts;
- validation;
- integration;
- cost and concurrency limits;
- pause, cancel, and recovery.

### 17.2 Worktree and environment isolation

Every writing agent should receive:

- an isolated branch/worktree or equivalent snapshot;
- explicit base commit;
- approved file scope;
- task-specific environment configuration;
- only necessary secrets and tools;
- deterministic validation commands;
- a defined output contract.

Read-only research agents may share a repository snapshot if this does not create state ambiguity.

### 17.3 File ownership

- Assign expected ownership during planning.
- Shared contract files should receive one owner.
- Unexpected out-of-scope edits should pause or require approval.
- If two agents need the same file, serialize the work or create an explicit handoff.
- Advisory locks may be used, but the dependency model remains the primary control.
- Never allow last-writer-wins behavior to silently overwrite work.

### 17.4 Integration order

Integration should follow the dependency graph:

1. shared contracts;
2. independent implementations;
3. migrations or infrastructure changes in controlled order;
4. integration tests;
5. review and repair;
6. final user approval.

### 17.5 Recovery behavior

Define bounded policies for:

- rate limit;
- model/API error;
- command failure;
- failed validation;
- agent inactivity;
- incomplete task state;
- merge conflict;
- permission denial;
- missing environment variable;
- context exhaustion;
- user interruption.

Retries must have limits. Repeated failure should produce a diagnosis and escalation, not an infinite loop.

---

## 18. State and event model

### 18.1 Run states

- Draft
- Awaiting plan approval
- Preparing
- Running
- Paused
- Awaiting user decision
- Integrating
- Verifying
- Merge-ready
- Completed
- Failed
- Canceled

### 18.2 Task states

- Proposed
- Approved
- Blocked by dependency
- Ready
- Assigned
- Running
- Awaiting permission
- Awaiting input
- Verifying
- Repairing
- Completed
- Failed
- Canceled
- Superseded

### 18.3 Agent instance states

- Provisioning
- Active
- Waiting
- Blocked
- Idle
- Stopping
- Finished
- Failed
- Replaced

“Idle” must not be confused with “complete.” A task can remain incomplete while an agent is idle.

### 18.4 Structured event types

- task created or edited;
- dependency added or resolved;
- agent assigned or replaced;
- skill selected or loaded;
- tool requested or used;
- permission requested, approved, or denied;
- file read or changed summary;
- command started or completed;
- validation started or completed;
- artifact produced or consumed;
- task blocked or unblocked;
- scope violation detected;
- plan revision proposed or approved;
- cost threshold reached;
- integration started or completed;
- user intervention;
- run completed, failed, or canceled.

### 18.5 User-facing activity language

Translate low-level events into concise statements:

- “Inspected the pricing schema.”
- “Loaded responsive-design and accessibility skills.”
- “Changed three approved files.”
- “All eight unit tests passed.”
- “Waiting for the shared pricing type.”
- “Blocked by a missing environment variable.”
- “Requested approval to install one package.”

Raw logs remain available as a deeper layer.

---

## 19. Context and memory architecture

### 19.1 Task-specific context packs

Each agent should receive only what it needs:

- task contract;
- the relevant compiled subset of the session's pinned methodology stack;
- relevant repository instructions;
- selected skills;
- relevant code and architecture summary;
- dependency inputs and artifacts;
- allowed tools and permissions;
- acceptance criteria;
- validation commands;
- current branch/base information;
- known risks and assumptions.

Do not send the entire coordinator conversation or every repository document by default.

The methodology manifest is not copied wholesale into every task. The context builder resolves the effective stack, then includes only the rules, preferences, skills, examples, and validators applicable to that task. Every included element retains a provenance pointer so the user can trace why it was loaded.

### 19.2 Context-return contract

Agents should return structured results:

- outcome summary;
- files changed;
- commands and validations;
- artifacts produced;
- assumptions or unresolved issues;
- downstream warnings;
- recommended next action.

This keeps the coordinator context compact.

### 19.3 Memory levels

| Level | Content | Default retention |
| --- | --- | --- |
| Task | Temporary working state | Run or task lifetime |
| Run | Plan, events, evidence, decisions | Project history |
| Project | Approved instructions, methodology defaults, skill choices, architecture facts | Persistent and reviewable |
| User | Personal preferences, methodologies, and reusable skills | Explicitly controlled |
| Organization | Approved policies, methodology baselines, and skill catalog | Administrator controlled |

Do not silently promote agent observations into durable project memory. Proposed memory should be reviewed or supported by deterministic evidence.

### 19.4 Context efficiency metrics

- instruction tokens loaded per task;
- unused skill activations;
- duplicated context across agents;
- tool-output volume summarized away;
- compaction frequency;
- context-related failure rate;
- cost per accepted task.

---

## 20. Models, runtimes, tools, and MCP

### 20.1 Provider-neutral core

The core system should operate on normalized objects:

- task;
- agent profile;
- agent instance;
- skill;
- tool;
- permission;
- event;
- artifact;
- validation;
- decision.

Provider-specific features enter through adapters.

### 20.2 Runtime adapter responsibilities

- start, resume, message, interrupt, and stop a session;
- create or attach an isolated environment;
- stream normalized events;
- expose available models and capabilities;
- declare skill and MCP support;
- report token/cost information when available;
- return diffs and artifacts;
- surface permission requests;
- map runtime errors into shared categories.

### 20.3 First-runtime decision

The MVP should support one runtime deeply rather than several shallowly. Selection criteria:

- reliable programmatic control;
- quality of streaming events;
- session interruption and resumption;
- worktree/environment support;
- skill and subagent support;
- permission hooks;
- diff and artifact access;
- commercial terms;
- user demand.

The internal schemas must not assume that all future runtimes use the same terminology or team architecture.

### 20.4 MCP’s role

MCP connects agents to external tools, APIs, databases, documentation, and services. It should not be treated as the entire orchestration layer.

Possible MCP connections:

- GitHub or GitLab
- Linear or Jira
- documentation systems
- browser testing
- databases
- deployments
- observability and error monitoring
- design systems
- communication tools

The harness decides when a tool is visible, who may call it, what permission applies, and how the result enters context.

### 20.5 Tool discovery

Expose compact metadata initially. Load full schemas only when relevant if supported. Too many verbose tool definitions can consume context and reduce selection quality.

---

## 21. Permissions, safety, and security

### 21.1 Threats

- prompt injection in repository content;
- malicious or compromised skills;
- dangerous bundled scripts;
- credential exposure;
- unintended network egress;
- destructive commands;
- external side effects;
- dependency supply-chain changes;
- agents modifying files outside scope;
- permission escalation through another agent;
- unsafe content returned by MCP tools;
- misleading completion claims;
- runaway cost or infinite retries.

### 21.2 Permission dimensions

- filesystem read;
- filesystem write;
- command execution;
- package installation;
- network access;
- MCP access;
- secret access;
- database reads/writes;
- deployment;
- messaging or external communication;
- merge/push/publish;
- destructive action.

### 21.3 Recommended defaults

| Action | Default |
| --- | --- |
| Read approved repository | Allowed after repository trust |
| Write within approved task scope | Allowed after plan approval |
| Write outside task scope | Pause and request approval |
| Run known validation commands | Allowed |
| Install or update dependency | Approval unless pre-approved in plan |
| Read external documentation | Allowed under network policy |
| Send external message or create ticket | Always approval-gated initially |
| Deploy, merge, push, or publish | Explicit approval |
| Access secret | Brokered, task-specific, never displayed |
| Destructive command | Explicit confirmation and recoverability check |

### 21.4 Skill sandboxing

Untrusted skills should be inspected without executing bundled code. The system should identify:

- executable files;
- network calls;
- dependency installation;
- broad filesystem access;
- credential references;
- hidden or encoded instructions;
- conflicts with higher-authority policy.

### 21.5 Reversibility

- isolated worktrees;
- checkpoints before material changes;
- explicit base commits;
- recoverable cancellation;
- preserved diffs;
- merge only after verification;
- rollback instructions for migrations or deployments;
- immutable audit trail for permission decisions.

### 21.6 Kill switch and budget controls

Every run needs:

- pause all;
- cancel all;
- stop one agent;
- revoke a tool or permission;
- maximum concurrency;
- token/cost budget;
- execution-time ceiling;
- retry ceiling;
- notification thresholds.

---

## 22. Verification and integration quality

### 22.1 Completion definition

A task is not complete because an agent stopped. It is complete when:

- the deliverable exists;
- scope is respected;
- acceptance criteria have evidence;
- required validations passed;
- downstream artifacts were produced;
- unresolved issues are disclosed;
- the system recorded a final outcome.

### 22.2 Evidence hierarchy

Prefer:

1. deterministic tests and build results;
2. type checks, linters, schema validation, and security tools;
3. browser or visual evidence;
4. structured diff analysis;
5. independent review-agent findings;
6. implementer self-report.

### 22.3 Repair loop

1. Validation fails.
2. System attributes the failure to one or more task scopes.
3. Relevant task reopens.
4. Agent receives the failure evidence and bounded repair instructions.
5. Validation reruns.
6. After retry limit, escalate with diagnosis and choices.

### 22.4 Integration reviewer

The final reviewer should check:

- task completeness;
- unintended scope;
- cross-agent inconsistencies;
- regressions;
- missing tests;
- security baseline;
- duplicated code;
- inconsistent patterns;
- unresolved TODOs;
- documentation impact;
- user acceptance criteria.

The reviewer should not silently rewrite large areas. It should request targeted repairs or obtain approval for a new task.

---

## 23. Human coordination controls

### 23.1 Coordinator interaction

The main interaction should let the user say:

- “Why is this separate?”
- “Can these run together?”
- “Use one agent instead.”
- “Do not touch the database.”
- “Pause after the API contract.”
- “Give accessibility more weight.”
- “Replace the stalled agent.”
- “What happens if I cancel this?”
- “Show only decisions requiring me.”

### 23.2 Direct agent interaction

Users can open a task/agent and:

- ask for clarification;
- supply missing context;
- redirect an approach;
- request evidence;
- pause or retry;
- change the model or skill set;
- reassign ownership.

Direct interaction must update the central plan and event history. It cannot become an invisible side conversation.

### 23.3 Approval inbox

A compact decision queue should group:

- permissions;
- architecture choices;
- scope changes;
- dependency conflicts;
- cost-limit decisions;
- merge/deploy actions.

Each item must state:

- what is requested;
- why it is needed;
- alternatives;
- risk;
- downstream effect;
- default/recommended action;
- expiration or blocking status.

---

## 24. Analytics and learning

### 24.1 North-star metric

> **Percentage of approved feature runs that reach a verified, merge-ready outcome without the user needing to reconstruct what happened manually.**

This combines outcome quality with comprehension.

### 24.2 Planning metrics

- time to approved plan;
- user plan-edit rate;
- task split/merge corrections;
- agent-count corrections;
- missed dependency rate;
- predicted versus actual file overlap;
- predicted versus actual critical path;
- percentage of runs where the system correctly chose one agent.

### 24.3 Execution metrics

- task completion rate;
- blocked time;
- idle-but-incomplete time;
- retry rate;
- scope violation rate;
- merge conflict rate;
- validation pass rate;
- integration repair rate;
- cancellation rate;
- runtime failure rate.

### 24.4 Skill metrics

- recommendation acceptance;
- activation precision;
- unused activation rate;
- validation compliance;
- outcome association;
- compatibility failures;
- version rollback rate;
- user removal or replacement.

### 24.5 Cost metrics

- cost per accepted task;
- cost per merge-ready run;
- context duplicated across agents;
- coordination tokens versus implementation tokens;
- cost of failed or abandoned work;
- estimated savings from parallelism;
- cost avoided by declining unnecessary agents.

### 24.6 Comprehension metrics

Usability tests should ask whether a user can answer within ten seconds:

- What is currently running?
- What is blocked?
- Why is it blocked?
- What decision is required?
- Which task is on the critical path?
- What will be affected by a change?
- Is the work actually verified?

### 24.7 Avoid vanity metrics

Do not optimize for:

- number of agents spawned;
- number of messages exchanged;
- raw tool-call volume;
- animated graph activity;
- total code generated;
- longest autonomous run.

These can increase while product value decreases.

---

## 25. Core data model

### 25.1 Primary entities

- User
- Organization
- Project
- Methodology
- Methodology version
- Methodology component reference
- Methodology activation
- Repository snapshot
- Instruction source
- Instruction rule
- Skill
- Skill version
- Agent profile
- Runtime adapter
- Model policy
- Run
- Task
- Dependency
- Agent instance
- Context pack
- Tool
- Permission grant
- Event
- Artifact
- File ownership record
- Validation
- Review finding
- Decision
- Cost record
- Outcome metric

### 25.2 Important relationships

- A project has many instruction sources and approved skills.
- A methodology has immutable published versions and references rules, skills, validators, policies, preferences, and examples.
- A methodology may extend a small number of compatible methodologies.
- A run pins an ordered methodology stack and records its compiled effective-context digest.
- A run has one goal and one versioned plan.
- A run contains tasks connected by typed dependencies.
- A task may have one current agent instance and several historical attempts.
- A task activates several skills and tools.
- A skill has versioned provenance and trust status.
- An agent instance emits events and produces artifacts.
- Artifacts are consumed by downstream tasks.
- Validations attach to tasks, integrations, or the whole run.
- Decisions modify plan, permission, scope, or execution state.

### 25.3 Event sourcing recommendation

Store state-changing events append-only and derive current state from them or from durable projections. This supports:

- live UI updates;
- replay;
- debugging;
- auditability;
- recovery after restart;
- provider normalization;
- historical analytics;
- explaining why a state changed.

For the MVP, SQLite plus a well-defined event schema is sufficient. A distributed workflow system is unnecessary until durable multi-machine execution creates a real need.

---

## 26. Recommended technical architecture

### 26.1 Components

#### Desktop or local application shell

Likely appropriate for local repositories and installed coding runtimes. The UI can use web technology while a local service manages repositories and agent processes.

#### Orchestrator service

Responsible for plan state, scheduling, dependencies, budgets, approvals, and recovery.

#### Runtime adapter layer

One adapter per supported coding-agent runtime.

#### Repository intelligence service

Indexes structure, instructions, imports, symbols, tests, and changed-file relationships.

#### Skill registry

Stores metadata, versions, trust, compatibility, evaluations, and activation rules.

#### Context builder

Resolves the pinned methodology stack, instructions, skills, and task contract into minimal task-specific context packs; preserves provenance; reports conflicts and context cost; and manages compaction.

#### Methodology registry and compiler

Stores methodology identities and immutable published versions, resolves inheritance and precedence, validates component references, produces runtime-specific compiled output, and records the exact digest used by each run.

#### Permission engine

Evaluates proposed tools and actions against user, project, task, and organization policy.

#### Execution environment manager

Creates worktrees or sandboxes and manages processes.

#### Validation engine

Runs deterministic checks and records evidence.

#### Integration engine

Combines completed work according to the dependency graph.

#### Event store and projection layer

Supports live status, history, recovery, and analytics.

#### Visual client

Renders plan, run map, atlas, inspectors, decisions, diffs, and evidence.

### 26.2 Reference implementation direction

The following is a reasoned starting point, not a mandatory technology prescription. The builder should confirm it against the repository, operating environment, and selected runtime integration. Equivalent choices are acceptable when they preserve the required boundaries and are easier to validate or maintain.

- TypeScript for the initial orchestration service and UI
- React for interface composition
- A graph library suited to dependency editing for the run map
- D3, Sigma.js, or a comparable data-visualization layer for the larger capability atlas
- SQLite for local persistence
- Git worktrees for repository isolation
- Server-sent events or WebSockets for local event streaming
- Provider adapters behind strict interfaces
- Local encrypted credential storage or OS credential broker

Do not select graph technology solely for attractive force-directed animation. Editing, stable layout, accessibility, performance, and deterministic positioning matter more.

### 26.3 Implementation decision framework

Classify build guidance into three levels:

| Level | Meaning | Builder freedom |
| --- | --- | --- |
| Product invariant | Required for the product to be safe, coherent, or testable | May change implementation, not the protected outcome |
| Recommended default | Best current starting point with stated rationale | May replace when an alternative better fits the codebase and passes validation |
| Open hypothesis | Product or technical assumption still being tested | Expected to change as evidence arrives |

Examples of product invariants include preserving run state, preventing silent methodology mutation, surfacing permission expansion, and attaching evidence to completion. TypeScript, a specific graph library, a directory layout, or a particular state-management package are recommended choices rather than product invariants.

When handing work to a coding model, provide:

1. the product outcome and user scenario;
2. relevant existing architecture and conventions;
3. the stable domain contracts it must preserve;
4. security and data-integrity risks;
5. observable acceptance criteria;
6. recommended approaches and why they are recommended;
7. explicit permission to choose a better implementation when justified;
8. required tests, evidence, and a concise record of consequential deviations.

This gives the implementation model enough context to exercise judgment without converting early product assumptions into brittle code rules.

### 26.4 Architectural templates

Create small, typed templates at recurring boundaries:

- runtime adapter capability declaration;
- normalized event envelope;
- task contract;
- methodology manifest;
- context-component provenance record;
- permission request and decision;
- validation result;
- agent result and handoff;
- UI loading, empty, active, blocked, failed, and completed states;
- adapter conformance test fixture.

Templates should provide a safe and consistent starting shape. They should support extension through typed optional capabilities or versioned schemas rather than requiring every provider or task to behave identically. Avoid generating large amounts of boilerplate or creating abstract base classes before a second concrete implementation proves the shared behavior.

### 26.5 Model and runtime integration strategy

Do not decide the product architecture by choosing a model first. Define the orchestration domain independently, then perform a short integration spike for candidate runtimes.

Evaluate each candidate on:

- structured streaming events;
- thread/session control;
- interruption and steering;
- approval and permission handling;
- tool and file-change visibility;
- usage reporting;
- structured outputs;
- authentication fit for a private local prototype;
- stability and versioning of its integration surface;
- ability to run inside isolated worktrees.

Implement one live adapter for the MVP plus a deterministic simulated adapter for UI development and recovery tests. Normalize only capabilities the product actually uses. Preserve provider-specific detail in adapter-owned metadata rather than flattening useful information prematurely.

### 26.6 Desktop versus web

#### Desktop/local advantages

- direct repository and runtime access;
- easier local-first privacy;
- existing CLI credentials can remain with their runtimes;
- better process and worktree control.

#### Web/cloud advantages

- easy sharing;
- durable remote runs;
- team collaboration;
- centralized policy and analytics.

Recommended sequence: local/desktop or local web application first, cloud collaboration later. Keep the orchestrator boundary capable of supporting remote workers in the future.

---

## 27. MVP scope

### 27.1 MVP promise

> In a private local prototype, connect one repository, assess its instructions and skills, turn one feature request into an editable plan, run up to three isolated agents, and understand every task, dependency, change, and verification result from one visual interface.

### 27.2 Must-have MVP features

#### Delivery mode

- Private, single-user prototype for the product owner
- Local repositories and local persistence
- No public accounts, billing, team administration, installer, or cloud synchronization required
- Development workflow may run the visual client and local orchestration service separately until packaging improves validation
- One live runtime adapter selected after an integration spike, plus a deterministic simulated adapter

#### Repository intake

- Open one local repository
- Detect stack, tests, instruction files, and skills
- Create a cached repository snapshot

#### Instruction and skill assessment

- Parse `CLAUDE.md` and/or `AGENTS.md`
- Classify global facts, scoped rules, and procedures
- Suggest skill extraction
- Detect obvious conflicts and duplicates
- Recommend from a small curated skill catalog
- Preview changes without applying them automatically

#### Methodology profiles

- Create, title, describe, clone, and archive a structured methodology
- Separate hard rules, prompt policy, preferences/vibe, skill references, and validators
- Recommend relevant methodologies at session start with concise reasons
- Combine up to three profiles using fixed, visible precedence
- Detect conflicts and show an effective-context preview
- Display enforcement strength for every hard rule
- Pin each run to immutable methodology versions
- Support draft, diff, publish, rollback, and one native-format import/export path

#### Planning

- Accept one feature request
- Generate a structured task DAG
- Explain every task and agent assignment
- Define file scope, skills, dependencies, and acceptance checks
- Let the user edit and approve the plan
- Recommend one agent when parallelism is not justified

#### Execution

- Support one runtime adapter
- Launch at most three concurrent writing agents
- Use isolated worktrees
- Stream normalized events
- Enforce declared file scopes
- Support pause, message, retry, and cancel

#### Visual interface

- Dark, breathable interface
- Editable plan/run graph
- Selected task inspector
- Stable category colors
- Active, blocked, queued, and completed states
- Agent/skill atlas in a useful but limited form

#### Verification

- Run configured tests/type checks/build commands
- Show acceptance evidence
- Combine work in a dedicated integration worktree
- Show final diff and review summary

#### Safety

- Explicit plan approval
- Scoped file writes
- permission requests for expanded actions
- cost/concurrency ceiling
- kill switch
- preserved history and rollback path

### 27.3 Explicitly defer from MVP

- unrestricted public skill marketplace;
- automatic execution of unknown third-party skills;
- many runtime providers;
- nested autonomous agent organizations;
- complex enterprise roles;
- organization-wide analytics;
- mobile application;
- real-time multi-user editing;
- autonomous production deployment;
- long-term self-modifying instruction systems;
- generalized non-coding automation.

### 27.4 MVP acceptance criteria

The MVP succeeds when a user can:

1. connect a real repository;
2. understand the instruction assessment;
3. approve or correct a proposed skill extraction;
4. save and reuse a titled methodology without copying a large prompt;
5. inspect exactly which methodology components will affect a new session;
6. submit a medium-sized feature;
7. understand the proposed task graph in under two minutes;
8. see why each assignment exists;
9. run two independent implementations safely;
10. identify a blocker without reading raw logs;
11. prevent an out-of-scope file edit;
12. receive a combined, tested, reviewable result.

---

## 28. Roadmap

The phases describe dependency order, not calendar commitments.

### Phase 0: Design and evaluation foundation

- Write a model-ready build brief that separates invariants, defaults, and hypotheses
- Define normalized schemas
- Create repository assessment test set
- Create task decomposition evaluation set
- Prototype plan graph and inspector
- Test visual comprehension with static scenarios
- Build a deterministic simulated runtime adapter
- Spike candidate live runtime integrations and select the first adapter from evidence

### Phase 1: Planning prototype

- Local repository scan
- Instruction classification
- Skill extraction suggestions
- Curated skill metadata
- Structured methodology profiles
- Session-start methodology recommendation
- Effective-context and conflict preview
- Structured plan generation
- Editable task graph
- No code execution required yet

### Phase 2: Executable MVP

- First runtime adapter
- Worktree isolation
- Two to three concurrent agents
- Event stream
- Scope enforcement
- Validation
- Integration worktree
- Final review

### Phase 3: Reliable V1

- Better impact detection
- Repair loops
- Run history
- Cost and context analytics
- Skill effectiveness evidence
- Methodology versioning, diffs, rollback, and evaluation evidence
- Stronger security and recovery
- Reusable plan templates

### Phase 4: Multi-provider control plane

- Second and third runtime adapters
- Model routing policies
- Cross-provider comparisons
- Provider-independent project memory
- Shared skill compatibility layer
- Methodology import/export adapters and compiled-output comparison

### Phase 5: Team and ecosystem

- Organization policies
- Approved skill catalog
- Team collaboration
- Shared runs and comments
- Signed third-party skills
- Evaluation-backed marketplace
- Enterprise audit and deployment controls

---

## 29. Feature priority matrix

Scores use 1–5, where 5 is highest. Priority reflects the recommended order, not only market appeal.

- **P0:** Required to prove the core product promise or operate safely.
- **P1:** Required for a strong V1 after the core loop works.
- **P2:** Important expansion, team, or governance capability.
- **P3:** Deliberately deferred until usage proves the need.

| Feature | User impact | Differentiation | Effort | Risk | Priority |
| --- | ---: | ---: | ---: | ---: | --- |
| Instruction assessment | 5 | 5 | 3 | 2 | P0 |
| Structured methodology profiles | 5 | 5 | 3 | 2 | P0 |
| Methodology composition and context preview | 5 | 5 | 4 | 3 | P0 foundation, expand through V1 |
| Explainable task graph | 5 | 5 | 3 | 2 | P0 |
| Why-this-agent explanations | 5 | 5 | 2 | 2 | P0 |
| File ownership and worktrees | 5 | 3 | 4 | 4 | P0 |
| Task-specific skill routing | 5 | 5 | 4 | 3 | P0 |
| Structured event stream | 5 | 4 | 4 | 3 | P0 |
| Acceptance evidence | 5 | 4 | 3 | 2 | P0 |
| Impact mapping | 5 | 5 | 5 | 4 | P0 foundation, expand through V1 |
| Agent/skill atlas | 4 | 4 | 3 | 2 | P1 |
| Cost and context analytics | 4 | 3 | 3 | 2 | P1 |
| Run learning | 5 | 5 | 5 | 4 | P1 foundation, mature later |
| Multi-provider support | 4 | 4 | 5 | 4 | P1 after one deep adapter |
| Cross-provider methodology portability | 4 | 5 | 5 | 4 | P2 after one deep export path |
| Curated skill catalog | 4 | 4 | 3 | 3 | P1 |
| Public marketplace | 3 | 2 | 5 | 5 | P3 |
| Enterprise governance | 4 | 3 | 5 | 4 | P2 |
| Mobile supervision | 2 | 2 | 4 | 2 | P3 |

---

## 30. Evaluation strategy

### 30.1 Instruction assessment evaluation

Create repositories containing:

- oversized global instruction files;
- duplicate rules;
- conflicting scoped rules;
- procedures that should become skills;
- obsolete commands;
- unsafe third-party skill content;
- missing tests or validation commands.

Measure:

- classification accuracy;
- conflict detection precision/recall;
- quality of proposed skill boundaries;
- false-positive suggestion rate;
- user edit rate;
- context reduction without lost requirements.

### 30.2 Planner evaluation

Use feature tasks with known architectural boundaries. Score:

- completeness;
- task independence;
- dependency accuracy;
- file-scope accuracy;
- acceptance-criteria quality;
- appropriate agent count;
- cost awareness;
- identification of decisions requiring a human.

### 30.3 Orchestration evaluation

Test:

- parallel independent tasks;
- same-file conflict;
- shared-contract handoff;
- failing downstream test;
- agent timeout;
- rate limit;
- permission denial;
- out-of-scope write;
- integration conflict;
- cancellation and restart.

### 30.4 Visual comprehension evaluation

Give users a running scenario and measure time and accuracy for:

- finding the critical path;
- identifying the blocked task;
- explaining why it is blocked;
- identifying the responsible task;
- locating required approval;
- predicting the effect of cancellation;
- confirming whether the run is merge-ready.

### 30.5 Skill evaluation

Do not evaluate a skill only by whether the agent invoked it. Evaluate whether:

- the procedure was followed;
- required evidence was produced;
- failure rate changed;
- context/cost changed;
- user corrections decreased;
- results remained consistent across runtimes.

### 30.6 Methodology evaluation

Evaluate methodology quality at three levels:

1. **Compilation quality:** conflicts detected, duplicate content removed, scope and precedence resolved correctly, and context budget respected.
2. **Behavioral adherence:** required prompt handling occurred, relevant skills activated, hard rules were enforced at the declared strength, and validators ran.
3. **Outcome quality:** user corrections, retries, completion rate, validation evidence, cost, and acceptance compared with relevant baselines.

Test version upgrades against a stable scenario suite before recommending them as defaults. Report correlation and sample size; do not imply causal improvement from a small or biased run history.

---

## 31. Major risks and mitigations

### Platform convergence

**Risk:** Model providers add similar project dashboards and graphs.  
**Mitigation:** Focus on cross-provider instruction intelligence, skill trust/evaluation, impact mapping, and outcome learning.

### Visualization theater

**Risk:** The graph looks impressive but does not help decisions.  
**Mitigation:** Every visual property must encode real state; test comprehension; provide list alternatives; avoid decorative activity.

### Agent overproduction

**Risk:** The planner spawns excessive agents because activity looks valuable.  
**Mitigation:** Explicit topology scoring, cost penalties, minimum useful task size, and visible “why no additional agent” decisions.

### Cost explosion

**Risk:** Duplicate context and coordination consume more than implementation.  
**Mitigation:** Progressive skill loading, task-specific context packs, budgets, concurrency caps, and cost-per-outcome metrics.

### Merge and file conflicts

**Risk:** Parallel work overwrites or contradicts other work.  
**Mitigation:** Worktrees, file ownership, shared-contract tasks, overlap detection, and dependency-ordered integration.

### Skill supply-chain risk

**Risk:** Third-party skills contain malicious instructions or scripts.  
**Mitigation:** Provenance, trust tiers, version pinning, sandbox inspection, permission review, and no unverified auto-installation.

### Methodology becomes a mega-prompt

**Risk:** Users accumulate long, duplicated profiles that consume context and become impossible to reason about.  
**Mitigation:** Structured components, references instead of copies, progressive loading, linting, deduplication, context budgets, and effective-context previews.

### False “hard rule” confidence

**Risk:** A natural-language instruction is labeled mandatory even though the runtime can ignore it.  
**Mitigation:** Display enforcement strength for every rule and back consequential constraints with permissions, hooks, schemas, tests, or CI.

### Methodology conflicts and stale guidance

**Risk:** Stacked profiles contradict one another or preserve practices that no longer fit the project.  
**Mitigation:** Deterministic precedence, preflight conflict blocking, freshness signals, compatibility ranges, deprecation, and periodic review prompts.

### Silent session mutation

**Risk:** Updating a methodology changes the behavior of an active or reproducibility-sensitive run.  
**Mitigation:** Immutable published versions, per-session pinning, explicit upgrade choices, compiled-context digests, diff, fork, and rollback.

### Untrusted methodology import

**Risk:** An imported profile expands tools, permissions, network access, or executable skills under benign-looking “vibe” language.  
**Mitigation:** Provenance and signature checks, permission-delta review, referenced-skill inspection, trust tiers, and no silent privilege expansion.

### False status confidence

**Risk:** An agent claims completion while required work is absent.  
**Mitigation:** State derived from events and evidence; acceptance criteria; deterministic validation; independent review.

### Repository privacy

**Risk:** Code or secrets cross an unintended provider boundary.  
**Mitigation:** Local-first design, provider boundary labels, scoped credential broker, redaction, and explicit network policy.

### Provider churn

**Risk:** Runtime APIs, event formats, or product features change.  
**Mitigation:** Adapter isolation, conformance tests, capability discovery, and provider-neutral core entities.

### Planner error

**Risk:** Incorrect decomposition creates missing work or false independence.  
**Mitigation:** Editable plan, uncertainty display, preflight conflict analysis, human approval, and outcome-based evaluation.

### Excessive onboarding friction

**Risk:** Full assessment delays the first useful result.  
**Mitigation:** Progressive scan, immediate preliminary findings, caching, and “run with current instructions” option when safe.

### Scope expansion

**Risk:** The product attempts code agents, project management, marketplace, cloud IDE, and enterprise governance simultaneously.  
**Mitigation:** Preserve the MVP loop: assess → plan → explain → execute → verify.

---

## 32. Go-to-market and demonstration strategy

### 32.1 Initial wedge

Target people already using multiple coding-agent sessions who feel the coordination problem. Do not begin by teaching the market why coding agents exist.

### 32.2 Ideal demonstration

1. Open a real repository with an oversized `CLAUDE.md`.
2. Show the assessment separating global rules from reusable skills.
3. Submit a broad feature request.
4. Show the planner create three justified tasks rather than generic departments.
5. Show file ownership and dependencies.
6. Launch the run.
7. Watch one handoff animate when an API contract becomes available.
8. Show a scope violation or blocker become immediately understandable.
9. Inspect why an agent and skill were selected.
10. Complete integration with visible test evidence and diff provenance.

This demonstrates the differentiated product in one coherent story.

### 32.3 Messaging themes

- Clarity over agent chaos
- The right agent, skill, and context for each task
- Parallel when useful, one agent when safer
- Understand every dependency and decision
- Evidence, not “done” claims
- One visual system across agent runtimes

### 32.4 Potential business model

This remains exploratory:

- Free/local tier for one project and one runtime
- Pro tier for larger runs, history, advanced analysis, and additional adapters
- Team tier for shared policies, approved skills, collaboration, and audit history
- Enterprise tier for self-hosting, centralized governance, and compliance
- Marketplace revenue only after skill trust and evaluation are mature

Avoid tying core safety controls exclusively to an expensive plan.

---

## 33. Non-goals

The initial product is not:

- a new language model;
- an IDE replacement;
- a fully autonomous software company;
- a generic no-code automation platform;
- a public skill marketplace first;
- a project-management replacement;
- a chain-of-thought viewer;
- a system that maximizes agent count;
- an automatic production deployer;
- a guarantee that visualized work is correct without verification.

---

## 34. Open product decisions

### Product identity

- Final name
- Brand personality beyond the current visual direction
- Whether the category term should be “harness,” “control plane,” or “workspace” in public copy

### Initial platform

- Exact shell after the local prototype: packaged desktop application, local web application, or IDE extension
- First live runtime adapter after a capability and integration spike
- Authentication approach for the selected runtime
- When packaging and additional operating-system support become valuable

### Planning

- How much architecture inspection occurs before asking clarifying questions
- Confidence thresholds for automatic task creation
- Whether users can save topologies as workflows in MVP

### Skills

- First curated skill sources
- Skill portability format
- Whether generated skills are stored in the repository, user profile, or both
- Review and signing model for third-party skills

### Methodologies

- Final public term: Methodology, Working Method, Playbook, or Context Profile
- Fixed precedence order and which layers users may override
- First supported import/export target
- Whether a methodology can reference repository-local facts directly or only by typed links
- Versioning convention and compatibility policy
- Minimum evidence required before suggesting an update

### Visual system

- Final category taxonomy and colors
- Default run-map layout
- Default atlas sizing metric
- How much animation is appropriate during heavy activity
- Whether chats appear as panels, drawers, or a separate detail mode

### Business

- BYO provider subscription/API credentials versus bundled usage
- Open-source versus commercial boundary
- Collaboration and cloud-hosting sequence

---

## 35. Recommended next product decisions

Resolve these in order:

1. Write the private-prototype build brief with outcomes, invariants, hypotheses, and acceptance scenarios.
2. Finalize the normalized task, skill, agent, event, and permission schemas.
3. Finalize the methodology manifest, rule classes, precedence, and enforcement-strength model.
4. Define the minimum viable instruction assessment.
5. Build a static interactive prototype of Context Stack, Plan, Run Map, Task Inspector, and Agent Atlas using simulated events.
6. Test whether the product owner can understand applied context, blockers, and downstream effects quickly.
7. Run small integration spikes against candidate model/runtime surfaces and choose one live adapter from evidence.
8. Build planner and methodology evaluation sets before connecting live execution.
9. Implement the selected runtime adapter and worktree manager behind the normalized contracts.
10. Add validation and integration before adding more providers.
11. Collect run evidence before building advanced analytics.
12. Add curated third-party skills only after the trust model is working.

---

## 36. Product decision checklist

Use this checklist when considering any new feature:

- Does it make planning more accurate?
- Does it make the current state easier to understand?
- Does it reduce unnecessary context or agents?
- Does it belong in a rule, skill, methodology, project fact, task contract, or validator—and is that distinction visible?
- Does it expose a real dependency or consequence?
- Does it improve safety or reversibility?
- Does it strengthen verification?
- Does it work across providers conceptually?
- Can its state be derived from structured evidence?
- Does it add visual clarity rather than visual activity?
- Is it necessary for the assess → plan → execute → verify loop?
- What is the smallest version that proves its value?

---

## 37. Glossary

**Agent:** A model-driven worker operating in a runtime with instructions, tools, permissions, and context.  
**Agent instance:** One running agent assigned to a task.  
**Agent profile:** Reusable configuration for a category of work.  
**Artifact:** A structured output passed between tasks, such as a schema, report, diff, or test result.  
**Compiled context:** The minimal runtime-specific instructions and references derived from the effective methodology stack, project context, and task contract.  
**Context pack:** The task-specific information supplied to an agent.  
**Harness:** Software that controls the agent loop, tools, context, permissions, state, and execution environment.  
**Impact:** The expected or observed effect of one task/change on other tasks or system components.  
**Instruction source:** A file or policy containing rules and project context.  
**Methodology:** A titled, versioned, composable way of working that references prompt policies, rules, preferences, skills, tools, outputs, and validators.  
**Methodology stack:** The ordered set of methodology versions selected for a session and resolved by explicit precedence.  
**MCP:** A standard connection layer through which AI applications access tools, APIs, and resources.  
**Run:** One approved plan executed toward a user goal.  
**Runtime:** The product or SDK that hosts and operates an agent session.  
**Skill:** A reusable package of instructions and optional scripts, references, templates, or assets.  
**Task:** A durable, reviewable unit of work with a deliverable and completion evidence.  
**Topology:** The arrangement of single agents, subagents, teams, dependencies, and workflows used for a run.  
**Worktree:** An isolated Git working directory associated with a branch or commit.  

---

## 38. Research references

Research snapshot: September 18, 2026.

- [Altitude](https://learnaltitude.com/) — visual reference. The supplied landing-page screenshot informed the dark, airy, constellation-like direction. The product should adapt these qualities rather than copy the page.
- [OpenAI Codex](https://chatgpt.com/codex/) — parallel agents, worktrees, skills, cloud environments, and background work.
- [Introducing the Codex app](https://openai.com/index/introducing-the-codex-app/) — multi-agent application direction.
- [Claude Code](https://www.anthropic.com/claude-code) — projects, parallel work, skills, MCP connections, and agentic coding workflows.
- [Claude Code agent teams](https://code.claude.com/docs/en/agent-teams) — shared tasks, coordination, token/coordination overhead, file-conflict guidance, and current limitations.
- [Claude Code custom subagents](https://code.claude.com/docs/en/sub-agents) — scoped subagents, permissions, context isolation, model routing, and tool control.
- [Claude Code skills](https://docs.anthropic.com/en/docs/claude-code/skills) — reusable skills and guidance for extracting procedural content from `CLAUDE.md`.
- [Claude Code memory and instruction hierarchy](https://code.claude.com/docs/en/memory) — persistent instruction scopes, path-specific rules, context limits, and the distinction between contextual guidance and deterministic configuration.
- [OpenAI Agent Skills](https://learn.chatgpt.com/docs/build-skills) — skill scopes, explicit and implicit invocation, portable package structure, and progressive disclosure under context limits.
- [Cursor documentation](https://cursor.com/docs) — evidence that rules, skills, subagents, hooks, plugins, and MCP already exist as separate configuration surfaces that a methodology layer can unify.
- [Agent Skills](https://agentskills.io/home) — open skill format and progressive disclosure model.
- [Visual Studio Code](https://code.visualstudio.com/) — multi-agent sessions, provider choice, custom agents, skills, instructions, and MCP integration.
- [Agent Teams open-source project](https://github.com/777genius/agent-teams-ai) — evidence that multi-provider orchestration, live maps, budgets, logs, and diff review are already entering open-source baselines.
- [Anthropic: Enabling Claude Code to work more autonomously](https://www.anthropic.com/news/enabling-claude-code-to-work-more-autonomously) — checkpoints, subagents, hooks, background tasks, and Agent SDK.
- [Anthropic: Scaling Managed Agents](https://www.anthropic.com/engineering/managed-agents) — meta-harness and runtime abstraction direction.

---

## 39. Change log

### Version 0.3 — September 18, 2026

- Confirmed that the MVP begins as a private, single-user, local-first prototype for the product owner.
- Added the “guardrails, not prescriptions” and “stable contracts, flexible internals” implementation principles.
- Distinguished product invariants, recommended defaults, and open hypotheses so implementation models retain appropriate technical judgment.
- Added model-ready handoff guidance, architectural templates, and a provider-neutral runtime integration evaluation strategy.
- Deferred the exact live model/runtime choice until a small capability spike while requiring one simulated adapter and one replaceable live adapter.
- Updated the MVP delivery mode, open decisions, roadmap, and next steps to reflect the private-prototype strategy.

### Version 0.2 — September 18, 2026

- Added methodology profiles as a core product layer rather than a saved-prompt feature.
- Defined structured components for prompt handling, hard rules, soft principles, vibe, skills, agent policy, permissions, outputs, validators, examples, and provenance.
- Added deterministic composition, conflict handling, context compilation, session pinning, updates, diffs, rollback, and advanced-user requirements.
- Added Methodology Library and Context Stack views, data entities, architecture component, MVP requirements, roadmap items, evaluation criteria, and risk mitigations.
- Raised instruction, methodology, and skill intelligence to 20% of strategic product weight while reducing marketplace and later analytics emphasis.

### Version 0.1 — September 18, 2026

- Established full product thesis and honest competitive audit.
- Defined the differentiated wedge around instruction intelligence, skill routing, explainability, impact mapping, and visual supervision.
- Added strategic weights, principles, users, workflow, information architecture, safety, execution, data model, metrics, MVP, roadmap, risks, and evaluation plan.
- Incorporated Altitude-inspired dark, airy, constellation-style visual principles from the supplied landing-page screenshot.
- Recorded confirmed decisions and open questions for continued iteration.
