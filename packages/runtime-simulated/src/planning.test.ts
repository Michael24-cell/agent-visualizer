import { describe, expect, it } from 'vitest';
import { featuresFromRequest } from './documents.js';
import { planFromPlanFeatures, planFromRequest } from './planning.js';

// A plan a person will approve is one written in their own words. These
// tests hold the coordinator to the Plan document's Features lines.

describe('planFromPlanFeatures', () => {
  it('names each task after the Features lines it delivers', () => {
    const plan = planFromPlanFeatures([
      'A recipe list with photos',
      'A detail page for one recipe',
      'Save recipes to the database',
    ])!;
    expect(plan.tasks).toHaveLength(2);
    expect(plan.tasks[0]).toMatchObject({
      title: 'A recipe list with photos, a detail page for one recipe',
      agentName: 'Interface systems',
      dependsOn: [],
    });
    expect(plan.tasks[0]!.objective).toBe(
      "From the Plan's Features:\n- A recipe list with photos\n- A detail page for one recipe",
    );
    expect(plan.tasks[1]).toMatchObject({
      title: 'Save recipes to the database',
      agentName: 'Backend orchestration',
      dependsOn: [0],
    });
    expect(plan.tasks[1]!.sections).toContain('data');
    expect(plan.whyThisMany).toContain('2 visible lines');
  });

  it('gives one owner to a request that is all one surface', () => {
    const plan = planFromPlanFeatures([
      'A recipe list with photos',
      'A detail page for one recipe',
    ])!;
    expect(plan.tasks).toHaveLength(1);
    expect(plan.tasks[0]).toMatchObject({
      agentName: 'Interface systems',
      objective: expect.stringContaining('A detail page for one recipe'),
    });
    expect(plan.whyThisMany).toContain('One owner');
  });

  it('keeps a long line readable and says how many it stands for', () => {
    const lines = [
      'A'.repeat(180),
      'A second line',
      'A third line',
      'A fourth line',
    ];
    const plan = planFromPlanFeatures(lines)!;
    const title = plan.tasks[0]!.title;
    expect(title.length).toBeLessThanOrEqual(200);
    expect(title.endsWith('+1 more')).toBe(true);
    expect(plan.tasks[0]!.objective).toContain('A fourth line');
  });

  it('has nothing to say without Features lines', () => {
    expect(planFromPlanFeatures([])).toBeUndefined();
    expect(planFromPlanFeatures(['  '])).toBeUndefined();
  });

  it('collapses to one owner when asked, keeping both checks', () => {
    const plan = planFromPlanFeatures(
      ['A recipe list', 'Save recipes to the database'],
      { single: true },
    )!;
    expect(plan.tasks).toHaveLength(1);
    expect(plan.tasks[0]!.requiredChecks).toEqual([
      'contract-check',
      'experience-check',
    ]);
    expect(plan.tasks[0]!.modelTier).toBe('deep');
  });
});

describe('planFromRequest', () => {
  it('prefers the Plan document over its own templates', () => {
    const body = 'Build a recipe box with a list and store it in the database.';
    const features = featuresFromRequest(body);
    const named = planFromRequest(body, { features });
    expect(named.tasks.map((task) => task.title)).toEqual(
      planFromPlanFeatures(features)!.tasks.map((task) => task.title),
    );
    expect(named.tasks[0]!.title).not.toContain('Define the');
  });

  it('falls back to the templates when the Plan is empty', () => {
    const plan = planFromRequest('Build a recipe box.');
    expect(plan.tasks[0]!.title).toBe('Define the recipe box experience');
  });
});
