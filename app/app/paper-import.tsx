import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  Modal,
} from 'react-native';
import { Stack, useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import * as Haptics from '../src/haptics';
import { Ionicons } from '@expo/vector-icons';
import { toast } from '../src/components/Toast';
import { useThemeColors, Spacing, FontSize, BorderRadius } from '../src/theme';
import { pickPhotos } from '../src/pick';
import { getApiSettings, hasApiKey } from '../src/ai/settings';
import { parseMarks } from '../src/components/QuestionFields';
import { QuestionCard } from '../src/components/QuestionCard';
import { QuestionEditModal } from '../src/components/QuestionEditModal';
import { Button, EmptyState, Footer } from '../src/components/ui';
import { ZoomableImage } from '../src/components/ZoomableImage';
import {
  importPaper,
  PaperSource,
  PaperImportProgress,
  PageExtraction,
  extractPage,
  pageStreamHandler,
} from '../src/ai/importPaper';
import {
  detectNumberingGaps,
  buildQuestionsFromPages,
  NumberingGap,
} from '../src/logic/paper';
import { deriveQuestionType, checkNeedsReview, RawExtractedQuestion } from '../src/ai/validators';
import { showProgress, finish } from '../src/notify';
import { PdfWorker, PdfWorkerHandle } from '../src/pdf/PdfWorker';
import { ApiKeySheet } from '../src/components/ApiKeySheet';
import { ImportProgress, PAPER_PHRASES, LABEL_PHRASES, paperSteps, labelSteps } from '../src/components/ImportProgress';
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

/** AI output for one page -> editable review rows. Type is derived by code, never by the AI. */
function toEditable(questions: RawExtractedQuestion[]): EditableQuestion[] {
  return questions.map((q) => ({
    id: newId(),
    number: q.number,
    group: q.group || '',
    text: q.text,
    marks: q.marks !== null ? String(q.marks) : '',
    type: deriveQuestionType(q.marks, q.has_options),
    needsReview: checkNeedsReview(q.text, q.marks),
    editedByUser: false,
    isOrAlternative: q.or_alternative,
  }));
}

export default function PaperImportScreen() {
  const colors = useThemeColors();
  const router = useRouter();
  const { subjectId } = useLocalSearchParams<{ subjectId?: string }>();

  const navigation = useNavigation();
  const pdfWorkerRef = useRef<PdfWorkerHandle>(null);
  // The hidden PDF reader is only mounted once a PDF is picked (photos and pasted text never need it)
  const [workerOn, setWorkerOn] = useState(false);
  const ensureWorker = async () => {
    setWorkerOn(true);
    for (let i = 0; i < 100 && !pdfWorkerRef.current; i++) await new Promise((r) => setTimeout(r, 50));
    return pdfWorkerRef.current ?? undefined;
  };
  const cancelRef = useRef(false); // set when the user leaves, so the page loop stops spending quota
  const savedRef = useRef(false); // set once the paper is saved, so leaving needs no confirm
  const [saving, setSaving] = useState(false);

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
  // Which labelling step is running (topics first, then repeats) and whether a single page is being retried
  const [labelKind, setLabelKind] = useState<'labels' | 'repeats'>('labels');
  const [retrying, setRetrying] = useState(false);
  // Elapsed seconds for the current AI call; restarts whenever progress moves on
  const [elapsedSec, setElapsedSec] = useState(0);
  useEffect(() => {
    if ((step !== 'processing' && step !== 'labelling' && !retrying) || errorMessage) return;
    const start = Date.now();
    setElapsedSec(0);
    const tick = setInterval(
      () => setElapsedSec(Math.floor((Date.now() - start) / 1000)),
      1000,
    );
    return () => clearInterval(tick);
  }, [step, errorMessage, retrying, progress.stage, progress.current]);
  const [partialPages, setPartialPages] = useState<PageExtraction[]>([]);
  const [resumePage, setResumePage] = useState<number>(0);

  // Review state
  const [paperYear, setPaperYear] = useState<string>('');
  const [paperSession, setPaperSession] = useState<string>('');
  const [pages, setPages] = useState<EditablePage[]>([]);
  const [activePageIndex, setActivePageIndex] = useState<number>(0);
  const [editingQuestionId, setEditingQuestionId] = useState<string | null>(null);

  useEffect(() => () => { cancelRef.current = true; }, []);

  // Reviewed edits live only in memory: confirm before the user leaves the review step.
  useEffect(() => {
    if (step !== 'review') return;
    return navigation.addListener('beforeRemove', (e) => {
      if (savedRef.current) return;
      e.preventDefault();
      Alert.alert('Discard this paper?', 'The questions you reviewed will be lost.', [
        { text: 'Keep editing', style: 'cancel' },
        { text: 'Discard', style: 'destructive', onPress: () => navigation.dispatch(e.data.action) },
      ]);
    });
  }, [navigation, step]);

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
        pdfWorker: src.type === 'pdf' ? await ensureWorker() : undefined,
        resumeFromPage: fromPage,
        previousPages: prevPages,
        shouldCancel: () => cancelRef.current,
        onProgress: (p) => {
          setProgress(p);
          showProgress('Reading paper', p.message);
        },
      });

      if (!result.ok) {
        if (cancelRef.current) return;
        finish("Couldn't finish reading", (result.friendlyError || result.error) + ' Open PYQed to resume.');
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
        questions: toEditable(p.questions),
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
      finish('Paper ready to review', sourceName);
      const qCount = editablePages.reduce((n, p) => n + p.questions.length, 0);
      toast(`Read ${editablePages.length} page${editablePages.length === 1 ? '' : 's'}, found ${qCount} questions. Check them against the page images.`);
      if (result.notice) Alert.alert('Long PDF', result.notice);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err: any) {
      finish("Couldn't finish reading", err?.message || 'Something went wrong.');
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
      Alert.alert('Could not open PDF', err?.message || 'Something went wrong.');
    }
  };

  const handlePickPhotos = async () => {
    try {
      const picked = await pickPhotos(
        (n) => {
          setStep('processing');
          setProgress({ stage: 'reading', current: 0, total: n, message: 'Preparing photos...' });
        },
        (i, n) =>
          setProgress({ stage: 'reading', current: i, total: n, message: `Preparing photo ${i} of ${n}...` }),
      );
      if (!picked) return;
      if (picked.base64s.length === 0) {
        Alert.alert('Could not read photos', 'None of the selected photos could be processed.');
        setStep('picker');
        return;
      }
      startImportWithSource(
        { type: 'photos', imageBase64s: picked.base64s, sourceNames: picked.names },
        picked.names[0] || 'Exam photos',
      );
    } catch (err: any) {
      Alert.alert('Could not open photos', err?.message || 'Something went wrong.');
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
            return {
              ...updated,
              needsReview: checkNeedsReview(updated.text, parseMarks(updated.marks)),
              editedByUser: true,
            };
          }),
        };
      }),
    );
  };

  // Read one failed page again (the image is kept in memory during review)
  const retryPage = async () => {
    const page = pages[activePageIndex];
    if (!page?.imageBase64 || retrying) return;
    setRetrying(true);
    setProgress({ stage: 'extracting', current: page.pageNumber, total: pages.length, message: `Reading page ${page.pageNumber}...` });
    try {
      const ai = await getApiSettings();
      const prev = pages[activePageIndex - 1]?.questions ?? [];
      const res = await extractPage(
        { pageNumber: page.pageNumber, imageBase64: page.imageBase64 },
        pages.length,
        prev.length ? prev[prev.length - 1].number : undefined,
        ai,
        pageStreamHandler(setProgress, page.pageNumber, pages.length),
      );
      if (!res.ok) {
        Alert.alert("Still couldn't read this page", res.friendlyError);
        return;
      }
      setPages((all) =>
        all.map((p, i) =>
          i === activePageIndex ? { ...p, error: undefined, questions: toEditable(res.data.questions) } : p,
        ),
      );
      toast(`Page ${page.pageNumber} read again: ${res.data.questions.length} questions`);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } finally {
      setRetrying(false);
    }
  };

  const deleteQuestion = (qId: string) =>
    Alert.alert('Delete question?', 'This removes it from the paper.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          setPages((prevPages) =>
            prevPages.map((p, pIdx) =>
              pIdx === activePageIndex ? { ...p, questions: p.questions.filter((q) => q.id !== qId) } : p,
            ),
          );
        },
      },
    ]);

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
    if (!subject || saving) return;

    const totalQuestions = pages.reduce((acc, p) => acc + p.questions.length, 0);
    if (totalQuestions === 0) {
      Alert.alert('No questions', 'Add at least one question before saving.');
      return;
    }

    const parsedYear = paperYear.trim() ? parseInt(paperYear.trim(), 10) : null;
    const finalYear = isNaN(parsedYear as any) ? null : parsedYear;

    // The same paper twice would double every "Asked n×" count, so ask first
    const duplicate =
      finalYear !== null &&
      subject.papers.some(
        (p) => p.year === finalYear && (p.session ?? '').toLowerCase() === paperSession.trim().toLowerCase(),
      );
    if (duplicate) {
      const proceed = await new Promise<boolean>((resolve) =>
        Alert.alert(
          'Already added?',
          `This subject already has a ${finalYear}${paperSession.trim() ? ' ' + paperSession.trim() : ''} paper. Adding it again will count its questions twice.`,
          [
            { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
            { text: 'Add anyway', onPress: () => resolve(true) },
          ],
          { cancelable: true, onDismiss: () => resolve(false) },
        ),
      );
      if (!proceed) return;
    }
    setSaving(true);
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
          marks: parseMarks(q.marks),
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

    // 5. Trigger topic labelling if syllabus units exist
    let labelNote = '';
    let labelError: string | undefined;
    if (updatedSubject.units.length === 0) {
      labelNote = ' Add a syllabus to sort them into topics.';
    } else {
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
          const labelled = await labelQuestions(
            updatedSubject,
            newQuestionIds,
            apiSettings.provider,
            apiSettings.apiKey,
            apiSettings.modelId,
            (p) => {
              setProgress({ stage: 'extracting', ...p });
              showProgress('Labelling questions', p.message);
            },
          );
          labelError = labelled.error;
          updatedSubject = {
            ...updatedSubject,
            questions: labelled.questions,
          };
          await saveSubject(updatedSubject);

          // 6. Repeat groups (§8.4) for topics that received new questions
          setLabelKind('repeats');
          const grouped = await groupRepeats(
            updatedSubject,
            newQuestionIds,
            apiSettings.provider,
            apiSettings.apiKey,
            apiSettings.modelId,
            (p) => {
              setProgress({ stage: 'extracting', ...p });
              showProgress('Labelling questions', p.message);
            },
          );
          updatedSubject = { ...updatedSubject, questions: grouped };
          await saveSubject(updatedSubject);
        } catch (err) {
          console.warn('Topic labelling / repeat grouping failed:', err);
          // Non-fatal: paper is already saved with unassigned questions
        }
        const newIds = new Set(domainQuestions.map((q) => q.id));
        const missed = updatedSubject.questions.filter(
          (q) => newIds.has(q.id) && q.topicId === null,
        ).length;
        if (missed > 0) {
          labelNote = ` ${missed} couldn't be matched to a topic; find them under Unassigned.${
            labelError ? ` Reason: ${labelError}` : ''
          }`;
        }
      } else {
        labelNote = ' Add an API key in Settings to sort them into topics.';
      }
    }

    finish('Paper saved', `${domainQuestions.length} questions added to ${subject.name}.`);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    savedRef.current = true;
    // Plain success is a toast; anything unsorted keeps an Alert so the reason is not missed
    if (!labelNote) {
      router.replace(`/subject/${subject.id}`);
      toast(`Saved ${domainQuestions.length} questions from ${newPaper.title}`);
      return;
    }
    Alert.alert(
      'Paper saved',
      `Saved ${domainQuestions.length} questions from ${newPaper.title}.${labelNote}`,
      [
        {
          text: 'View subject',
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
              ? 'Review paper'
              : step === 'processing'
              ? 'Reading paper'
              : step === 'labelling'
              ? 'Sorting into topics'
              : 'Add past papers',
        }}
      />

      {/* Hidden PDF Worker */}
      {workerOn && <PdfWorker ref={pdfWorkerRef} />}

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
            <Text style={[styles.subtitle, { color: colors.text, fontWeight: '700' }]}>
              {subject ? `For ${subject.name}` : 'Select a PYQ paper'}
            </Text>
            <Text style={[styles.bodyText, { color: colors.textSecondary }]}>
              Add a question paper as a PDF or photos. Scanned papers work too.
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
                  Question paper PDF
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
                  Photos of the paper
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
              You'll review every question against the original page before saving.
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
                Import interrupted
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
                <Button label="Cancel" variant="outline" onPress={() => setStep('picker')} style={{ flex: 1 }} />
                {source && (
                  <Button
                    label={partialPages.length > 0 ? 'Resume Import' : 'Try Again'}
                    onPress={() => runImport(source, resumePage, partialPages)}
                    style={{ flex: 1 }}
                  />
                )}
              </View>
            </View>
          ) : (
            <ImportProgress
              title={progress.message}
              elapsedSec={elapsedSec}
              steps={paperSteps(progress.stage, progress)}
              phrases={PAPER_PHRASES}
              peek={progress.live?.peek}
              current={progress.current}
              total={progress.total}
            />
          )}
        </View>
      )}

      {/* --- Retry one page: same progress page, in a modal over the review --- */}
      <Modal visible={retrying} animationType="fade" onRequestClose={() => {}}>
        <View style={[styles.centerContent, { backgroundColor: colors.background }]}>
          <ImportProgress
            title={progress.message}
            elapsedSec={elapsedSec}
            steps={paperSteps('extracting', progress)}
            phrases={PAPER_PHRASES}
            peek={progress.live?.peek}
          />
        </View>
      </Modal>

      {/* --- Step: Labelling --- */}
      {step === 'labelling' && (
        <View style={styles.centerContent}>
          <ImportProgress
            title="Sorting questions into topics..."
            elapsedSec={elapsedSec}
            steps={labelSteps(labelKind, progress)}
            phrases={LABEL_PHRASES}
            peek={progress.live?.peek}
            current={progress.current}
            total={progress.total}
          />
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
                <ZoomableImage uri={`data:image/jpeg;base64,${currentPage.imageBase64}`} />
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
                    Couldn't read this page
                  </Text>
                  <Text style={[styles.gapSubtitle, { color: colors.red }]}>
                    Try again, or add its questions by hand below.
                  </Text>
                  {currentPage.imageBase64 ? (
                    <Button
                      label={retrying ? 'Reading…' : 'Retry this page'}
                      variant="danger"
                      compact
                      disabled={retrying}
                      onPress={retryPage}
                      style={{ alignSelf: 'flex-start', marginTop: Spacing.sm }}
                    />
                  ) : null}
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
                Questions ({currentPage?.questions.length ?? 0})
              </Text>
              <Button
                label="Add question"
                variant="outline"
                compact
                icon="add"
                onPress={addMissingQuestion}
                accessibilityLabel="Add missing question"
              />
            </View>

            {/* Questions List */}
            {currentPage?.questions.length === 0 ? (
              <EmptyState
                icon="help-circle-outline"
                title="No questions on this page"
                body="Nothing was extracted here. Tap Add question to enter one."
              />
            ) : (
              currentPage?.questions.map((q) => (
                <QuestionCard
                  key={q.id}
                  q={{ ...q, marks: parseMarks(q.marks), group: q.group || undefined }}
                  warnings
                  onEdit={() => setEditingQuestionId(q.id)}
                  onDelete={() => deleteQuestion(q.id)}
                />
              ))
            )}
          </ScrollView>

          <Footer>
            <Button label="Save paper" icon="checkmark" loading={saving} onPress={handleSavePaper} />
          </Footer>

          <QuestionEditModal
            values={currentPage?.questions.find((q) => q.id === editingQuestionId) ?? null}
            onSave={(fields) => {
              if (editingQuestionId) updateQuestion(editingQuestionId, (old) => ({ ...old, ...fields }));
              setEditingQuestionId(null);
            }}
            onClose={() => setEditingQuestionId(null)}
          />
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
    gap: Spacing.sm,
    paddingVertical: Spacing.md,
  },
  h2: {
    fontSize: FontSize.h2,
    fontWeight: '700',
  },
  subtitle: {
    fontSize: FontSize.body,
    fontWeight: '600',
    textAlign: 'left',
  },
  bodyText: {
    fontSize: FontSize.caption + 1,
    textAlign: 'left',
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
    height: 44,
    paddingHorizontal: Spacing.sm,
    fontSize: FontSize.caption + 1,
    fontWeight: '600',
  },
  pageTabsContainer: {
    borderBottomWidth: 1,
    maxHeight: 60,
    paddingVertical: Spacing.xs,
  },
  pageTab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: Spacing.md,
    minHeight: 44,
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
  input: {
    borderWidth: 1,
    borderRadius: BorderRadius.input,
  },
});
