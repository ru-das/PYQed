import React, {
  forwardRef,
  useImperativeHandle,
  useRef,
  useCallback,
  useState,
  useEffect,
} from 'react';
import { View, StyleSheet } from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import { PDF_WORKER_HTML } from './pdfWorkerHtml';

export type PageResult =
  | { type: 'text'; text: string; base64?: string }
  | { type: 'image'; base64: string };

export type PdfWorkerHandle = {
  loadPdf: (base64: string) => Promise<{ pageCount: number }>;
  getPage: (pageNumber: number) => Promise<PageResult>;
};

export type PdfWorkerProps = {
  onReady?: () => void;
  onError?: (error: string) => void;
};

const CHUNK_SIZE = 512 * 1024; // 512 KB chunks for large base64 strings

export const PdfWorker = forwardRef<PdfWorkerHandle, PdfWorkerProps>(
  function PdfWorker({ onReady, onError }, ref) {
    const webViewRef = useRef<WebView>(null);
    const [isReady, setIsReady] = useState(false);
    const readyResolvers = useRef<Array<() => void>>([]);

    // Promise handlers for pending operations
    const loadPromiseRef = useRef<{
      resolve: (val: { pageCount: number }) => void;
      reject: (err: Error) => void;
    } | null>(null);

    const pagePromisesRef = useRef<
      Map<
        number,
        {
          resolve: (val: PageResult) => void;
          reject: (err: Error) => void;
        }
      >
    >(new Map());

    const waitForReady = useCallback((): Promise<void> => {
      if (isReady) return Promise.resolve();
      return new Promise<void>((resolve) => {
        readyResolvers.current.push(resolve);
      });
    }, [isReady]);

    const postToWebView = useCallback((payload: unknown) => {
      if (webViewRef.current) {
        webViewRef.current.postMessage(JSON.stringify(payload));
      }
    }, []);

    const handleMessage = useCallback(
      (event: WebViewMessageEvent) => {
        let msg: any;
        try {
          msg = JSON.parse(event.nativeEvent.data);
        } catch {
          return;
        }

        switch (msg.type) {
          case 'ready': {
            setIsReady(true);
            readyResolvers.current.forEach((resolve) => resolve());
            readyResolvers.current = [];
            onReady?.();
            break;
          }

          case 'loaded': {
            if (loadPromiseRef.current) {
              loadPromiseRef.current.resolve({ pageCount: msg.pageCount });
              loadPromiseRef.current = null;
            }
            break;
          }

          case 'loadError': {
            const err = new Error(msg.error || 'Failed to load PDF');
            if (loadPromiseRef.current) {
              loadPromiseRef.current.reject(err);
              loadPromiseRef.current = null;
            }
            onError?.(err.message);
            break;
          }

          case 'pageResult': {
            const handler = pagePromisesRef.current.get(msg.pageNumber);
            if (handler) {
              handler.resolve(msg.result);
              pagePromisesRef.current.delete(msg.pageNumber);
            }
            break;
          }

          case 'pageError': {
            const handler = pagePromisesRef.current.get(msg.pageNumber);
            const err = new Error(msg.error || `Failed to process page ${msg.pageNumber}`);
            if (handler) {
              handler.reject(err);
              pagePromisesRef.current.delete(msg.pageNumber);
            }
            break;
          }
        }
      },
      [onReady, onError]
    );

    useImperativeHandle(
      ref,
      () => ({
        loadPdf: async (base64: string): Promise<{ pageCount: number }> => {
          await waitForReady();

          return new Promise<{ pageCount: number }>((resolve, reject) => {
            loadPromiseRef.current = { resolve, reject };

            const isLarge = base64.length > CHUNK_SIZE;
            if (!isLarge) {
              postToWebView({
                type: 'loadPdf',
                chunked: false,
                data: base64,
              });
            } else {
              postToWebView({
                type: 'loadPdf',
                chunked: true,
              });

              const totalChunks = Math.ceil(base64.length / CHUNK_SIZE);
              for (let i = 0; i < totalChunks; i++) {
                const chunk = base64.substring(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
                postToWebView({
                  type: 'pdfChunk',
                  index: i,
                  chunk,
                  isLast: i === totalChunks - 1,
                });
              }
            }
          });
        },

        getPage: async (pageNumber: number): Promise<PageResult> => {
          await waitForReady();

          return new Promise<PageResult>((resolve, reject) => {
            pagePromisesRef.current.set(pageNumber, { resolve, reject });
            postToWebView({
              type: 'getPage',
              pageNumber,
            });
          });
        },
      }),
      [waitForReady, postToWebView]
    );

    return (
      <View style={styles.hiddenContainer} pointerEvents="none">
        <WebView
          ref={webViewRef}
          source={{ html: PDF_WORKER_HTML }}
          onMessage={handleMessage}
          originWhitelist={['*']}
          javaScriptEnabled
          domStorageEnabled
          allowFileAccess
          allowFileAccessFromFileURLs
          allowUniversalAccessFromFileURLs
          style={styles.hiddenWebView}
        />
      </View>
    );
  }
);

const styles = StyleSheet.create({
  hiddenContainer: {
    width: 0,
    height: 0,
    opacity: 0,
    position: 'absolute',
    left: -1000,
    top: -1000,
    overflow: 'hidden',
  },
  hiddenWebView: {
    width: 10,
    height: 10,
  },
});
