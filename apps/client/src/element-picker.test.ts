import { describe, expect, it } from 'vitest';
import {
  PICKER_MESSAGE,
  readPickedElement,
  withPicker,
} from './element-picker';

describe('withPicker', () => {
  it('injects the picker before </body>, or appends it', () => {
    const page = withPicker('<html><body><h1>Hi</h1></body></html>');
    expect(page).toContain('<h1>Hi</h1><script>');
    expect(page.endsWith('</body></html>')).toBe(true);
    expect(withPicker('<h1>Hi</h1>')).toMatch(/<h1>Hi<\/h1><script>/);
  });
});

describe('readPickedElement', () => {
  it('accepts a well-formed message and clips it', () => {
    expect(
      readPickedElement({
        type: PICKER_MESSAGE,
        selector: 'main > h1',
        tag: 'h1',
        text: 'Hello',
        html: '<h1>Hello</h1>',
      }),
    ).toEqual({
      selector: 'main > h1',
      tag: 'h1',
      text: 'Hello',
      html: '<h1>Hello</h1>',
    });
    const long = readPickedElement({
      type: PICKER_MESSAGE,
      selector: 'a'.repeat(500),
      html: 'b'.repeat(5_000),
    })!;
    expect(long.selector).toHaveLength(300);
    expect(long.html).toHaveLength(2_000);
    expect(long.text).toBe('');
  });

  it('ignores anything else the frame sends', () => {
    expect(readPickedElement(undefined)).toBeUndefined();
    expect(readPickedElement('hi')).toBeUndefined();
    expect(
      readPickedElement({ type: 'other', selector: 'h1' }),
    ).toBeUndefined();
    expect(readPickedElement({ type: PICKER_MESSAGE })).toBeUndefined();
  });
});
