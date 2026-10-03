import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Image,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors, Spacing, FontSize, BorderRadius } from '../src/theme';
import {
  IMAGE_LONG_EDGE,
  IMAGE_JPEG_QUALITY,
} from '../src/config';
import { getApiSettings, hasApiKey } from '../src/ai/settings';
import {
  importPaper,
  PaperSource,
  PaperImportProgress,
  PageExtraction,
} from '../src/ai/importPaper';
import {
  detectNumberingGaps,
  buildQuestionsFromPages,
  NumberingGap,
} from '../src/logic/paper';
import { deriveQuestionType, checkNeedsReview } from '../src/ai/validators';
import { PdfWorker, PdfWorkerHandle } from '../src/pdf/PdfWorker';
import { ApiKeySheet } from '../src/components/ApiKeySheet';
import {
  getSubject,
  saveSubject,
  savePageImage,
  Subject,
  Paper,
  newId,
} from '../src/store/subjects';
import { labelQuestions } from '../src/ai/labelQuestions';
import { groupRepeats } from '../src/ai/groupRepeats';

type EditableQuestion = {
  id: string;
  number: string;
  group: string;
  text: string;
  marks: string; // string representation for input, parsed to number | null
  type: 'mcq' | 'short' | 'long' | 'other';
  needsReview: boolean;
  editedByUser: boolean;
  isOrAlternative?: boolean;
};

type EditablePage = {
  pageNumber: number;
  imageBase64: string;
  questions: EditableQuestion[];
  error?: string;
};

