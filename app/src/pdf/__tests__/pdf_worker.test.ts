import { describe, it } from 'node:test';
import assert from 'node:assert';
import { PDF_WORKER_HTML } from '../pdfWorkerHtml';

describe('PDF Worker HTML bundle', () => {
  it('exports a valid, non-empty HTML string', () => {
    assert.strictEqual(typeof PDF_WORKER_HTML, 'string');
    assert.ok(PDF_WORKER_HTML.length > 500_000, 'HTML bundle should be >500KB with inlined pdf.js');
    assert.ok(PDF_WORKER_HTML.startsWith('<!DOCTYPE html>'));
  });

  it('contains essential pdf.js and worker components', () => {
    assert.ok(PDF_WORKER_HTML.includes('render-canvas'), 'Should have a canvas element for image rendering');
    assert.ok(PDF_WORKER_HTML.includes('pdfjsLib'), 'Should include pdfjsLib runtime');
    assert.ok(PDF_WORKER_HTML.includes('_mainThreadWorkerMessageHandler'), 'Should hook main thread worker');
    assert.ok(PDF_WORKER_HTML.includes('ReactNativeWebView'), 'Should contain React Native WebView bridge');
  });

  it('contains text extraction and 200 non-space char threshold (AGENTS.md §4)', () => {
    assert.ok(PDF_WORKER_HTML.includes('nonSpaceChars > 200'), 'Must check >200 non-space characters');
    assert.ok(PDF_WORKER_HTML.includes("toDataURL('image/jpeg', 0.8)"), 'Must render scanned pages to JPEG 0.8');
    assert.ok(PDF_WORKER_HTML.includes('targetMaxDim = longEdge || 1600'), 'Must scale long edge to the given size, default ~1600px');
  });

  it('properly handles chunked PDF loading', () => {
    assert.ok(PDF_WORKER_HTML.includes('loadPdf'), 'Must handle loadPdf command');
    assert.ok(PDF_WORKER_HTML.includes('pdfChunk'), 'Must handle pdfChunk command');
    assert.ok(PDF_WORKER_HTML.includes('getPage'), 'Must handle getPage command');
  });
});
