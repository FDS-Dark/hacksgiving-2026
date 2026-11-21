import { describe, expect, it } from '@jest/globals';

import { ESCAPE_HTML_JS, safeJson } from '@/lib/leaflet';

describe('ESCAPE_HTML_JS', () => {
  it('is valid JavaScript that escapes popup text', () => {
    const escapeHtml = new Function(`${ESCAPE_HTML_JS}; return escapeHtml;`)() as (text: string) => string;
    expect(escapeHtml(`<b onclick="x">Tom & Jerry's</b>`)).toBe('&lt;b onclick=&quot;x&quot;&gt;Tom &amp; Jerry&#39;s&lt;/b&gt;');
  });
});

describe('safeJson', () => {
  it('cannot close the script tag it is inlined in', () => {
    expect(safeJson({ label: '</script><script>alert(1)</script>' })).not.toContain('</script>');
    expect(JSON.parse(safeJson({ a: 'x & y' }))).toEqual({ a: 'x & y' });
  });
});
