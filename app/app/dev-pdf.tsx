import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  Alert,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { Ionicons } from '@expo/vector-icons';
import {
  useThemeColors,
  Spacing,
  FontSize,
  BorderRadius,
} from '../src/theme';
import { PdfWorker, PdfWorkerHandle } from '../src/pdf/PdfWorker';
import {
  processPdf,
  ProcessPdfResult,
  ProcessPdfProgress,
} from '../src/pdf/processPdf';

export default function DevPdfScreen() {
  const colors = useThemeColors();
  const workerRef = useRef<PdfWorkerHandle>(null);

  const [workerReady, setWorkerReady] = useState(false);
  const [selectedFile, setSelectedFile] = useState<{
    name: string;
    size?: number;
    uri: string;
  } | null>(null);

  const [isProcessing, setIsProcessing] = useState(false);
  const [progressInfo, setProgressInfo] = useState<string>('');
  const [elapsedMs, setElapsedMs] = useState(0);
  const [pdfResult, setPdfResult] = useState<ProcessPdfResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handlePickPdf = async () => {
    try {
      const docResult = await DocumentPicker.getDocumentAsync({
        type: 'application/pdf',
        copyToCacheDirectory: true,
      });

      if (docResult.canceled || !docResult.assets || docResult.assets.length === 0) {
        return;
      }

      const asset = docResult.assets[0];
      setSelectedFile({
        name: asset.name,
        size: asset.size,
        uri: asset.uri,
      });

      setPdfResult(null);
      setErrorMessage(null);
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Failed to select PDF file');
    }
  };

  const handleRunProcessing = async () => {
    if (!selectedFile) {
      Alert.alert('No PDF Selected', 'Please pick a PDF file first.');
      return;
    }

    if (!workerRef.current) {
      Alert.alert('Worker Not Ready', 'PDF worker is initializing. Please wait a moment.');
      return;
    }

    setIsProcessing(true);
    setPdfResult(null);
    setErrorMessage(null);
    setElapsedMs(0);
    setProgressInfo('Reading PDF file...');

    const startTs = Date.now();
    const timer = setInterval(() => {
      setElapsedMs(Date.now() - startTs);
    }, 100);

    try {
      const result = await processPdf({
        fileUri: selectedFile.uri,
        worker: workerRef.current,
        onProgress: (progress: ProcessPdfProgress) => {
          if (progress.stage === 'reading') {
            setProgressInfo('Reading PDF file...');
          } else if (progress.stage === 'loading') {
            setProgressInfo('Initializing PDF document...');
          } else if (progress.stage === 'page') {
            setProgressInfo(`Processing page ${progress.current} of ${progress.total}...`);
          }
        },
      });

      setPdfResult(result);
    } catch (err: any) {
      setErrorMessage(err?.message || 'Failed to process PDF document');
    } finally {
      clearInterval(timer);
      setIsProcessing(false);
      setProgressInfo('');
    }
  };

  const textCount = pdfResult?.pages.filter((p) => p.result.type === 'text').length ?? 0;
  const imageCount = pdfResult?.pages.filter((p) => p.result.type === 'image' && p.result.base64).length ?? 0;
  const errorCount = pdfResult?.pages.filter((p) => p.error).length ?? 0;

  return (
    <View style={[styles.outerContainer, { backgroundColor: colors.background }]}>
      {/* Hidden PDF Worker kept alive in memory */}
      <PdfWorker
        ref={workerRef}
        onReady={() => setWorkerReady(true)}
        onError={(err) => console.warn('PDF Worker warning:', err)}
      />

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.content}
      >
        <View style={styles.header}>
          <Text style={[styles.title, { color: colors.text }]}>
            M3 PDF Worker Test
          </Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
            Offline page extractor: text layer (&gt;200 chars) or scanned JPEG (~1600px).
          </Text>
        </View>

        {/* Worker Status Indicator */}
        <View style={styles.workerStatusRow}>
          <View
            style={[
              styles.statusDot,
              { backgroundColor: workerReady ? colors.success : colors.amber },
            ]}
          />
          <Text style={[styles.workerStatusText, { color: colors.textSecondary }]}>
            {workerReady ? 'pdf.js worker ready (inlined, offline)' : 'Initializing pdf.js worker...'}
          </Text>
        </View>

        {/* File Picker Section */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>
            SELECT PDF
          </Text>

          {selectedFile ? (
            <View
              style={[
                styles.fileCard,
                { backgroundColor: colors.card, borderColor: colors.border },
              ]}
            >
              <View style={styles.fileIconBox}>
                <Ionicons name="document-text" size={32} color={colors.accent} />
              </View>
              <View style={styles.fileDetails}>
                <Text
                  style={[styles.fileName, { color: colors.text }]}
                  numberOfLines={2}
                >
                  {selectedFile.name}
                </Text>
                <Text style={[styles.fileMeta, { color: colors.textSecondary }]}>
                  {selectedFile.size
                    ? `${(selectedFile.size / (1024 * 1024)).toFixed(2)} MB`
                    : 'Unknown size'}
                </Text>
              </View>
              <TouchableOpacity
                onPress={handlePickPdf}
                disabled={isProcessing}
                style={[styles.changeFileBtn, { backgroundColor: colors.chip }]}
              >
                <Text style={[styles.changeFileBtnText, { color: colors.accent }]}>
                  Change
                </Text>
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity
              style={[
                styles.uploadBox,
                { backgroundColor: colors.card, borderColor: colors.border },
              ]}
              onPress={handlePickPdf}
              accessibilityLabel="Pick a PDF document"
            >
              <Ionicons name="document-attach-outline" size={44} color={colors.accent} />
              <Text style={[styles.uploadText, { color: colors.text }]}>
                Pick University Syllabus or PYQ PDF
              </Text>
              <Text style={[styles.uploadSubtext, { color: colors.textSecondary }]}>
                Works with text PDFs and scanned photocopies
              </Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Action Button */}
        {selectedFile && (
          <View style={styles.actionContainer}>
            <TouchableOpacity
              style={[
                styles.actionBtn,
                { backgroundColor: colors.accent },
                isProcessing && { opacity: 0.7 },
              ]}
              onPress={handleRunProcessing}
              disabled={isProcessing}
            >
              {isProcessing ? (
                <>
                  <ActivityIndicator color={colors.accentText} size="small" />
                  <Text style={[styles.actionBtnText, { color: colors.accentText }]}>
                    {progressInfo || 'Processing...'} ({(elapsedMs / 1000).toFixed(1)}s)
                  </Text>
                </>
              ) : (
                <>
                  <Ionicons name="play-circle-outline" size={20} color={colors.accentText} />
                  <Text style={[styles.actionBtnText, { color: colors.accentText }]}>
                    Process PDF Pages
                  </Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        )}

        {/* Global Error Banner */}
        {errorMessage && (
          <View
            style={[
              styles.errorBox,
              { backgroundColor: colors.redBg, borderColor: colors.red },
            ]}
          >
            <Ionicons name="alert-circle" size={22} color={colors.red} />
            <Text style={[styles.errorText, { color: colors.red }]}>
              {errorMessage}
            </Text>
          </View>
        )}

        {/* Summary Stats Banner */}
        {pdfResult && (
          <View
            style={[
              styles.statsBanner,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <View style={styles.statItem}>
              <Text style={[styles.statLabel, { color: colors.textSecondary }]}>
                PAGES
              </Text>
              <Text style={[styles.statValue, { color: colors.text }]}>
                {pdfResult.processedCount}
              </Text>
            </View>
            <View style={styles.statItem}>
              <Text style={[styles.statLabel, { color: colors.textSecondary }]}>
                TEXT LAYER
              </Text>
              <Text style={[styles.statValue, { color: colors.success }]}>
                {textCount}
              </Text>
            </View>
            <View style={styles.statItem}>
              <Text style={[styles.statLabel, { color: colors.textSecondary }]}>
                SCANNED
              </Text>
              <Text style={[styles.statValue, { color: colors.amber }]}>
                {imageCount}
              </Text>
            </View>
            <View style={styles.statItem}>
              <Text style={[styles.statLabel, { color: colors.textSecondary }]}>
                TIME
              </Text>
              <Text style={[styles.statValue, { color: colors.accent }]}>
                {(pdfResult.totalTimeMs / 1000).toFixed(1)}s
              </Text>
            </View>
          </View>
        )}

        {/* Page by Page Results */}
        {pdfResult && (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>
              PAGE BREAKDOWN ({pdfResult.pages.length} PAGES)
            </Text>

            {pdfResult.pages.map((p) => {
              const result = p.result;
              const isText = result.type === 'text';
              const textContent = result.type === 'text' ? result.text : '';
              const nonSpaceLength = textContent.replace(/\s/g, '').length;

              return (
                <View
                  key={p.pageNumber}
                  style={[
                    styles.pageCard,
                    { backgroundColor: colors.card, borderColor: colors.border },
                  ]}
                >
                  <View style={styles.pageCardHeader}>
                    <View style={styles.pageTitleRow}>
                      <Text style={[styles.pageNumberBadge, { color: colors.accent }]}>
                        Page {p.pageNumber}
                      </Text>
                      <Text style={[styles.pageTime, { color: colors.textSecondary }]}>
                        {p.timeMs}ms
                      </Text>
                    </View>

                    <View
                      style={[
                        styles.badge,
                        {
                          backgroundColor: isText
                            ? colors.successBg
                            : colors.amberBg,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.badgeText,
                          {
                            color: isText ? colors.success : colors.amber,
                          },
                        ]}
                      >
                        {isText ? 'TEXT LAYER' : 'SCANNED (IMAGE)'}
                      </Text>
                    </View>
                  </View>

                  {p.error ? (
                    <View
                      style={[
                        styles.pageErrorBox,
                        { backgroundColor: colors.redBg },
                      ]}
                    >
                      <Ionicons name="warning" size={16} color={colors.red} />
                      <Text style={[styles.pageErrorText, { color: colors.red }]}>
                        {p.error}
                      </Text>
                    </View>
                  ) : result.type === 'text' ? (
                    <View style={styles.textContentContainer}>
                      <Text
                        style={[styles.charCountText, { color: colors.textSecondary }]}
                      >
                        {nonSpaceLength} non-space characters extracted:
                      </Text>
                      <View
                        style={[
                          styles.textBox,
                          {
                            backgroundColor: colors.background,
                            borderColor: colors.border,
                          },
                        ]}
                      >
                        <Text
                          style={[styles.extractedText, { color: colors.text }]}
                          numberOfLines={12}
                          selectable
                        >
                          {result.text}
                        </Text>
                      </View>
                    </View>
                  ) : result.type === 'image' && result.base64 ? (
                    <View style={styles.imageContentContainer}>
                      <Text
                        style={[styles.charCountText, { color: colors.textSecondary }]}
                      >
                        Rendered JPEG (~1600px long edge, quality 0.8):
                      </Text>
                      <View
                        style={[
                          styles.imageWrapper,
                          {
                            backgroundColor: colors.background,
                            borderColor: colors.border,
                          },
                        ]}
                      >
                        <Image
                          source={{
                            uri: `data:image/jpeg;base64,${result.base64}`,
                          }}
                          style={styles.renderedImage}
                          resizeMode="contain"
                        />
                      </View>
                    </View>
                  ) : (
                    <Text style={{ color: colors.red }}>
                      No content generated for this page.
                    </Text>
                  )}
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  outerContainer: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    padding: Spacing.md,
    gap: Spacing.lg,
    paddingBottom: Spacing.xl * 2,
  },
  header: {
    gap: Spacing.xs,
  },
  title: {
    fontSize: FontSize.h2,
    fontWeight: '700',
  },
  subtitle: {
    fontSize: FontSize.caption + 1,
    lineHeight: 18,
  },
  workerStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs + 2,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  workerStatusText: {
    fontSize: FontSize.caption,
    fontWeight: '500',
  },
  section: {
    gap: Spacing.xs,
  },
  sectionTitle: {
    fontSize: FontSize.caption,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  uploadBox: {
    padding: Spacing.xl,
    borderRadius: BorderRadius.card,
    borderWidth: 1,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
  },
  uploadText: {
    fontSize: FontSize.body,
    fontWeight: '600',
    textAlign: 'center',
  },
  uploadSubtext: {
    fontSize: FontSize.caption,
    textAlign: 'center',
  },
  fileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Spacing.md,
    borderRadius: BorderRadius.card,
    borderWidth: 1,
    gap: Spacing.md,
  },
  fileIconBox: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  fileDetails: {
    flex: 1,
    gap: 2,
  },
  fileName: {
    fontSize: FontSize.body - 1,
    fontWeight: '600',
  },
  fileMeta: {
    fontSize: FontSize.caption,
  },
  changeFileBtn: {
    paddingHorizontal: Spacing.sm + 2,
    paddingVertical: Spacing.xs + 2,
    borderRadius: BorderRadius.chip,
  },
  changeFileBtnText: {
    fontSize: FontSize.caption,
    fontWeight: '600',
  },
  actionContainer: {
    marginTop: Spacing.xs,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    paddingVertical: 14,
    borderRadius: BorderRadius.button,
  },
  actionBtnText: {
    fontSize: FontSize.body,
    fontWeight: '600',
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    padding: Spacing.md,
    borderRadius: BorderRadius.card,
    borderWidth: 1,
  },
  errorText: {
    flex: 1,
    fontSize: FontSize.caption + 1,
    fontWeight: '500',
  },
  statsBanner: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    padding: Spacing.md,
    borderRadius: BorderRadius.card,
    borderWidth: 1,
  },
  statItem: {
    alignItems: 'center',
    gap: 2,
  },
  statLabel: {
    fontSize: FontSize.tiny,
    textTransform: 'uppercase',
    fontWeight: '600',
  },
  statValue: {
    fontSize: FontSize.caption + 2,
    fontWeight: '700',
  },
  pageCard: {
    padding: Spacing.md,
    borderRadius: BorderRadius.card,
    borderWidth: 1,
    gap: Spacing.sm,
    marginBottom: Spacing.xs,
  },
  pageCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  pageTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  pageNumberBadge: {
    fontSize: FontSize.h3,
    fontWeight: '700',
  },
  pageTime: {
    fontSize: FontSize.caption,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: BorderRadius.chip,
  },
  badgeText: {
    fontSize: FontSize.tiny,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  pageErrorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    padding: Spacing.sm,
    borderRadius: BorderRadius.chip,
  },
  pageErrorText: {
    fontSize: FontSize.caption,
  },
  textContentContainer: {
    gap: Spacing.xs,
  },
  charCountText: {
    fontSize: FontSize.caption,
    fontWeight: '500',
  },
  textBox: {
    padding: Spacing.sm,
    borderRadius: BorderRadius.input,
    borderWidth: 1,
    maxHeight: 200,
  },
  extractedText: {
    fontSize: FontSize.caption,
    lineHeight: 18,
    fontFamily: 'monospace',
  },
  imageContentContainer: {
    gap: Spacing.xs,
  },
  imageWrapper: {
    borderRadius: BorderRadius.input,
    borderWidth: 1,
    overflow: 'hidden',
    height: 240,
    justifyContent: 'center',
    alignItems: 'center',
  },
  renderedImage: {
    width: '100%',
    height: '100%',
  },
});
