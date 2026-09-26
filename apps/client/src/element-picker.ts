// The picker that runs inside an HTML artifact preview. It is injected
// into the iframe's srcDoc and runs in a sandbox without same-origin
// access, so it can only talk back through postMessage. Everything it
// sends is treated as untrusted text by the pane.

export const PICKER_MESSAGE = 'harness:element-picked';

const SCRIPT = `
(() => {
  const MAX = 4;
  let last = null;
  const style = document.createElement('style');
  style.textContent =
    '.harness-pick-outline{outline:2px solid #e6cf98 !important;outline-offset:1px !important;cursor:crosshair !important}';
  document.documentElement.appendChild(style);

  // A short, readable path: #id wins, else tag with nth-of-type.
  function selectorFor(element) {
    const parts = [];
    let node = element;
    while (node && node.nodeType === 1 && parts.length < MAX) {
      const tag = node.tagName.toLowerCase();
      if (tag === 'body' || tag === 'html') break;
      if (node.id) {
        parts.unshift('#' + node.id);
        break;
      }
      const parent = node.parentElement;
      if (!parent) {
        parts.unshift(tag);
        break;
      }
      const siblings = [...parent.children].filter(
        (child) => child.tagName === node.tagName,
      );
      parts.unshift(
        siblings.length > 1
          ? tag + ':nth-of-type(' + (siblings.indexOf(node) + 1) + ')'
          : tag,
      );
      node = parent;
    }
    return parts.join(' > ') || 'body';
  }

  document.addEventListener(
    'mouseover',
    (event) => {
      if (last) last.classList.remove('harness-pick-outline');
      last = event.target;
      if (last && last.classList) last.classList.add('harness-pick-outline');
    },
    true,
  );

  document.addEventListener(
    'click',
    (event) => {
      event.preventDefault();
      event.stopPropagation();
      const element = event.target;
      if (!element || element.nodeType !== 1) return;
      const clone = element.cloneNode(true);
      clone.classList && clone.classList.remove('harness-pick-outline');
      parent.postMessage(
        {
          type: '${PICKER_MESSAGE}',
          selector: selectorFor(element),
          tag: element.tagName.toLowerCase(),
          text: (element.textContent || '').trim().slice(0, 300),
          html: (clone.outerHTML || '').slice(0, 2000),
        },
        '*',
      );
    },
    true,
  );
})();
`;

// The page with the picker inside it. Kept as a string so the iframe can
// stay sandboxed without same-origin access.
export function withPicker(html: string): string {
  // Split so the closing tag cannot end the page's own script block.
  const script = `<script>${SCRIPT}</scr` + `ipt>`;
  return /<\/body\s*>/i.test(html)
    ? html.replace(/<\/body\s*>/i, `${script}</body>`)
    : `${html}${script}`;
}

export interface PickedElement {
  readonly selector: string;
  readonly tag: string;
  readonly text: string;
  readonly html: string;
}

// Reads a message from the preview, or nothing when it is not one.
export function readPickedElement(data: unknown): PickedElement | undefined {
  if (!data || typeof data !== 'object') return undefined;
  const record = data as Record<string, unknown>;
  if (record.type !== PICKER_MESSAGE) return undefined;
  const text = (value: unknown, max: number) =>
    typeof value === 'string' ? value.slice(0, max) : '';
  const selector = text(record.selector, 300);
  if (!selector) return undefined;
  return {
    selector,
    tag: text(record.tag, 40),
    text: text(record.text, 300),
    html: text(record.html, 2_000),
  };
}
