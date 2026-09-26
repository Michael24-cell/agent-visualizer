import {
  METHOD_SECTION_TITLES,
  PLAN_SECTIONS,
  type MethodSectionId,
  type PlanSectionId,
} from '@harness/contracts';

// Natural-language edits to the two project documents. The coordinator
// applies these immediately (they are cheap to undo by editing again);
// anything that changes tasks or agents still goes through a proposal.
//
// Recognised forms, case-insensitive:
//   features: offline sync; shared lists      → add lines
//   add offline sync to features              → add
//   remove shared lists from features         → remove (substring match)
//   set ui to: one composer; panes side by side → replace
//   clear risks                               → empty the section
// Method sections use the same forms with their own names (rules,
// preferences, guidance, skills, outputs, method checks, scope restrictions).

export type DocumentEdit =
  | {
      readonly document: 'plan';
      readonly sectionId: PlanSectionId;
      readonly op: 'add' | 'remove' | 'set';
      readonly lines: readonly string[];
    }
  | {
      readonly document: 'method';
      readonly sectionId: MethodSectionId;
      readonly op: 'add' | 'remove' | 'set';
      readonly lines: readonly string[];
    };

type SectionRef =
  | { document: 'plan'; sectionId: PlanSectionId }
  | { document: 'method'; sectionId: MethodSectionId };

const PLAN_ALIASES: Record<string, PlanSectionId> = {
  overview: 'overview',
  summary: 'overview',
  features: 'features',
  feature: 'features',
  'feature list': 'features',
  ui: 'ui',
  screens: 'ui',
  interface: 'ui',
  visual: 'visual',
  visuals: 'visual',
  look: 'visual',
  style: 'visual',
  data: 'data',
  storage: 'data',
  risks: 'risks',
  risk: 'risks',
};

const METHOD_ALIASES: Record<string, MethodSectionId> = {
  'hard rules': 'hardRules',
  rules: 'hardRules',
  rule: 'hardRules',
  preferences: 'preferences',
  preference: 'preferences',
  guidance: 'promptGuidance',
  'prompt guidance': 'promptGuidance',
  skills: 'skills',
  skill: 'skills',
  outputs: 'outputExpectations',
  'output expectations': 'outputExpectations',
  // 'checks' and 'scope' alone belong to the Brief's intake prefixes;
  // the Method sections need the qualified names.
  'method checks': 'checks',
  'scope restrictions': 'scopeRestrictions',
  'method scope': 'scopeRestrictions',
};

export { METHOD_SECTION_TITLES };

const SECTION_NAMES = [
  ...Object.keys(PLAN_ALIASES),
  ...Object.keys(METHOD_ALIASES),
]
  .sort((a, b) => b.length - a.length)
  .map((name) => name.replace(/\s+/g, '\\s+'))
  .join('|');

// "the features section", "plan features", "method rules" all name a section.
const SECTION = `(?:the\\s+)?(?:(plan|method)\\s+)?(${SECTION_NAMES})(?:\\s+section)?`;

function resolve(
  qualifier: string | undefined,
  name: string,
): SectionRef | undefined {
  const key = name.toLowerCase().replace(/\s+/g, ' ');
  const plan = PLAN_ALIASES[key];
  const method = METHOD_ALIASES[key];
  if (qualifier?.toLowerCase() === 'method') {
    return method ? { document: 'method', sectionId: method } : undefined;
  }
  if (qualifier?.toLowerCase() === 'plan') {
    return plan ? { document: 'plan', sectionId: plan } : undefined;
  }
  if (plan) return { document: 'plan', sectionId: plan };
  if (method) return { document: 'method', sectionId: method };
  return undefined;
}

function splitLines(text: string): string[] {
  return text
    .split(/\s*(?:;|\n)\s*/)
    .map((line) => line.trim().replace(/[.]+$/, '').trim())
    .filter((line) => line.length > 0);
}

export function parseDocumentEdit(body: string): DocumentEdit | undefined {
  const text = body.trim();
  const forms: readonly [RegExp, DocumentEdit['op'], number, number, number][] =
    [
      // clear <section>
      [
        new RegExp(`^(?:clear|empty)\\s+${SECTION}\\s*[.!]?$`, 'i'),
        'set',
        1,
        2,
        0,
      ],
      // set/replace <section> to|with: <lines>
      [
        new RegExp(
          `^(?:set|replace)\\s+${SECTION}\\s+(?:to|with)\\s*:?\\s*([\\s\\S]+)$`,
          'i',
        ),
        'set',
        1,
        2,
        3,
      ],
      // add <lines> to <section>
      [
        new RegExp(`^add\\s+([\\s\\S]+?)\\s+to\\s+${SECTION}\\s*[.!]?$`, 'i'),
        'add',
        2,
        3,
        1,
      ],
      // remove/drop <lines> from <section>
      [
        new RegExp(
          `^(?:remove|drop|delete)\\s+([\\s\\S]+?)\\s+from\\s+${SECTION}\\s*[.!]?$`,
          'i',
        ),
        'remove',
        2,
        3,
        1,
      ],
      // <section>: <lines>
      [new RegExp(`^${SECTION}\\s*:\\s*([\\s\\S]+)$`, 'i'), 'add', 1, 2, 3],
    ];
  for (const [pattern, op, qualifierIndex, nameIndex, linesIndex] of forms) {
    const match = pattern.exec(text);
    if (!match) continue;
    const ref = resolve(match[qualifierIndex], match[nameIndex]!);
    if (!ref) continue;
    const lines = linesIndex ? splitLines(match[linesIndex] ?? '') : [];
    if (op !== 'set' && lines.length === 0) continue;
    return { ...ref, op, lines };
  }
  return undefined;
}

