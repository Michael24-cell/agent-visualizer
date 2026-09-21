import { describe, expect, it } from 'vitest';
import {
  applyDocumentEdit,
  featuresFromRequest,
  overviewFromRequest,
  parseDocumentEdit,
  sectionsForText,
} from './documents.js';

describe('parseDocumentEdit', () => {
  it('reads the section-colon form into plan and method sections', () => {
    expect(parseDocumentEdit('features: offline sync; shared lists')).toEqual({
      document: 'plan',
      sectionId: 'features',
      op: 'add',
      lines: ['offline sync', 'shared lists'],
    });
    expect(parseDocumentEdit('UI: keep the composer at the bottom.')).toEqual({
      document: 'plan',
      sectionId: 'ui',
      op: 'add',
      lines: ['keep the composer at the bottom'],
    });
    expect(parseDocumentEdit('hard rules: never push to main')).toEqual({
      document: 'method',
      sectionId: 'hardRules',
      op: 'add',
      lines: ['never push to main'],
    });
    expect(parseDocumentEdit('Feature list: dark mode')).toMatchObject({
      sectionId: 'features',
    });
  });

  it('reads add, remove, set and clear forms with optional qualifiers', () => {
    expect(parseDocumentEdit('add dark mode to the features section')).toEqual({
      document: 'plan',
      sectionId: 'features',
      op: 'add',
      lines: ['dark mode'],
    });
    expect(parseDocumentEdit('remove dark mode from features')).toEqual({
      document: 'plan',
      sectionId: 'features',
      op: 'remove',
      lines: ['dark mode'],
    });
    expect(
      parseDocumentEdit('set visual to: charcoal theme; soft gold accent'),
    ).toEqual({
      document: 'plan',
      sectionId: 'visual',
      op: 'set',
      lines: ['charcoal theme', 'soft gold accent'],
    });
    expect(parseDocumentEdit('clear risks')).toEqual({
      document: 'plan',
      sectionId: 'risks',
      op: 'set',
      lines: [],
    });
    expect(parseDocumentEdit('add run vitest to method checks')).toEqual({
      document: 'method',
      sectionId: 'checks',
      op: 'add',
      lines: ['run vitest'],
    });
    expect(parseDocumentEdit('add x to plan scope')).toBeUndefined();
    // Brief intake owns the bare "scope:" and "checks:" prefixes.
    expect(parseDocumentEdit('scope: apps/client')).toBeUndefined();
    expect(parseDocumentEdit('checks: vitest')).toBeUndefined();
    expect(
      parseDocumentEdit('scope restrictions: apps/client only'),
    ).toMatchObject({ document: 'method', sectionId: 'scopeRestrictions' });
  });

  it('leaves ordinary conversation alone', () => {
    expect(parseDocumentEdit('What features do we have?')).toBeUndefined();
    expect(parseDocumentEdit('Build a settings page')).toBeUndefined();
    expect(parseDocumentEdit('add to features')).toBeUndefined();
    expect(parseDocumentEdit('features:')).toBeUndefined();
  });
});

describe('applyDocumentEdit', () => {
  const edit = (op: 'add' | 'remove' | 'set', lines: string[]) =>
    ({ document: 'plan', sectionId: 'features', op, lines }) as const;

  it('adds only new lines, removes by substring, sets, and reports no-ops', () => {
    expect(
      applyDocumentEdit(
        ['Offline sync'],
        edit('add', ['offline sync', 'Shared lists']),
      ),
    ).toEqual({
      lines: ['Offline sync', 'Shared lists'],
      reply: 'Added to Plan · Features: Shared lists.',
      changed: true,
    });
    expect(
      applyDocumentEdit(['Offline sync'], edit('add', ['offline sync'])),
    ).toMatchObject({
      changed: false,
      reply: 'Plan · Features already has that.',
    });
    expect(
      applyDocumentEdit(
        ['Offline sync', 'Shared lists'],
        edit('remove', ['shared']),
      ),
    ).toEqual({
      lines: ['Offline sync'],
      reply: 'Removed from Plan · Features: Shared lists.',
      changed: true,
    });
    expect(
      applyDocumentEdit(['Offline sync'], edit('remove', ['dark'])),
    ).toMatchObject({
      changed: false,
      reply: 'Nothing in Plan · Features matches "dark".',
    });
    expect(applyDocumentEdit(['a'], edit('set', ['b', 'c']))).toMatchObject({
      lines: ['b', 'c'],
      reply: 'Plan · Features now reads: b; c.',
    });
    expect(applyDocumentEdit(['a'], edit('set', []))).toMatchObject({
      lines: [],
      reply: 'Cleared Plan · Features.',
    });
    expect(applyDocumentEdit(['a'], edit('set', ['a']))).toMatchObject({
      changed: false,
    });
  });
});

describe('request to plan document', () => {
  it('takes an overview and feature lines out of a request', () => {
    const body =
      'Build a shared grocery list with offline sync, shared lists between household members and a dark mode. Keep it simple.';
    expect(overviewFromRequest(body)).toBe(
      'Build a shared grocery list with offline sync, shared lists between household members and a dark mode',
    );
    expect(featuresFromRequest(body)).toEqual([
      'Shared grocery list',
      'Offline sync',
      'Shared lists between household members',
      'Dark mode',
      'Keep it simple',
    ]);
    expect(featuresFromRequest('add x')).toEqual([]);
  });

  it('maps text to the plan sections it is about', () => {
    expect(
      sectionsForText('Add a settings page with a preferences form'),
    ).toEqual(['ui']);
    expect(
      sectionsForText('Store the cache in the database and sync it'),
    ).toEqual(['data']);
    expect(sectionsForText('Auth screen colours')).toEqual([
      'ui',
      'visual',
      'risks',
    ]);
    expect(sectionsForText('do the thing')).toEqual([]);
  });
});
