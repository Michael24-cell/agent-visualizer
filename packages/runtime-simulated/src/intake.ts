import {
  BRIEF_REQUIRED_FIELDS,
  BriefFieldIdSchema,
  type Brief,
  type BriefFieldId,
  type MethodDefinition,
} from '@harness/contracts';

// Deterministic project intake. The coordinator asks for the highest-priority
// Brief field that is still missing (or unconfirmed), one at a time, and
// reads answers with a small set of documented rules.

export const FIELD_PRIORITY: readonly BriefFieldId[] = [
  'goal',
  'scope',
  'doneMeans',
  'constraints',
  'checks',
  'audience',
];

export const FIELD_QUESTIONS: Record<BriefFieldId, string> = {
  goal: 'What are we building? One or two sentences is enough.',
  scope:
    'Where should this work live — which parts of the codebase are in, and which are out?',
  doneMeans:
    'What does done look like? What would you check before calling it finished?',
  constraints:
    'Any constraints I should respect — libraries, deadlines, things not to touch? Say "skip" if none.',
  checks:
    'Which checks should pass — tests, lint, a manual review? Say "skip" to use the defaults.',
  audience: 'Who is this for? Say "skip" if it does not matter here.',
};

export const FIELD_LABELS: Record<BriefFieldId, string> = {
  goal: 'goal',
  scope: 'scope',
  doneMeans: 'done means',
  constraints: 'constraints',
  checks: 'checks',
  audience: 'audience',
};

// `field: value` prefixes accepted anywhere in a message, one per line.
const FIELD_PREFIXES: ReadonlyArray<readonly [RegExp, BriefFieldId]> = [
  [/^\s*goal\s*:\s*(.+)$/i, 'goal'],
  [/^\s*scope\s*:\s*(.+)$/i, 'scope'],
  [/^\s*(?:done|done means|definition of done)\s*:\s*(.+)$/i, 'doneMeans'],
  [/^\s*constraints?\s*:\s*(.+)$/i, 'constraints'],
  [/^\s*checks?\s*:\s*(.+)$/i, 'checks'],
  [/^\s*audience\s*:\s*(.+)$/i, 'audience'],
];

