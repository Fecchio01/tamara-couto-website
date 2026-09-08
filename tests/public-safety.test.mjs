import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

test('public property rendering exposes safe text and URL handling', () => {
  const source = fs.readFileSync(new URL('../imoveis-ui.js', import.meta.url), 'utf8');
  const sandbox = {
    window: { location: { href: 'https://tamara.example/' } },
    document: { addEventListener() {} },
    URL,
  };
  vm.runInNewContext(source, sandbox);

  const safety = sandbox.window.propertyContentSafety;
  assert.equal(safety.escapeHtml('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;');
  assert.equal(safety.safeHttpUrl('javascript:alert(1)', true), '');
  assert.equal(safety.safeImageUrl('javascript:alert(1)'), '');
  assert.equal(safety.safeHttpUrl('https://example.test/source', true), 'https://example.test/source');
  assert.doesNotMatch(source, /innerHTML/);
  assert.doesNotMatch(source, /onclick=/);
});
