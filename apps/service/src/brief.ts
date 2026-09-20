import { createHash } from 'node:crypto';
import {
  BriefFieldIdSchema,
  type Brief,
  type BriefFieldId,
  type Project,
} from '@harness/contracts';

const headings: Record<BriefFieldId, string> = {
  goal: 'Goal',
  scope: 'Scope',
  constraints: 'Constraints',
  doneMeans: 'Done means',
  checks: 'Checks',
  audience: 'Audience',
};

// The one Markdown rendering of a Brief. Deterministic: the same brief
// always renders to the same bytes, so the digest is stable across restarts.
export function renderBrief(
  project: Project,
  brief: Brief,
): { markdown: string; digest: string } {
  const lines: string[] = [`# ${project.name}`, ''];
  for (const fieldId of BriefFieldIdSchema.options) {
    const field = brief.fields[fieldId];
    lines.push(`## ${headings[fieldId]}`, '');
    if (field.state === 'skipped') lines.push('_Skipped._', '');
    else if (field.state === 'missing' || !field.value)
      lines.push('_Not yet decided._', '');
    else {
      const note =
        field.state === 'inferred' ? ' _(inferred, unconfirmed)_' : '';
      lines.push(`${field.value}${note}`, '');
    }
  }
  if (brief.requests.length) {
    lines.push('## Requests', '');
    for (const request of brief.requests) {
      lines.push(`- ${request.category}: ${request.text}`);
    }
    lines.push('');
  }
  const markdown = lines.join('\n');
  return {
    markdown,
    digest: `sha256:${createHash('sha256').update(markdown).digest('hex')}`,
  };
}