// The next contents of a section after an edit, and what to tell the user.
export function applyDocumentEdit(
  current: readonly string[],
  edit: DocumentEdit,
): { lines: string[]; reply: string; changed: boolean } {
  const where =
    edit.document === 'plan'
      ? `Plan · ${PLAN_SECTIONS[edit.sectionId].title}`
      : `Method · ${METHOD_SECTION_TITLES[edit.sectionId]}`;
  switch (edit.op) {
    case 'add': {
      const fresh = edit.lines.filter(
        (line) => !current.some((c) => c.toLowerCase() === line.toLowerCase()),
      );
      if (fresh.length === 0) {
        return {
          lines: [...current],
          reply: `${where} already has that.`,
          changed: false,
        };
      }
      return {
        lines: [...current, ...fresh],
        reply: `Added to ${where}: ${fresh.join('; ')}.`,
        changed: true,
      };
    }
    case 'remove': {
      const needles = edit.lines.map((line) => line.toLowerCase());
      const kept = current.filter(
        (line) =>
          !needles.some((needle) => line.toLowerCase().includes(needle)),
      );
      if (kept.length === current.length) {
        return {
          lines: [...current],
          reply: `Nothing in ${where} matches "${edit.lines.join('; ')}".`,
          changed: false,
        };
      }
      const removed = current.filter((line) => !kept.includes(line));
      return {
        lines: kept,
        reply: `Removed from ${where}: ${removed.join('; ')}.`,
        changed: true,
      };
    }
    case 'set': {
      const unchanged =
        current.length === edit.lines.length &&
        current.every((line, index) => line === edit.lines[index]);
      if (unchanged) {
        return {
          lines: [...current],
          reply: `${where} already reads that way.`,
          changed: false,
        };
      }
      return {
        lines: [...edit.lines],
        reply:
          edit.lines.length === 0
            ? `Cleared ${where}.`
            : `${where} now reads: ${edit.lines.join('; ')}.`,
        changed: true,
      };
    }
  }
}

// ---------------------------------------------------------------------------
// From a work request to the Plan document. Keyword-level: enough for the
// simulator to leave a plan that reads like the request; live models write
// the real thing through their tools.
// ---------------------------------------------------------------------------

const FEATURE_SPLIT =
  /\s*(?:,|;|[.!?](?=\s|$)|\band\b|\bthen\b|\bplus\b|\bwith\b)\s*/i;
const LEADING_VERBS =
  /^(?:please\s+)?(?:build|create|make|add|implement|write|set up|setup|ship|design)?\s*(?:a|an|the|me)?\s+/i;

// A go-ahead is not a feature. "Just do it: build a login page" should
// leave "Build a login page" in the Plan.
const LEADING_GO_AHEAD =
  /^(?:just do it|go ahead|no need to confirm)\s*[:,-]\s*/i;

function sentenceCase(text: string): string {
  const trimmed = text.trim().replace(/[.!]+$/, '');
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

// The first sentence of the request, as the project's one-line overview.
export function overviewFromRequest(body: string): string {
  const text = body.trim().replace(LEADING_GO_AHEAD, '');
  const first = text.split(/(?<=[.!?])\s+/)[0] ?? text;
  return sentenceCase(first).slice(0, 140);
}

// Feature lines from a request: its comma/"and"/"then" parts, each with
// the leading "build a"/"add" stripped. Short fragments are dropped.
export function featuresFromRequest(body: string): string[] {
  const seen = new Set<string>();
  const features: string[] = [];
  for (const part of body.replace(LEADING_GO_AHEAD, '').split(FEATURE_SPLIT)) {
    const line = sentenceCase(part.replace(LEADING_VERBS, ''));
    if (line.length < 4 || line.split(/\s+/).length < 2) continue;
    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    features.push(line);
    if (features.length >= 6) break;
  }
  return features;
}

const SECTION_HINTS: Record<PlanSectionId, readonly string[]> = {
  overview: [],
  features: [],
  ui: [
    'ui',
    'screen',
    'page',
    'form',
    'button',
    'layout',
    'interface',
    'component',
    'view',
    'modal',
    'menu',
  ],
  visual: [
    'visual',
    'theme',
    'color',
    'colour',
    'font',
    'style',
    'icon',
    'logo',
    'dark mode',
  ],
  data: [
    'data',
    'database',
    'db',
    'schema',
    'storage',
    'store',
    'api',
    'endpoint',
    'sync',
    'cache',
    'migration',
    'model',
    'service',
    'server',
    'backend',
    'session',
    'queue',
  ],
  risks: ['risk', 'security', 'auth', 'permission', 'privacy', 'backup'],
};

// Which Plan sections a piece of text is about, by its words.
export function sectionsForText(text: string): PlanSectionId[] {
  const lower = ` ${text.toLowerCase()} `;
  const hits = (Object.keys(SECTION_HINTS) as PlanSectionId[]).filter((id) =>
    SECTION_HINTS[id].some(
      (hint) => lower.includes(` ${hint}`) || lower.includes(`${hint} `),
    ),
  );
  return hits;
}