const SKIP = /^\s*(skip|none|n\/a|no|nothing)\s*[.!]?\s*$/i;
const YES =
  /^\s*(yes|yep|correct|right|confirmed|ok|okay|that's right|thats right)\s*[.!]?\s*$/i;

// The field the coordinator is currently asking about: the first by priority
// that is missing or inferred. Undefined once every required field is
// confirmed/skipped and no optional field is left unasked… except that
// optional fields are only asked while the user keeps answering.
export function pendingField(brief: Brief): BriefFieldId | undefined {
  return FIELD_PRIORITY.find((fieldId) =>
    ['missing', 'inferred'].includes(brief.fields[fieldId].state),
  );
}

export function requiredFieldsSettled(brief: Brief): boolean {
  return BRIEF_REQUIRED_FIELDS.every((fieldId) =>
    ['confirmed', 'skipped', 'corrected'].includes(brief.fields[fieldId].state),
  );
}

export type IntakeUpdate = {
  readonly fieldId: BriefFieldId;
  readonly to: 'inferred' | 'confirmed' | 'skipped' | 'corrected';
  readonly value?: string | undefined;
};

export interface IntakeResult {
  readonly updates: readonly IntakeUpdate[];
  readonly reply: string;
  // True when this message answered the pending question (so the caller
  // knows the note was consumed by intake).
  readonly handled: boolean;
}

// Rules, in order:
//   1. `field: value` lines set those fields (confirmed if it is the pending
//      field, inferred otherwise).
//   2. If the pending field is `inferred`: "yes" confirms it; other text
//      corrects it.
//   3. If the pending field is `missing`: "skip" skips it; other text is the
//      answer, confirmed (the user typed it in reply to the question).
// The reply always ends with the next question, or says the Brief is ready.
export function planIntake(brief: Brief, body: string): IntakeResult {
  const pending = pendingField(brief);
  const updates: IntakeUpdate[] = [];
  const lines = body.split(/\r?\n/);
  for (const line of lines) {
    for (const [pattern, fieldId] of FIELD_PREFIXES) {
      const match = pattern.exec(line);
      if (match?.[1]) {
        const value = match[1].trim();
        const current = brief.fields[fieldId].state;
        updates.push({
          fieldId,
          to:
            fieldId === pending
              ? current === 'inferred'
                ? 'corrected'
                : 'confirmed'
              : current === 'missing' || current === 'skipped'
                ? 'inferred'
                : 'corrected',
          value,
        });
      }
    }
  }
  if (updates.length === 0 && pending) {
    const current = brief.fields[pending];
    if (current.state === 'inferred') {
      if (YES.test(body)) {
        updates.push({
          fieldId: pending,
          to: 'confirmed',
          value: current.value,
        });
      } else if (SKIP.test(body)) {
        updates.push({ fieldId: pending, to: 'skipped' });
      } else {
        updates.push({ fieldId: pending, to: 'corrected', value: body.trim() });
      }
    } else if (SKIP.test(body)) {
      updates.push({ fieldId: pending, to: 'skipped' });
    } else {
      updates.push({ fieldId: pending, to: 'confirmed', value: body.trim() });
    }
  }

  // Project the updates to find the next question.
  const next: Brief = {
    ...brief,
    fields: { ...brief.fields },
  };
  for (const update of updates) {
    next.fields[update.fieldId] = {
      ...next.fields[update.fieldId],
      state: update.to,
      ...(update.value ? { value: update.value } : {}),
    };
  }
  const nextPending = pendingField(next);
  const acknowledged = updates
    .map((update) =>
      update.to === 'skipped'
        ? `${FIELD_LABELS[update.fieldId]} skipped`
        : `${FIELD_LABELS[update.fieldId]} ${update.to === 'inferred' ? 'noted' : 'set'}`,
    )
    .join(', ');
  const prefix = acknowledged ? `${capitalize(acknowledged)}. ` : '';
  if (!nextPending) {
    return {
      updates,
      handled: updates.length > 0,
      reply: `${prefix}The Overview is ready. Tell me what to build and I'll propose a plan, or type straight into an agent pane.`,
    };
  }
  const nextState = next.fields[nextPending];
  const question =
    nextState.state === 'inferred'
      ? `I have ${FIELD_LABELS[nextPending]} as "${nextState.value ?? ''}". Is that right? Say yes, or give me the correction.`
      : FIELD_QUESTIONS[nextPending];
  return {
    updates,
    handled: updates.length > 0,
    reply: `${prefix}${question}`,
  };
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// ---------------------------------------------------------------------------
// Method catalog (fixture). Immutable: a version never changes its content.
// ---------------------------------------------------------------------------

export const METHOD_CATALOG: readonly MethodDefinition[] = [
  {
    id: 'method_careful' as MethodDefinition['id'],
    version: '1.0.0',
    title: 'Careful',
    purpose:
      'Change as little as possible, prove it with the project’s own checks, and leave a clear trail.',
    whenToUse:
      'Code that other people depend on: shared repositories, anything with tests, anything that ships.',
    hardRules: [
      'Read a file before changing it; never guess its contents.',
      'Run the project’s tests (or build) after changing code, before saying it is done.',
      'Do not delete or rewrite files you were not asked to touch.',
      'Ask before any command that installs, deletes, or pushes.',
    ],
    preferences: [
      'Small, reviewable diffs over sweeping rewrites.',
      'One task at a time; finish and verify before starting the next.',
      'Keep existing style, names, and structure.',
    ],
    promptGuidance: [
      'Say what you are about to change and why, in one line, before changing it.',
      'End with what changed and how it was verified — or say plainly that it was not.',
    ],
    skills: [
      'Reading before writing',
      'Minimal diffs',
      'Test-first verification',
    ],
    outputExpectations: ['The changed files', 'The check that proves it'],
    checks: ['Project tests or build pass'],
    scopeRestrictions: [
      'Only files named in the task, or ones it clearly requires.',
    ],
    agentDefaults: { modelTier: 'standard', tools: 'full' },
  },
  {
    id: 'method_fast-prototype' as MethodDefinition['id'],
    version: '1.0.0',
    title: 'Fast prototype',
    purpose: 'Get something working on screen quickly and learn from it.',
    whenToUse: 'Throwaway spikes, demos, and a playground folder.',
    hardRules: [
      'Write whole files; do not spend turns on precise edits.',
      'Never touch persistence, auth, or deployment code.',
      'Note every shortcut you take in the summary.',
    ],
    preferences: [
      'The simplest thing that runs.',
      'Skip checks that do not protect anyone.',
      'Fewer files over more.',
    ],
    promptGuidance: [
      'Do not ask clarifying questions; make a reasonable choice and say which.',
    ],
    skills: ['Quick scaffolding'],
    outputExpectations: ['Something that runs', 'A list of shortcuts taken'],
    checks: [],
    scopeRestrictions: ['New files and the ones the task names.'],
    agentDefaults: { modelTier: 'light', tools: 'basic' },
  },
  {
    id: 'method_docs-only' as MethodDefinition['id'],
    version: '1.0.0',
    title: 'Docs only',
    purpose: 'Explain, document, and plan without changing any code.',
    whenToUse:
      'READMEs, design notes, Plan and Playbook work, reviewing a codebase you do not want touched.',
    hardRules: [
      'Do not change code. Only .md and .txt files may be written.',
      'Do not run commands.',
      'When something in the code should change, write it down as a recommendation instead.',
    ],
    preferences: [
      'Short sentences; headings that answer a question.',
      'Concrete file names and line references over generalities.',
    ],
    promptGuidance: [
      'Read broadly first, then write once.',
      'Keep the Plan document current with what you learn.',
    ],
    skills: ['Technical writing', 'Codebase reading'],
    outputExpectations: ['The document', 'Updated Plan sections'],
    checks: [],
    scopeRestrictions: [
      '*.md and *.txt only; the Plan and Playbook documents.',
    ],
    agentDefaults: { modelTier: 'standard', tools: 'docs' },
  },
];

export function findMethod(
  catalogId: string,
  catalogVersion: string,
): MethodDefinition | undefined {
  return METHOD_CATALOG.find(
    (method) => method.id === catalogId && method.version === catalogVersion,
  );
}

export const BRIEF_FIELD_IDS = BriefFieldIdSchema.options;
