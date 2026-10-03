const fs = require('fs');
const path = require('path');

const appDir = path.resolve(__dirname, '..');
const pdfJsPath = path.join(appDir, 'node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.min.js');
const pdfWorkerPath = path.join(appDir, 'node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.worker.min.js');

if (!fs.existsSync(pdfJsPath) || !fs.existsSync(pdfWorkerPath)) {
  console.error('Error: pdfjs-dist legacy files not found at', pdfJsPath);
  process.exit(1);
}

const pdfJs = fs.readFileSync(pdfJsPath, 'utf8').replace(/<\/script/gi, '<\\/script');
const pdfWorker = fs.readFileSync(pdfWorkerPath, 'utf8').replace(/<\/script/gi, '<\\/script');

const clientLogic = `
(function() {
  function sendToApp(msg) {
    try {
      var str = JSON.stringify(msg);
      if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
        window.ReactNativeWebView.postMessage(str);
      }
    } catch (e) {
      console.error('sendToApp error:', e);
    }
  }

  // Ensure pdfjsWorker is globally assigned
  window.pdfjsWorker = window.pdfjsWorker || window['pdfjs-dist/build/pdf.worker'];

  if (window.pdfjsLib && window.pdfjsWorker) {
    try {
      window.pdfjsLib.PDFWorker._mainThreadWorkerMessageHandler = window.pdfjsWorker.WorkerMessageHandler;
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = '';
    } catch (e) {
      console.error('Failed to configure PDFWorker:', e);
    }
  }

  var currentPdfDoc = null;
  var chunks = [];

  function base64ToUint8Array(base64) {
    var raw = window.atob(base64);
    var rawLength = raw.length;
    var array = new Uint8Array(new ArrayBuffer(rawLength));
    for (var i = 0; i < rawLength; i++) {
      array[i] = raw.charCodeAt(i);
    }
    return array;
  }

  function handleLoadPdf(base64Data) {
    try {
      var uint8Array = base64ToUint8Array(base64Data);
      var loadingTask = window.pdfjsLib.getDocument({
        data: uint8Array,
        cMapUrl: null,
        cMapPacked: true,
      });

      loadingTask.promise.then(function(doc) {
        currentPdfDoc = doc;
        sendToApp({ type: 'loaded', pageCount: doc.numPages });
      }).catch(function(err) {
        sendToApp({ type: 'loadError', error: err && err.message ? err.message : String(err) });
      });
    } catch (err) {
      sendToApp({ type: 'loadError', error: err && err.message ? err.message : String(err) });
    }
  }

  async function handleGetPage(pageNumber) {
    if (!currentPdfDoc) {
      sendToApp({ type: 'pageError', pageNumber: pageNumber, error: 'No PDF loaded' });
      return;
    }

    try {
      var page = await currentPdfDoc.getPage(pageNumber);

      // 1. Text extraction attempt (AGENTS.md §4: real text layer if >200 non-space characters)
      var textContent = await page.getTextContent();
      var rawText = '';
      for (var i = 0; i < textContent.items.length; i++) {
        var item = textContent.items[i];
        if (item && item.str) {
          rawText += item.str;
          if (item.hasEOL) {
            rawText += '\\n';
          } else {
            rawText += ' ';
          }
        }
      }

      var nonSpaceChars = rawText.replace(/\\s/g, '').length;
      if (nonSpaceChars > 200) {
        sendToApp({
          type: 'pageResult',
          pageNumber: pageNumber,
          result: {
            type: 'text',
            text: rawText.trim()
          }
        });
        return;
      }

      // 2. Scanned / image page fallback (render to canvas ~1600px long edge, JPEG 0.8)
      var unscaledViewport = page.getViewport({ scale: 1.0 });
      var origWidth = unscaledViewport.width;
      var origHeight = unscaledViewport.height;
      var maxDim = Math.max(origWidth, origHeight);
      var targetMaxDim = 1600;
      var scale = 1.0;
      if (maxDim > 0) {
        scale = targetMaxDim / maxDim;
      }

      var viewport = page.getViewport({ scale: scale });
      var canvas = document.getElementById('render-canvas');
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      var ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      var renderContext = {
        canvasContext: ctx,
        viewport: viewport
      };

      await page.render(renderContext).promise;

      var dataUrl = canvas.toDataURL('image/jpeg', 0.8);
      var commaIdx = dataUrl.indexOf(',');
      var imgBase64 = commaIdx >= 0 ? dataUrl.substring(commaIdx + 1) : dataUrl;

      sendToApp({
        type: 'pageResult',
        pageNumber: pageNumber,
        result: {
          type: 'image',
          base64: imgBase64
        }
      });
    } catch (err) {
      sendToApp({
        type: 'pageError',
        pageNumber: pageNumber,
        error: err && err.message ? err.message : String(err)
      });
    }
  }

  function handleMessage(event) {
    var rawData = event.data;
    if (!rawData) return;
    var msg;
    try {
      msg = typeof rawData === 'string' ? JSON.parse(rawData) : rawData;
    } catch (e) {
      return;
    }

    if (msg.type === 'loadPdf') {
      chunks = [];
      if (msg.chunked) {
        sendToApp({ type: 'waitingChunks' });
      } else {
        handleLoadPdf(msg.data);
      }
    } else if (msg.type === 'pdfChunk') {
      chunks[msg.index] = msg.chunk;
      if (msg.isLast) {
        var completeBase64 = chunks.join('');
        chunks = [];
        handleLoadPdf(completeBase64);
      }
    } else if (msg.type === 'getPage') {
      handleGetPage(msg.pageNumber);
    }
  }

  window.addEventListener('message', handleMessage);
  document.addEventListener('message', handleMessage);

  sendToApp({ type: 'ready' });
})();
`.replace(/<\/script/gi, '<\\/script');

const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    html, body { margin: 0; padding: 0; background: #000; overflow: hidden; }
    canvas { display: none; }
  </style>
</head>
<body>
  <canvas id="render-canvas"></canvas>
  <script>${pdfWorker}<\/script>
  <script>window.pdfjsWorker = window.pdfjsWorker || window['pdfjs-dist/build/pdf.worker'];<\/script>
  <script>${pdfJs}<\/script>
  <script>${clientLogic}<\/script>
</body>
</html>`;

const outDir = path.join(appDir, 'src', 'pdf');
if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

const tsContent = `// Auto-generated by scripts/generate-pdf-worker-html.js — DO NOT EDIT
// Bundles pdf.js 3.11.174 (legacy build) inlined for offline use without CDN.

export const PDF_WORKER_HTML: string = ${JSON.stringify(html)};
`;

fs.writeFileSync(path.join(outDir, 'pdfWorkerHtml.ts'), tsContent, 'utf8');
console.log('Successfully generated app/src/pdf/pdfWorkerHtml.ts');