export default function PaperImportScreen() {
  const colors = useThemeColors();
  const router = useRouter();
  const { subjectId } = useLocalSearchParams<{ subjectId?: string }>();

  const pdfWorkerRef = useRef<PdfWorkerHandle>(null);

  // Subject state
  const [subject, setSubject] = useState<Subject | null>(null);

  // Flow states
  const [step, setStep] = useState<'picker' | 'processing' | 'review' | 'labelling'>('picker');
  const [source, setSource] = useState<PaperSource | null>(null);
  const [sourceName, setSourceName] = useState<string>('Exam Paper');

  // Key sheet modal
  const [showKeySheet, setShowKeySheet] = useState(false);
  const pendingSourceRef = useRef<PaperSource | null>(null);

  // Processing state
  const [progress, setProgress] = useState<PaperImportProgress>({
    stage: 'reading',
    current: 0,
    total: 1,
    message: 'Starting paper import...',
  });
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // Elapsed seconds for the current AI call; restarts whenever progress moves on
  const [elapsedSec, setElapsedSec] = useState(0);
  useEffect(() => {
    if (step !== 'processing' || errorMessage) return;
    const start = Date.now();
    setElapsedSec(0);
    const tick = setInterval(
      () => setElapsedSec(Math.floor((Date.now() - start) / 1000)),
      1000,
    );
    return () => clearInterval(tick);
  }, [step, errorMessage, progress.stage, progress.current]);
  const [partialPages, setPartialPages] = useState<PageExtraction[]>([]);
  const [resumePage, setResumePage] = useState<number>(0);

  // Review state
  const [paperYear, setPaperYear] = useState<string>('');
  const [paperSession, setPaperSession] = useState<string>('');
  const [pages, setPages] = useState<EditablePage[]>([]);
  const [activePageIndex, setActivePageIndex] = useState<number>(0);
  const [editingQuestionId, setEditingQuestionId] = useState<string | null>(null);

  useEffect(() => {
    if (subjectId) {
      getSubject(subjectId).then((s) => {
        if (s) setSubject(s);
      });
    }
  }, [subjectId]);

  // 1. Check API key before running import
  const startImportWithSource = async (src: PaperSource, name: string) => {
    setSource(src);
    setSourceName(name);

    const keyExists = await hasApiKey();
    if (!keyExists) {
      pendingSourceRef.current = src;
      setShowKeySheet(true);
      return;
    }

    runImport(src, 0, []);
  };

  const handleKeyReady = () => {
    setShowKeySheet(false);
    if (pendingSourceRef.current) {
      const src = pendingSourceRef.current;
      pendingSourceRef.current = null;
      runImport(src, 0, []);
    }
  };

  // 2. Main import execution
  const runImport = async (
    src: PaperSource,
    fromPage: number = 0,
    prevPages: PageExtraction[] = [],
  ) => {
    setStep('processing');
    setErrorMessage(null);

    const apiSettings = await getApiSettings();

    try {
      const result = await importPaper({
        source: src,
        provider: apiSettings.provider,
        apiKey: apiSettings.apiKey,
        modelId: apiSettings.modelId,
        pdfWorker: pdfWorkerRef.current || undefined,
        resumeFromPage: fromPage,
        previousPages: prevPages,
        onProgress: (p) => setProgress(p),
      });

      if (!result.ok) {
        setErrorMessage(result.friendlyError || result.error);
        setPartialPages(result.partialPages);
        setResumePage(result.lastCompletedPage);
        return;
      }

      // Convert PageExtraction[] into EditablePage[]
      const editablePages: EditablePage[] = result.pages.map((p) => ({
        pageNumber: p.pageNumber,
        imageBase64: p.imageBase64,
        error: p.error,
        questions: p.questions.map((q) => ({
          id: newId(),
          number: q.number,
          group: q.group || '',
          text: q.text,
          marks: q.marks !== null ? String(q.marks) : '',
          type: deriveQuestionType(q.marks, q.has_options),
          needsReview: checkNeedsReview(q.text, q.marks),
          editedByUser: false,
          isOrAlternative: q.or_alternative,
        })),
      }));

      setPages(editablePages);
      setActivePageIndex(0);

      if (result.detectedYear) {
        setPaperYear(String(result.detectedYear));
      }
      if (result.detectedSession) {
        setPaperSession(result.detectedSession);
      }

      setStep('review');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err: any) {
      setErrorMessage(err?.message || 'Failed to read paper.');
    }
  };

  // Source Pickers
  const handlePickPdf = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'application/pdf',
        copyToCacheDirectory: false,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const asset = result.assets[0];
        const name = asset.name || 'Past Paper.pdf';
        startImportWithSource(
          { type: 'pdf', fileUri: asset.uri, fileName: name },
          name,
        );
      }
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Could not pick PDF file.');
    }
  };

  const handlePickPhotos = async () => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert(
          'Permission Required',
          'Camera roll access is needed to select exam paper photos.',
        );
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: true,
        quality: 1,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        setStep('processing');
        setProgress({
          stage: 'reading',
          current: 0,
          total: result.assets.length,
          message: 'Preparing photos...',
        });

        const imageBase64s: string[] = [];
        const sourceNames: string[] = [];

        for (let i = 0; i < result.assets.length; i++) {
          const asset = result.assets[i];
          sourceNames.push(asset.fileName || `Photo_${i + 1}`);

          setProgress({
            stage: 'reading',
            current: i + 1,
            total: result.assets.length,
            message: `Optimizing photo ${i + 1} of ${result.assets.length}...`,
          });

          const { width, height, uri } = asset;
          const isLandscape = width > height;
          const longEdge = Math.max(width, height);

          const actions: ImageManipulator.Action[] = [];
          if (longEdge > IMAGE_LONG_EDGE) {
            if (isLandscape) {
              actions.push({ resize: { width: IMAGE_LONG_EDGE } });
            } else {
              actions.push({ resize: { height: IMAGE_LONG_EDGE } });
            }
          }

          const manipulated = await ImageManipulator.manipulateAsync(
            uri,
            actions,
            {
              compress: IMAGE_JPEG_QUALITY,
              format: ImageManipulator.SaveFormat.JPEG,
              base64: true,
            },
          );

          if (manipulated.base64) {
            imageBase64s.push(manipulated.base64);
          }
        }

        if (imageBase64s.length === 0) {
          Alert.alert('Error', 'Could not process selected photos.');
          setStep('picker');
          return;
        }

        startImportWithSource(
          { type: 'photos', imageBase64s, sourceNames },
          sourceNames[0] || 'Exam Photos',
        );
      }
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Could not pick photos.');
      setStep('picker');
    }
  };

  // Review helpers
  const currentPage = pages[activePageIndex];

  // Numbering gap check for active page
  const allQuestionsWithPage = pages.flatMap((p) =>
    p.questions.map((q) => ({
      number: q.number,
      group: q.group,
      page: p.pageNumber,
    })),
  );
  const gaps: NumberingGap[] = detectNumberingGaps(allQuestionsWithPage);
  const activePageGaps = gaps.filter(
    (g) => g.page === (currentPage?.pageNumber ?? -1),
  );

  const updateQuestion = (
    qId: string,
    updater: (q: EditableQuestion) => EditableQuestion,
  ) => {
    setPages((prevPages) =>
      prevPages.map((p, pIdx) => {
        if (pIdx !== activePageIndex) return p;
        return {
          ...p,
          questions: p.questions.map((q) => {
            if (q.id !== qId) return q;
            const updated = updater(q);
            const parsedMarks =
              updated.marks.trim() === '' ? null : Number(updated.marks);
            return {
              ...updated,
              needsReview: checkNeedsReview(
                updated.text,
                isNaN(parsedMarks as any) ? null : parsedMarks,
              ),
              editedByUser: true,
            };
          }),
        };
      }),
    );
  };

  const deleteQuestion = (qId: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setPages((prevPages) =>
      prevPages.map((p, pIdx) => {
        if (pIdx !== activePageIndex) return p;
        return {
          ...p,
          questions: p.questions.filter((q) => q.id !== qId),
        };
      }),
    );
  };

  const addMissingQuestion = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const newQ: EditableQuestion = {
      id: newId(),
      number: `Q${(currentPage?.questions.length ?? 0) + 1}`,
      group: '',
      text: '',
      marks: '',
      type: 'short',
      needsReview: true,
      editedByUser: true,
    };

    setPages((prevPages) =>
      prevPages.map((p, pIdx) => {
        if (pIdx !== activePageIndex) return p;
        return {
          ...p,
          questions: [...p.questions, newQ],
        };
      }),
    );
    setEditingQuestionId(newQ.id);
  };

  // Final Save to Subject
  const handleSavePaper = async () => {
    if (!subject) {
      Alert.alert('Error', 'Subject not found.');
      return;
    }

    const totalQuestions = pages.reduce((acc, p) => acc + p.questions.length, 0);
    if (totalQuestions === 0) {
      Alert.alert(
        'No Questions',
        'Please add or extract at least one question before saving.',
      );
      return;
    }

    const parsedYear = paperYear.trim() ? parseInt(paperYear.trim(), 10) : null;
    const finalYear = isNaN(parsedYear as any) ? null : parsedYear;
    const paperId = newId();

    // 1. Save page images to disk
    for (const p of pages) {
      if (p.imageBase64) {
        try {
          await savePageImage(subject.id, paperId, p.pageNumber, p.imageBase64);
        } catch (err) {
          console.warn(`Failed to save image for page ${p.pageNumber}:`, err);
        }
      }
    }

    // 2. Build Paper domain entity
    const newPaper: Paper = {
      id: paperId,
      year: finalYear,
      session: paperSession.trim() || undefined,
      title: sourceName,
      sourceName,
      pageCount: pages.length,
      importedAt: new Date().toISOString(),
    };

    // 3. Build Question entities from pages
    const domainQuestions = buildQuestionsFromPages(
      pages.map((p) => ({
        pageNumber: p.pageNumber,
        questions: p.questions.map((q) => ({
          number: q.number,
          group: q.group || null,
          text: q.text,
          marks: q.marks.trim() === '' ? null : Number(q.marks),
          type: q.type,
          needsReview: q.needsReview,
          editedByUser: q.editedByUser,
          or_alternative: q.isOrAlternative,
        })),
      })),
      paperId,
      finalYear,
    );

    // 4. Update Subject in store
    let updatedSubject: Subject = {
      ...subject,
      papers: [...subject.papers, newPaper],
      questions: [...subject.questions, ...domainQuestions],
    };

    await saveSubject(updatedSubject);

    // 5. Trigger topic labelling with Gemma 4 if syllabus units exist
    if (updatedSubject.units.length > 0) {
      const apiSettings = await getApiSettings();
      if (apiSettings.apiKey && apiSettings.apiKey.trim().length > 0) {
        setStep('labelling');
        setProgress({
          stage: 'extracting',
          current: 1,
          total: 1,
          message: 'Labelling questions with syllabus topics...',
        });

        try {
          const newQuestionIds = domainQuestions.map((q) => q.id);
          const labelledQuestions = await labelQuestions(
            updatedSubject,
            newQuestionIds,
            apiSettings.provider,
            apiSettings.apiKey,
            apiSettings.modelId,
            (p) =>
              setProgress({
                stage: 'extracting',
                current: p.current,
                total: p.total,
                message: p.message,
              }),
          );
          updatedSubject = {
            ...updatedSubject,
            questions: labelledQuestions,
          };
          await saveSubject(updatedSubject);

          // 6. Repeat groups (§8.4) for topics that received new questions
          const grouped = await groupRepeats(
            updatedSubject,
            newQuestionIds,
            apiSettings.provider,
            apiSettings.apiKey,
            apiSettings.modelId,
            (p) =>
              setProgress({
                stage: 'extracting',
                current: p.current,
                total: p.total,
                message: p.message,
              }),
          );
          updatedSubject = { ...updatedSubject, questions: grouped };
          await saveSubject(updatedSubject);
        } catch (err) {
          console.warn('Topic labelling / repeat grouping failed:', err);
          // Non-fatal: paper is already saved with unassigned questions
        }
      }
    }

    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    Alert.alert(
      'Paper Saved',
      `Saved ${domainQuestions.length} questions from ${newPaper.title}!`,
      [
        {
          text: 'View Subject',
          onPress: () => router.replace(`/subject/${subject.id}`),
        },
      ],
    );
  };

  const inputStyle = [
    styles.input,
    {
      color: colors.text,
      backgroundColor: colors.surface,
      borderColor: colors.border,
    },
  ];

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Stack.Screen
        options={{
          title:
            step === 'review'
              ? 'Paper Review'
              : step === 'processing'
              ? 'Reading Paper'
              : step === 'labelling'
              ? 'Labelling Topics'
              : 'Add Past Papers',
        }}
      />

      {/* Hidden PDF Worker */}
      <PdfWorker ref={pdfWorkerRef} />

      {/* API Key Modal Sheet */}
      <ApiKeySheet
        visible={showKeySheet}
        onDismiss={() => {
          setShowKeySheet(false);
          pendingSourceRef.current = null;
        }}
        onKeyReady={handleKeyReady}
      />

      {/* --- Step 1: Picker --- */}
      {step === 'picker' && (
        <ScrollView
          contentContainerStyle={styles.pickerContent}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.headerBlock}>
            <View
              style={[
                styles.iconCircle,
                { backgroundColor: colors.card, borderColor: colors.border },
              ]}
            >
              <Ionicons name="document-text" size={36} color={colors.accent} />
            </View>
            <Text style={[styles.h1, { color: colors.text }]}>
              Add Past Papers
            </Text>
            <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
              {subject ? `For ${subject.name}` : 'Select a PYQ paper'}
            </Text>
            <Text style={[styles.bodyText, { color: colors.textSecondary }]}>
              Add scanned or digital university question papers (PDF or photos).
              Gemma 4 will extract every question with numbers, marks, and
              sections.
            </Text>
          </View>

          <View style={styles.cardsList}>
            {/* Option 1: PDF */}
            <TouchableOpacity
              style={[
                styles.sourceCard,
                { backgroundColor: colors.card, borderColor: colors.border },
              ]}
              onPress={handlePickPdf}
              accessibilityLabel="Select PDF Paper"
            >
              <View
                style={[
                  styles.badgeIcon,
                  { backgroundColor: colors.accent + '15' },
                ]}
              >
                <Ionicons
                  name="document-attach-outline"
                  size={24}
                  color={colors.accent}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.cardTitle, { color: colors.text }]}>
                  Question Paper PDF
                </Text>
                <Text
                  style={[styles.cardDesc, { color: colors.textSecondary }]}
                >
                  Scanned images or digital text PYQ PDF
                </Text>
              </View>
              <Ionicons
                name="chevron-forward"
                size={20}
                color={colors.textSecondary}
              />
            </TouchableOpacity>

            {/* Option 2: Photos */}
            <TouchableOpacity
              style={[
                styles.sourceCard,
                { backgroundColor: colors.card, borderColor: colors.border },
              ]}
              onPress={handlePickPhotos}
              accessibilityLabel="Select Photos of Paper"
            >
              <View
                style={[
                  styles.badgeIcon,
                  { backgroundColor: colors.accent + '15' },
                ]}
              >
                <Ionicons name="camera-outline" size={24} color={colors.accent} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.cardTitle, { color: colors.text }]}>
                  Paper Photos / Scans
                </Text>
                <Text
                  style={[styles.cardDesc, { color: colors.textSecondary }]}
                >
                  Select photos of each page in order
                </Text>
              </View>
              <Ionicons
                name="chevron-forward"
                size={20}
                color={colors.textSecondary}
              />
            </TouchableOpacity>
          </View>

          <View
            style={[
              styles.infoCard,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <Ionicons name="shield-checkmark-outline" size={20} color={colors.accent} />
            <Text style={[styles.infoCardText, { color: colors.textSecondary }]}>
              Every question will be presented beside the original page image for
              your review before saving.
            </Text>
          </View>
        </ScrollView>
      )}

      {/* --- Step 2: Processing --- */}
      {step === 'processing' && (
        <View style={styles.centerContent}>
          {errorMessage ? (
            <View
              style={[
                styles.errorCard,
                { backgroundColor: colors.card, borderColor: colors.red },
              ]}
            >
              <Ionicons name="alert-circle" size={44} color={colors.red} />
              <Text style={[styles.h2, { color: colors.text, textAlign: 'center' }]}>
                Import Interrupted
              </Text>
              <Text
                style={[
                  styles.errorBody,
                  { color: colors.textSecondary, textAlign: 'center' },
                ]}
              >
                {errorMessage}
              </Text>

              {partialPages.length > 0 && (
                <Text
                  style={[
                    styles.partialText,
                    { color: colors.accent, textAlign: 'center' },
                  ]}
                >
                  {partialPages.length} page(s) already saved. You can resume
                  right from page {resumePage + 1}.
                </Text>
              )}

              <View style={styles.errorBtnRow}>
                <TouchableOpacity
                  style={[
                    styles.outlineBtn,
                    { borderColor: colors.border, backgroundColor: colors.surface },
                  ]}
                  onPress={() => setStep('picker')}
                >
                  <Text style={{ color: colors.text, fontWeight: '600' }}>
                    Cancel
                  </Text>
                </TouchableOpacity>

                {source && (
                  <TouchableOpacity
                    style={[styles.primaryBtn, { backgroundColor: colors.accent }]}
                    onPress={() => runImport(source, resumePage, partialPages)}
                  >
                    <Text
                      style={[
                        styles.primaryBtnText,
                        { color: colors.accentText },
                      ]}
                    >
                      {partialPages.length > 0 ? 'Resume Import' : 'Try Again'}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          ) : (
            <View style={styles.progressContainer}>
              <ActivityIndicator size="large" color={colors.accent} />
              <Text
                style={[
                  styles.progressStage,
                  { color: colors.text, marginTop: Spacing.md },
                ]}
              >
                {progress.message}
              </Text>
              <Text style={[styles.progressCount, { color: colors.textSecondary }]}>
                ⏱ {elapsedSec}s elapsed (a call can take 1–2 min on the free tier)
              </Text>
              {progress.total > 1 && (
                <Text
                  style={[styles.progressCount, { color: colors.textSecondary }]}
                >
                  Reading page {progress.current} of {progress.total}
                </Text>
              )}
              <Text
                style={[
                  styles.privacySubtext,
                  { color: colors.textSecondary, marginTop: Spacing.lg },
                ]}
              >
                Gemma 4 is reading each question, marks, and sections. Your original
                page images will be shown beside the questions in review.
              </Text>
            </View>
          )}
        </View>
      )}

      {/* --- Step: Labelling with Gemma 4 --- */}
      {step === 'labelling' && (
        <View style={styles.centerContent}>
          <View style={styles.progressContainer}>
            <ActivityIndicator size="large" color={colors.accent} />
            <Text
              style={[
                styles.progressStage,
                { color: colors.text, marginTop: Spacing.md },
              ]}
            >
              {progress.message || 'Labelling topics with Gemma 4...'}
            </Text>
            {progress.total > 1 && (
              <Text
                style={[styles.progressCount, { color: colors.textSecondary }]}
              >
                Chunk {progress.current} of {progress.total}
              </Text>
            )}
            <Text
              style={[
                styles.privacySubtext,
                { color: colors.textSecondary, marginTop: Spacing.lg },
              ]}
            >
              Matching questions to syllabus topics. Questions without a clear match will appear under Unassigned.
            </Text>
          </View>
        </View>
      )}

      {/* --- Step 3: Paper Review Screen --- */}
      {step === 'review' && (
        <View style={{ flex: 1 }}>
          {/* Paper Metadata Bar */}
          <View
            style={[
              styles.metaBar,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <View style={{ flex: 1, flexDirection: 'row', gap: Spacing.sm }}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.metaLabel, { color: colors.textSecondary }]}>
                  EXAM YEAR
                </Text>
                <TextInput
                  style={[inputStyle, styles.metaInput]}
                  value={paperYear}
                  onChangeText={setPaperYear}
                  placeholder="e.g. 2023"
                  placeholderTextColor={colors.textSecondary}
                  keyboardType="numeric"
                  maxLength={4}
                />
              </View>
              <View style={{ flex: 1.2 }}>
                <Text style={[styles.metaLabel, { color: colors.textSecondary }]}>
                  SESSION
                </Text>
                <TextInput
                  style={[inputStyle, styles.metaInput]}
                  value={paperSession}
                  onChangeText={setPaperSession}
                  placeholder="e.g. Winter / Mid"
                  placeholderTextColor={colors.textSecondary}
                />
              </View>
            </View>

            <TouchableOpacity
              style={[styles.saveBtn, { backgroundColor: colors.accent }]}
              onPress={handleSavePaper}
              accessibilityLabel="Save Paper"
            >
              <Ionicons name="checkmark" size={18} color={colors.accentText} />
              <Text style={[styles.saveBtnText, { color: colors.accentText }]}>
                Save Paper
              </Text>
            </TouchableOpacity>
          </View>

          {/* Page Selector Tabs */}
          {pages.length > 1 && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={[
                styles.pageTabsContainer,
                { borderBottomColor: colors.border },
              ]}
              contentContainerStyle={{ paddingHorizontal: Spacing.md, gap: Spacing.xs }}
            >
              {pages.map((p, idx) => {
                const isSelected = idx === activePageIndex;
                const pageGaps = gaps.filter((g) => g.page === p.pageNumber);
                const hasReviewIssues =
                  p.questions.some((q) => q.needsReview) || pageGaps.length > 0;

                return (
                  <TouchableOpacity
                    key={p.pageNumber}
                    style={[
                      styles.pageTab,
                      {
                        backgroundColor: isSelected
                          ? colors.accent
                          : colors.card,
                        borderColor: isSelected
                          ? colors.accent
                          : colors.border,
                      },
                    ]}
                    onPress={() => {
                      setActivePageIndex(idx);
                      setEditingQuestionId(null);
                    }}
                    accessibilityLabel={`Page ${p.pageNumber}`}
                  >
                    <Text
                      style={[
                        styles.pageTabText,
                        {
                          color: isSelected
                            ? colors.accentText
                            : colors.text,
                        },
                      ]}
                    >
                      Page {p.pageNumber} ({p.questions.length})
                    </Text>
                    {hasReviewIssues && (
                      <View
                        style={[
                          styles.dotBadge,
                          {
                            backgroundColor: isSelected
                              ? colors.amberBg
                              : colors.amber,
                          },
                        ]}
                      />
                    )}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          )}

          {/* Main Review Content for active page */}
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={styles.reviewScroll}
            keyboardShouldPersistTaps="handled"
          >
            {/* Page Image Preview */}
            {currentPage?.imageBase64 ? (
              <View
                style={[
                  styles.imageCard,
                  { backgroundColor: colors.card, borderColor: colors.border },
                ]}
              >
                <Image
                  source={{
                    uri: `data:image/jpeg;base64,${currentPage.imageBase64}`,
                  }}
                  style={styles.pageImage}
                  resizeMode="contain"
                />
                <View
                  style={[
                    styles.imageFooter,
                    { backgroundColor: colors.chip },
                  ]}
                >
                  <Ionicons
                    name="image-outline"
                    size={16}
                    color={colors.textSecondary}
                  />
                  <Text
                    style={[
                      styles.imageFooterText,
                      { color: colors.textSecondary },
                    ]}
                  >
                    Original scan: Page {currentPage.pageNumber} of {pages.length}
                  </Text>
                </View>
              </View>
            ) : null}

            {/* Error on this page */}
            {currentPage?.error && (
              <View
                style={[
                  styles.pageErrorBanner,
                  { backgroundColor: colors.redBg, borderColor: colors.red },
                ]}
              >
                <Ionicons name="warning-outline" size={20} color={colors.red} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.gapTitle, { color: colors.red }]}>
                    Couldn't read this page automatically
                  </Text>
                  <Text style={[styles.gapSubtitle, { color: colors.red }]}>
                    You can add questions manually using the button below.
                  </Text>
                </View>
              </View>
            )}

            {/* Numbering Gaps Alert */}
            {activePageGaps.map((gap, gIdx) => (
              <View
                key={gIdx}
                style={[
                  styles.gapBanner,
                  { backgroundColor: colors.amberBg, borderColor: colors.amber },
                ]}
              >
                <Ionicons name="alert-circle" size={20} color={colors.amber} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.gapTitle, { color: colors.amber }]}>
                    Question numbering gap: {gap.afterQuestion} → {gap.beforeQuestion}
                  </Text>
                  <Text style={[styles.gapSubtitle, { color: colors.amber }]}>
                    Check if a question was missed on the page scan.
                  </Text>
                </View>
              </View>
            ))}

            {/* Questions Header */}
            <View style={styles.sectionHeaderRow}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>
                Extracted Questions ({currentPage?.questions.length ?? 0})
              </Text>
              <TouchableOpacity
                style={[
                  styles.addQBtn,
                  { borderColor: colors.accent, backgroundColor: colors.accent + '15' },
                ]}
                onPress={addMissingQuestion}
                accessibilityLabel="Add missing question"
              >
                <Ionicons name="add" size={16} color={colors.accent} />
                <Text style={[styles.addQBtnText, { color: colors.accent }]}>
                  Add Question
                </Text>
              </TouchableOpacity>
            </View>

            {/* Questions List */}
            {currentPage?.questions.length === 0 ? (
              <View
                style={[
                  styles.emptyQuestionsBox,
                  { backgroundColor: colors.card, borderColor: colors.border },
                ]}
              >
                <Text style={{ color: colors.textSecondary }}>
                  No questions extracted on this page. Tap "Add Question" to enter one.
                </Text>
              </View>
            ) : (
              currentPage?.questions.map((q) => {
                const isEditing = editingQuestionId === q.id;

                return (
                  <View
                    key={q.id}
                    style={[
                      styles.questionCard,
                      {
                        backgroundColor: colors.card,
                        borderColor: q.needsReview ? colors.amber : colors.border,
                      },
                    ]}
                  >
                    {/* Header Row */}
                    <View style={styles.qHeader}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, flex: 1 }}>
                        <View
                          style={[
                            styles.numberBadge,
                            { backgroundColor: colors.chip },
                          ]}
                        >
                          <Text
                            style={[
                              styles.numberBadgeText,
                              { color: colors.text },
                            ]}
                          >
                            {q.number || '—'}
                          </Text>
                        </View>

                        {q.marks !== '' ? (
                          <View
                            style={[
                              styles.marksBadge,
                              { backgroundColor: colors.surface, borderColor: colors.border },
                            ]}
                          >
                            <Text
                              style={[
                                styles.marksBadgeText,
                                { color: colors.text },
                              ]}
                            >
                              {q.marks} m
                            </Text>
                          </View>
                        ) : (
                          <View
                            style={[
                              styles.warningBadge,
                              { backgroundColor: colors.amberBg },
                            ]}
                          >
                            <Text
                              style={[
                                styles.warningBadgeText,
                                { color: colors.amber },
                              ]}
                            >
                              ? marks
                            </Text>
                          </View>
                        )}

                        <View
                          style={[
                            styles.typeBadge,
                            { backgroundColor: colors.chip },
                          ]}
                        >
                          <Text
                            style={[
                              styles.typeBadgeText,
                              { color: colors.textSecondary },
                            ]}
                          >
                            {q.type}
                          </Text>
                        </View>

                        {q.group ? (
                          <Text
                            style={[
                              styles.groupLabel,
                              { color: colors.textSecondary },
                            ]}
                            numberOfLines={1}
                          >
                            {q.group}
                          </Text>
                        ) : null}
                      </View>

                      {/* Action buttons */}
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
                        <TouchableOpacity
                          style={styles.iconActionBtn}
                          onPress={() =>
                            setEditingQuestionId(isEditing ? null : q.id)
                          }
                          accessibilityLabel={isEditing ? 'Close edit' : 'Edit question'}
                        >
                          <Ionicons
                            name={isEditing ? 'checkmark-circle' : 'pencil-outline'}
                            size={18}
                            color={isEditing ? colors.accent : colors.textSecondary}
                          />
                        </TouchableOpacity>

                        <TouchableOpacity
                          style={styles.iconActionBtn}
                          onPress={() => deleteQuestion(q.id)}
                          accessibilityLabel="Delete question"
                        >
                          <Ionicons
                            name="trash-outline"
                            size={18}
                            color={colors.red}
                          />
                        </TouchableOpacity>
                      </View>
                    </View>

                    {/* Inline warnings */}
                    {q.marks === '' && (
                      <View style={styles.warningLine}>
                        <Ionicons
                          name="alert-circle-outline"
                          size={14}
                          color={colors.amber}
                        />
                        <Text
                          style={[
                            styles.warningLineText,
                            { color: colors.amber },
                          ]}
                        >
                          Marks not printed. Enter marks if known or leave blank.
                        </Text>
                      </View>
                    )}

                    {q.text.trim().length < 10 && q.text.trim().length > 0 && (
                      <View style={styles.warningLine}>
                        <Ionicons
                          name="information-circle-outline"
                          size={14}
                          color={colors.amber}
                        />
                        <Text
                          style={[
                            styles.warningLineText,
                            { color: colors.amber },
                          ]}
                        >
                          Question text is very short. Check scan.
                        </Text>
                      </View>
                    )}

                    {/* Question Content View or Edit View */}
                    {!isEditing ? (
                      <Text style={[styles.qText, { color: colors.text }]}>
                        {q.text || '(Empty question text)'}
                      </Text>
                    ) : (
                      <View style={styles.editContainer}>
                        <View style={styles.editRow}>
                          <View style={{ width: 80 }}>
                            <Text
                              style={[
                                styles.editLabel,
                                { color: colors.textSecondary },
                              ]}
                            >
                              Number
                            </Text>
                            <TextInput
                              style={[inputStyle, styles.editInput]}
                              value={q.number}
                              onChangeText={(t) =>
                                updateQuestion(q.id, (old) => ({
                                  ...old,
                                  number: t,
                                }))
                              }
                              placeholder="e.g. 1a"
                              placeholderTextColor={colors.textSecondary}
                            />
                          </View>

                          <View style={{ width: 80 }}>
                            <Text
                              style={[
                                styles.editLabel,
                                { color: colors.textSecondary },
                              ]}
                            >
                              Marks
                            </Text>
                            <TextInput
                              style={[inputStyle, styles.editInput]}
                              value={q.marks}
                              onChangeText={(t) =>
                                updateQuestion(q.id, (old) => ({
                                  ...old,
                                  marks: t,
                                }))
                              }
                              placeholder="?"
                              placeholderTextColor={colors.textSecondary}
                              keyboardType="numeric"
                            />
                          </View>

                          <View style={{ flex: 1 }}>
                            <Text
                              style={[
                                styles.editLabel,
                                { color: colors.textSecondary },
                              ]}
                            >
                              Section / Group
                            </Text>
                            <TextInput
                              style={[inputStyle, styles.editInput]}
                              value={q.group}
                              onChangeText={(t) =>
                                updateQuestion(q.id, (old) => ({
                                  ...old,
                                  group: t,
                                }))
                              }
                              placeholder="Group A (optional)"
                              placeholderTextColor={colors.textSecondary}
                            />
                          </View>
                        </View>

                        {/* Question Type Selector */}
                        <View style={{ gap: 4 }}>
                          <Text
                            style={[
                              styles.editLabel,
                              { color: colors.textSecondary },
                            ]}
                          >
                            Question Type
                          </Text>
                          <View style={styles.typeSelectorRow}>
                            {(['short', 'long', 'mcq', 'other'] as const).map(
                              (t) => (
                                <TouchableOpacity
                                  key={t}
                                  style={[
                                    styles.typeSelectBtn,
                                    {
                                      backgroundColor:
                                        q.type === t
                                          ? colors.accent
                                          : colors.chip,
                                    },
                                  ]}
                                  onPress={() =>
                                    updateQuestion(q.id, (old) => ({
                                      ...old,
                                      type: t,
                                    }))
                                  }
                                >
                                  <Text
                                    style={[
                                      styles.typeSelectText,
                                      {
                                        color:
                                          q.type === t
                                            ? colors.accentText
                                            : colors.textSecondary,
                                      },
                                    ]}
                                  >
                                    {t}
                                  </Text>
                                </TouchableOpacity>
                              ),
                            )}
                          </View>
                        </View>

                        {/* Text Editor */}
                        <View style={{ gap: 4 }}>
                          <Text
                            style={[
                              styles.editLabel,
                              { color: colors.textSecondary },
                            ]}
                          >
                            Question Text
                          </Text>
                          <TextInput
                            style={[
                              inputStyle,
                              styles.textEditor,
                              { minHeight: 70 },
                            ]}
                            value={q.text}
                            onChangeText={(t) =>
                              updateQuestion(q.id, (old) => ({
                                ...old,
                                text: t,
                              }))
                            }
                            placeholder="Question text..."
                            placeholderTextColor={colors.textSecondary}
                            multiline
                          />
                        </View>

                        <TouchableOpacity
                          style={[
                            styles.doneEditBtn,
                            { backgroundColor: colors.accent },
                          ]}
                          onPress={() => setEditingQuestionId(null)}
                        >
                          <Text
                            style={[
                              styles.doneEditText,
                              { color: colors.accentText },
                            ]}
                          >
                            Done Editing
                          </Text>
                        </TouchableOpacity>
                      </View>
                    )}
                  </View>
                );
              })
            )}

            <View style={{ height: Spacing.xl * 2 }} />
          </ScrollView>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  pickerContent: {
    padding: Spacing.lg,
    gap: Spacing.lg,
  },
  headerBlock: {
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.md,
  },
  iconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.xs,
  },
  h1: {
    fontSize: FontSize.h1,
    fontWeight: '700',
    textAlign: 'center',
  },
  h2: {
    fontSize: FontSize.h2,
    fontWeight: '700',
  },
  subtitle: {
    fontSize: FontSize.body,
    fontWeight: '600',
    textAlign: 'center',
  },
  bodyText: {
    fontSize: FontSize.caption + 1,
    textAlign: 'center',
    lineHeight: 20,
    marginTop: 4,
  },
  cardsList: {
    gap: Spacing.md,
  },
  sourceCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Spacing.md,
    borderRadius: BorderRadius.card,
    borderWidth: 1,
    gap: Spacing.md,
  },
  badgeIcon: {
    width: 48,
    height: 48,
    borderRadius: BorderRadius.button,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTitle: {
    fontSize: FontSize.h3,
    fontWeight: '700',
  },
  cardDesc: {
    fontSize: FontSize.caption,
    marginTop: 2,
  },
  infoCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    padding: Spacing.md,
    borderRadius: BorderRadius.card,
    borderWidth: 1,
  },
  infoCardText: {
    flex: 1,
    fontSize: FontSize.caption,
    lineHeight: 18,
  },
  centerContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.lg,
  },
  progressContainer: {
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
  },
  progressStage: {
    fontSize: FontSize.h3,
    fontWeight: '700',
    textAlign: 'center',
  },
  progressCount: {
    fontSize: FontSize.caption,
  },
  privacySubtext: {
    fontSize: FontSize.caption,
    textAlign: 'center',
    lineHeight: 18,
  },
  errorCard: {
    width: '100%',
    padding: Spacing.lg,
    borderRadius: BorderRadius.card,
    borderWidth: 1,
    alignItems: 'center',
    gap: Spacing.md,
  },
  errorBody: {
    fontSize: FontSize.body - 1,
    lineHeight: 20,
  },
  partialText: {
    fontSize: FontSize.caption + 1,
    fontWeight: '600',
  },
  errorBtnRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    width: '100%',
    marginTop: Spacing.sm,
  },
  outlineBtn: {
    flex: 1,
    minHeight: 46,
    borderRadius: BorderRadius.button,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtn: {
    flex: 1,
    minHeight: 46,
    borderRadius: BorderRadius.button,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnText: {
    fontSize: FontSize.body - 1,
    fontWeight: '700',
  },
  metaBar: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Spacing.md,
    borderBottomWidth: 1,
    gap: Spacing.md,
  },
  metaLabel: {
    fontSize: FontSize.tiny,
    fontWeight: '700',
    marginBottom: 2,
    letterSpacing: 0.5,
  },
  metaInput: {
    height: 38,
    paddingVertical: 4,
    paddingHorizontal: Spacing.sm,
    fontSize: FontSize.caption + 1,
    fontWeight: '600',
  },
  saveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    height: 42,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.button,
    alignSelf: 'flex-end',
    justifyContent: 'center',
  },
  saveBtnText: {
    fontSize: FontSize.caption + 1,
    fontWeight: '700',
  },
  pageTabsContainer: {
    borderBottomWidth: 1,
    maxHeight: 52,
    paddingVertical: Spacing.xs,
  },
  pageTab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: Spacing.md,
    paddingVertical: 8,
    borderRadius: BorderRadius.button,
    borderWidth: 1,
  },
  pageTabText: {
    fontSize: FontSize.caption,
    fontWeight: '600',
  },
  dotBadge: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  reviewScroll: {
    padding: Spacing.md,
    gap: Spacing.md,
  },
  imageCard: {
    borderRadius: BorderRadius.card,
    borderWidth: 1,
    overflow: 'hidden',
  },
  pageImage: {
    width: '100%',
    height: 280,
    backgroundColor: '#00000008',
  },
  imageFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    paddingVertical: 6,
    paddingHorizontal: Spacing.md,
  },
  imageFooterText: {
    fontSize: FontSize.tiny,
    fontWeight: '600',
  },
  pageErrorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    padding: Spacing.md,
    borderRadius: BorderRadius.card,
    borderWidth: 1,
  },
  gapBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    padding: Spacing.md,
    borderRadius: BorderRadius.card,
    borderWidth: 1,
  },
  gapTitle: {
    fontSize: FontSize.caption + 1,
    fontWeight: '700',
  },
  gapSubtitle: {
    fontSize: FontSize.tiny + 1,
    marginTop: 2,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: Spacing.xs,
  },
  sectionTitle: {
    fontSize: FontSize.h3,
    fontWeight: '700',
  },
  addQBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: Spacing.sm + 2,
    paddingVertical: 6,
    borderRadius: BorderRadius.button,
    borderWidth: 1,
  },
  addQBtnText: {
    fontSize: FontSize.caption,
    fontWeight: '700',
  },
  emptyQuestionsBox: {
    padding: Spacing.lg,
    borderRadius: BorderRadius.card,
    borderWidth: 1,
    alignItems: 'center',
  },
  questionCard: {
    padding: Spacing.md,
    borderRadius: BorderRadius.card,
    borderWidth: 1,
    gap: Spacing.sm,
  },
  qHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  numberBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: BorderRadius.chip,
  },
  numberBadgeText: {
    fontSize: FontSize.caption,
    fontWeight: '700',
  },
  marksBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: BorderRadius.chip,
    borderWidth: 1,
  },
  marksBadgeText: {
    fontSize: FontSize.caption,
    fontWeight: '600',
  },
  warningBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: BorderRadius.chip,
  },
  warningBadgeText: {
    fontSize: FontSize.caption,
    fontWeight: '700',
  },
  typeBadge: {
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: BorderRadius.chip,
  },
  typeBadgeText: {
    fontSize: FontSize.tiny,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  groupLabel: {
    fontSize: FontSize.tiny,
    fontWeight: '600',
    maxWidth: 90,
  },
  iconActionBtn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  warningLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  warningLineText: {
    fontSize: FontSize.tiny,
    fontWeight: '600',
  },
  qText: {
    fontSize: FontSize.body - 1,
    lineHeight: 22,
  },
  editContainer: {
    gap: Spacing.sm,
    paddingTop: Spacing.xs,
  },
  editRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  editLabel: {
    fontSize: FontSize.tiny,
    fontWeight: '600',
    marginBottom: 2,
  },
  editInput: {
    height: 38,
    paddingHorizontal: Spacing.sm,
    fontSize: FontSize.caption,
  },
  typeSelectorRow: {
    flexDirection: 'row',
    gap: Spacing.xs,
  },
  typeSelectBtn: {
    flex: 1,
    paddingVertical: 6,
    alignItems: 'center',
    borderRadius: BorderRadius.chip,
  },
  typeSelectText: {
    fontSize: FontSize.tiny + 1,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  textEditor: {
    textAlignVertical: 'top',
    padding: Spacing.sm,
    fontSize: FontSize.caption + 1,
    lineHeight: 20,
  },
  doneEditBtn: {
    height: 36,
    borderRadius: BorderRadius.button,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: Spacing.xs,
  },
  doneEditText: {
    fontSize: FontSize.caption,
    fontWeight: '700',
  },
  input: {
    borderWidth: 1,
    borderRadius: BorderRadius.input,
  },
});
