import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
} from 'react-native';
import { Stack, useNavigation, useRouter } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors, Spacing, FontSize, BorderRadius } from '../src/theme';
import { pickPhotos } from '../src/pick';
import { getApiSettings, hasApiKey } from '../src/ai/settings';
import {
  importSyllabus,
  SyllabusSource,
  SyllabusImportProgress,
} from '../src/ai/importSyllabus';
import { mergeSyllabusSubjects } from '../src/logic/syllabus';
import { showProgress, finish } from '../src/notify';
import { PdfWorker, PdfWorkerHandle } from '../src/pdf/PdfWorker';
import { ApiKeySheet } from '../src/components/ApiKeySheet';
import { ImportProgress } from '../src/components/ImportProgress';
import { emptySubject, newId, saveSubject, Subject } from '../src/store/subjects';
import { UnitsEditor } from '../src/components/UnitsEditor';

type EditableTopic = {
  id: string;
  name: string;
  details?: string;
};

type EditableUnit = {
  id: string;
  name: string;
  topics: EditableTopic[];
};

type EditableSubject = {
  id: string;
  selected: boolean;
  name: string;
  code: string;
  units: EditableUnit[];
};

export default function SyllabusImportScreen() {
  const colors = useThemeColors();
  const router = useRouter();
  const navigation = useNavigation();
  const pdfWorkerRef = useRef<PdfWorkerHandle>(null);
  // The hidden PDF reader is only mounted once a PDF is picked (photos and pasted text never need it)
  const [workerOn, setWorkerOn] = useState(false);
  const ensureWorker = async () => {
    setWorkerOn(true);
    for (let i = 0; i < 100 && !pdfWorkerRef.current; i++) await new Promise((r) => setTimeout(r, 50));
    return pdfWorkerRef.current ?? undefined;
  };
  const savedRef = useRef(false); // set once subjects are created, so leaving needs no confirm

  // Flow states
  const [step, setStep] = useState<'picker' | 'processing' | 'review'>('picker');
  const [pastedText, setPastedText] = useState('');
  const [isPasting, setIsPasting] = useState(false);

  // Key sheet modal
  const [showKeySheet, setShowKeySheet] = useState(false);
  const pendingSourceRef = useRef<SyllabusSource | null>(null);

  // Processing state
  const [progress, setProgress] = useState<SyllabusImportProgress>({
    stage: 'reading',
    current: 0,
    total: 1,
    message: 'Starting syllabus import...',
  });
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [errorDetail, setErrorDetail] = useState<string | null>(null); // raw error, for debugging
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

  // Review state
  const [subjects, setSubjects] = useState<EditableSubject[]>([]);

  // Review edits live only in memory: confirm before the user leaves.
  useEffect(() => {
    if (step !== 'review') return;
    return navigation.addListener('beforeRemove', (e) => {
      if (savedRef.current) return;
      e.preventDefault();
      Alert.alert('Discard this syllabus?', 'Your review edits will be lost.', [
        { text: 'Keep editing', style: 'cancel' },
        { text: 'Discard', style: 'destructive', onPress: () => navigation.dispatch(e.data.action) },
      ]);
    });
  }, [navigation, step]);

  // 1. Check API key before running import
  const startImportWithSource = async (source: SyllabusSource) => {
    const keyExists = await hasApiKey();
    if (!keyExists) {
      pendingSourceRef.current = source;
      setShowKeySheet(true);
      return;
    }

    runImport(source);
  };

  const handleKeyReady = () => {
    setShowKeySheet(false);
    if (pendingSourceRef.current) {
      const src = pendingSourceRef.current;
      pendingSourceRef.current = null;
      runImport(src);
    }
  };

  // 2. Main import execution
  const runImport = async (source: SyllabusSource) => {
    setStep('processing');
    setErrorMessage(null);
    setErrorDetail(null);

    const apiSettings = await getApiSettings();

    try {
      const result = await importSyllabus({
        source,
        provider: apiSettings.provider,
        apiKey: apiSettings.apiKey,
        modelId: apiSettings.modelId,
        pdfWorker: source.type === 'pdf' ? await ensureWorker() : undefined,
        onProgress: (p) => {
          setProgress(p);
          showProgress('Reading syllabus', p.message);
        },
      });

      if (!result.ok) {
        finish("Couldn't finish reading", (result.friendlyError || result.error) + ' Open PYQed to retry.');
        setErrorMessage(result.friendlyError || result.error);
        setErrorDetail(result.error);
        return;
      }

      // Convert raw subjects into editable review items
      const editable: EditableSubject[] = result.subjects.map((s) => ({
        id: newId(),
        selected: true,
        name: s.name,
        code: s.code || '',
        units: s.units.map((u) => ({
          id: newId(),
          name: u.name,
          topics: u.topics.map((t) => ({
            id: newId(),
            name: t.name,
            details: t.details || undefined,
          })),
        })),
      }));

      setSubjects(editable);
      setStep('review');
      finish('Syllabus ready to review', 'Open PYQed to check the subjects.');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err: any) {
      finish("Couldn't finish reading", err?.message || 'Something went wrong.');
      setErrorMessage(err?.message || 'Failed to import syllabus.');
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
        const fileUri = result.assets[0].uri;
        startImportWithSource({ type: 'pdf', fileUri });
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
      startImportWithSource({ type: 'photos', imageBase64s: picked.base64s });
    } catch (err: any) {
      Alert.alert('Could not open photos', err?.message || 'Something went wrong.');
      setStep('picker');
    }
  };

  const handleDonePasting = () => {
    if (!pastedText.trim()) {
      Alert.alert('Nothing to read', 'Paste some syllabus text first.');
      return;
    }
    startImportWithSource({ type: 'text', text: pastedText.trim() });
  };

  // Review Actions
  const toggleSubjectSelect = (id: string) => {
    setSubjects((list) =>
      list.map((s) => (s.id === id ? { ...s, selected: !s.selected } : s)),
    );
  };

  const patchSubject = (id: string, fn: (s: EditableSubject) => EditableSubject) => {
    setSubjects((list) => list.map((s) => (s.id === id ? fn(s) : s)));
  };

  const deleteSubject = (id: string) => {
    setSubjects((list) => list.filter((s) => s.id !== id));
  };

  const addSubject = () => {
    setSubjects((list) => [
      ...list,
      {
        id: newId(),
        selected: true,
        name: 'New Subject',
        code: '',
        units: [],
      },
    ]);
  };

  // Merge selected subjects
  const selectedSubjects = subjects.filter((s) => s.selected);
  const handleMergeSelected = () => {
    if (selectedSubjects.length < 2) {
      Alert.alert('Select subjects', 'Tick at least 2 subjects to merge them.');
      return;
    }

    Alert.alert(
      'Merge subjects?',
      `Merge ${selectedSubjects.length} selected subjects into one? Their units and topics will be combined.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Merge',
          onPress: () => {
            // Convert selected to RawSyllabusSubject format for pure merge function
            const batches = selectedSubjects.map((s) => [
              {
                name: s.name,
                code: s.code || null,
                units: s.units.map((u) => ({
                  name: u.name,
                  topics: u.topics.map((t) => ({
                    name: t.name,
                    details: t.details,
                  })),
                })),
              },
            ]);

            const merged = mergeSyllabusSubjects(batches);
            if (merged.length > 0) {
              const primary = merged[0];
              const mergedSubject: EditableSubject = {
                id: newId(),
                selected: true,
                name: primary.name,
                code: primary.code || '',
                units: primary.units.map((u) => ({
                  id: newId(),
                  name: u.name,
                  topics: u.topics.map((t) => ({
                    id: newId(),
                    name: t.name,
                    details: t.details || undefined,
                  })),
                })),
              };

              // Keep non-selected subjects and replace selected with merged
              const selectedIds = new Set(selectedSubjects.map((s) => s.id));
              setSubjects((list) => [
                ...list.filter((s) => !selectedIds.has(s.id)),
                mergedSubject,
              ]);

              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            }
          },
        },
      ],
    );
  };

  // Final Save to Store
  const handleCreateSubjects = async () => {
    const toSave = subjects.filter((s) => s.selected && s.name.trim().length > 0);
    if (toSave.length === 0) {
      Alert.alert('No subjects selected', 'Tick at least one subject to create.');
      return;
    }

    for (const sub of toSave) {
      const newSub: Subject = {
        ...emptySubject(sub.name.trim(), sub.code.trim() || undefined),
        units: sub.units
          .filter((u) => u.name.trim().length > 0)
          .map((u, order) => ({
            id: newId(),
            name: u.name.trim(),
            order,
            topics: u.topics
              .filter((t) => t.name.trim().length > 0)
              .map((t) => ({
                id: newId(),
                name: t.name.trim(),
                details: t.details?.trim() || undefined,
              })),
          })),
      };

      await saveSubject(newSub);
    }

    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    savedRef.current = true;
    Alert.alert(
      toSave.length > 1 ? 'Subjects created' : 'Subject created',
      `Created ${toSave.length} subject${toSave.length > 1 ? 's' : ''}.`,
      [
        {
          text: 'View subjects',
          onPress: () => router.replace('/(tabs)'),
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
              ? 'Review syllabus'
              : step === 'processing'
              ? 'Reading syllabus'
              : 'Import syllabus',
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

      {/* --- Step 1: Source Picker --- */}
      {step === 'picker' && (
        <ScrollView
          contentContainerStyle={styles.pickerContent}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.headerBlock}>
            <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
              Pick your syllabus and PYQed will find the subjects, units and topics. You can edit everything before saving.
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
              accessibilityLabel="Import from PDF"
            >
              <View
                style={[
                  styles.badgeIcon,
                  { backgroundColor: colors.accent + '15' },
                ]}
              >
                <Ionicons
                  name="document-text-outline"
                  size={24}
                  color={colors.accent}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.cardTitle, { color: colors.text }]}>
                  Syllabus PDF
                </Text>
                <Text
                  style={[styles.cardDesc, { color: colors.textSecondary }]}
                >
                  Text or scanned university syllabus document
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
              accessibilityLabel="Import from Photos"
            >
              <View
                style={[
                  styles.badgeIcon,
                  { backgroundColor: colors.accent + '15' },
                ]}
              >
                <Ionicons name="images-outline" size={24} color={colors.accent} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.cardTitle, { color: colors.text }]}>
                  Photos or Scans
                </Text>
                <Text
                  style={[styles.cardDesc, { color: colors.textSecondary }]}
                >
                  Select photos of printed syllabus pages
                </Text>
              </View>
              <Ionicons
                name="chevron-forward"
                size={20}
                color={colors.textSecondary}
              />
            </TouchableOpacity>

            {/* Option 3: Paste Text */}
            <TouchableOpacity
              style={[
                styles.sourceCard,
                { backgroundColor: colors.card, borderColor: colors.border },
              ]}
              onPress={() => setIsPasting(!isPasting)}
              accessibilityLabel="Paste Syllabus Text"
            >
              <View
                style={[
                  styles.badgeIcon,
                  { backgroundColor: colors.accent + '15' },
                ]}
              >
                <Ionicons
                  name="clipboard-outline"
                  size={24}
                  color={colors.accent}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.cardTitle, { color: colors.text }]}>
                  Paste Syllabus Text
                </Text>
                <Text
                  style={[styles.cardDesc, { color: colors.textSecondary }]}
                >
                  Copy & paste text directly from a course page
                </Text>
              </View>
              <Ionicons
                name={isPasting ? 'chevron-up' : 'chevron-down'}
                size={20}
                color={colors.textSecondary}
              />
            </TouchableOpacity>

            {/* Paste Text Area */}
            {isPasting && (
              <View
                style={[
                  styles.pasteBox,
                  { backgroundColor: colors.card, borderColor: colors.border },
                ]}
              >
                <TextInput
                  style={[
                    styles.textArea,
                    {
                      color: colors.text,
                      backgroundColor: colors.surface,
                      borderColor: colors.border,
                    },
                  ]}
                  placeholder="Paste syllabus text here (units, topics, course names)..."
                  placeholderTextColor={colors.textSecondary}
                  value={pastedText}
                  onChangeText={setPastedText}
                  multiline
                  numberOfLines={8}
                />
                <TouchableOpacity
                  style={[styles.primaryBtn, { backgroundColor: colors.accent }]}
                  onPress={handleDonePasting}
                  accessibilityLabel="Analyze Pasted Text"
                >
                  <Ionicons name="checkmark" size={18} color={colors.accentText} />
                  <Text
                    style={[
                      styles.primaryBtnText,
                      { color: colors.accentText },
                    ]}
                  >
                    Analyze Text
                  </Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        </ScrollView>
      )}

      {/* --- Step 2: Processing State --- */}
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
                Import failed
              </Text>
              <Text
                style={[
                  styles.errorBody,
                  { color: colors.textSecondary, textAlign: 'center' },
                ]}
              >
                {errorMessage}
              </Text>
              {errorDetail && errorDetail !== errorMessage && (
                <Text
                  style={{
                    color: colors.textSecondary,
                    fontSize: 12,
                    textAlign: 'center',
                    marginTop: Spacing.sm,
                  }}
                >
                  {errorDetail}
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
                    Choose another file
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.primaryBtn, { backgroundColor: colors.accent }]}
                  onPress={() => {
                    if (pendingSourceRef.current) {
                      runImport(pendingSourceRef.current);
                    } else {
                      setStep('picker');
                    }
                  }}
                >
                  <Text
                    style={[styles.primaryBtnText, { color: colors.accentText }]}
                  >
                    Try Again
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <ImportProgress
              message={progress.message}
              elapsedSec={elapsedSec}
              current={progress.current}
              total={progress.total}
            />
          )}
        </View>
      )}

      {/* --- Step 3: Syllabus Review Screen --- */}
      {step === 'review' && (
        <View style={{ flex: 1 }}>
          <ScrollView
            contentContainerStyle={styles.reviewContent}
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.reviewHeader}>
              <Text style={[styles.h2, { color: colors.text }]}>
                Subjects found ({subjects.length})
              </Text>
              <Text
                style={[styles.reviewSubtitle, { color: colors.textSecondary }]}
              >
                Review and make adjustments. Only checked subjects will be
                created.
              </Text>
            </View>

            {/* Merge selected banner (if 2+ checked) */}
            {selectedSubjects.length >= 2 && (
              <TouchableOpacity
                style={[
                  styles.mergeBanner,
                  {
                    backgroundColor: colors.accent + '15',
                    borderColor: colors.accent,
                  },
                ]}
                onPress={handleMergeSelected}
                accessibilityLabel="Merge selected subjects"
              >
                <Ionicons name="git-merge-outline" size={20} color={colors.accent} />
                <Text style={[styles.mergeText, { color: colors.accent }]}>
                  Merge {selectedSubjects.length} selected subjects into one
                </Text>
              </TouchableOpacity>
            )}

            {/* Subjects List */}
            {subjects.map((sub, sIdx) => (
              <View
                key={sub.id}
                style={[
                  styles.subjectCard,
                  {
                    backgroundColor: colors.card,
                    borderColor: sub.selected ? colors.accent : colors.border,
                  },
                ]}
              >
                {/* Subject Header */}
                <View style={styles.subjectHeader}>
                  <TouchableOpacity
                    onPress={() => toggleSubjectSelect(sub.id)}
                    style={styles.checkboxTouch}
                    accessibilityLabel={
                      sub.selected ? 'Unselect subject' : 'Select subject'
                    }
                  >
                    <Ionicons
                      name={
                        sub.selected
                          ? 'checkbox'
                          : 'square-outline'
                      }
                      size={24}
                      color={sub.selected ? colors.accent : colors.textSecondary}
                    />
                  </TouchableOpacity>

                  <View style={{ flex: 1, gap: 4 }}>
                    <TextInput
                      style={[
                        inputStyle,
                        { fontWeight: '700', fontSize: FontSize.body },
                      ]}
                      value={sub.name}
                      onChangeText={(t) =>
                        patchSubject(sub.id, (s) => ({ ...s, name: t }))
                      }
                      placeholder="Subject Name"
                      placeholderTextColor={colors.textSecondary}
                    />
                    <TextInput
                      style={[
                        inputStyle,
                        {
                          fontSize: FontSize.caption,
                          minHeight: 36,
                          paddingVertical: 4,
                        },
                      ]}
                      value={sub.code}
                      onChangeText={(t) =>
                        patchSubject(sub.id, (s) => ({ ...s, code: t }))
                      }
                      placeholder="Code (optional, e.g. CS201)"
                      placeholderTextColor={colors.textSecondary}
                      autoCapitalize="characters"
                    />
                  </View>

                  <TouchableOpacity
                    onPress={() => deleteSubject(sub.id)}
                    style={styles.iconBtn44}
                    accessibilityLabel="Delete subject"
                  >
                    <Ionicons
                      name="trash-outline"
                      size={20}
                      color={colors.red}
                    />
                  </TouchableOpacity>
                </View>

                {/* Units List */}
                <View style={styles.unitsContainer}>
                  <Text
                    style={[
                      styles.sectionMiniLabel,
                      { color: colors.textSecondary },
                    ]}
                  >
                    UNITS & TOPICS ({sub.units.length} units)
                  </Text>

                  <UnitsEditor
                    units={sub.units}
                    onChange={(units) => patchSubject(sub.id, (x) => ({ ...x, units }))}
                  />
                </View>
              </View>
            ))}

            {/* Add Subject button */}
            <TouchableOpacity
              style={[
                styles.addSubjectBtn,
                { borderColor: colors.border, backgroundColor: colors.card },
              ]}
              onPress={addSubject}
              accessibilityLabel="Add another subject"
            >
              <Ionicons
                name="add-circle-outline"
                size={22}
                color={colors.accent}
              />
              <Text
                style={{
                  color: colors.accent,
                  fontWeight: '700',
                  fontSize: FontSize.body - 1,
                }}
              >
                Add another subject
              </Text>
            </TouchableOpacity>
          </ScrollView>

          {/* Sticky Bottom Bar */}
          <View
            style={[
              styles.bottomBar,
              { backgroundColor: colors.surface, borderTopColor: colors.border },
            ]}
          >
            <TouchableOpacity
              style={[
                styles.createBtn,
                { backgroundColor: colors.accent },
                selectedSubjects.length === 0 && { opacity: 0.5 },
              ]}
              onPress={handleCreateSubjects}
              disabled={selectedSubjects.length === 0}
              accessibilityLabel="Create subjects"
            >
              <Ionicons
                name="checkmark-circle"
                size={22}
                color={colors.accentText}
              />
              <Text
                style={[
                  styles.createBtnText,
                  { color: colors.accentText },
                ]}
              >
                Create {selectedSubjects.length} Subject
                {selectedSubjects.length === 1 ? '' : 's'}
              </Text>
            </TouchableOpacity>
          </View>
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
    padding: Spacing.md,
    gap: Spacing.lg,
  },
  headerBlock: {
    paddingVertical: Spacing.md,
    gap: Spacing.xs,
  },
  subtitle: {
    fontSize: FontSize.caption + 1,
    textAlign: 'left',
    lineHeight: 20,
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
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTitle: {
    fontSize: FontSize.body,
    fontWeight: '700',
  },
  cardDesc: {
    fontSize: FontSize.caption,
    marginTop: 2,
    lineHeight: 18,
  },
  pasteBox: {
    padding: Spacing.md,
    borderRadius: BorderRadius.card,
    borderWidth: 1,
    gap: Spacing.sm,
  },
  textArea: {
    borderWidth: 1,
    borderRadius: BorderRadius.input,
    padding: Spacing.sm,
    fontSize: FontSize.caption + 1,
    minHeight: 120,
    textAlignVertical: 'top',
  },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
    minHeight: 48,
    borderRadius: BorderRadius.button,
    paddingHorizontal: Spacing.md,
  },
  primaryBtnText: {
    fontSize: FontSize.body - 1,
    fontWeight: '700',
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
    gap: Spacing.sm,
  },
  errorBody: {
    fontSize: FontSize.caption + 1,
    lineHeight: 20,
  },
  errorBtnRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginTop: Spacing.md,
  },
  outlineBtn: {
    paddingHorizontal: Spacing.md,
    minHeight: 44,
    borderRadius: BorderRadius.button,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reviewContent: {
    padding: Spacing.md,
    gap: Spacing.md,
    paddingBottom: Spacing.xl * 3,
  },
  reviewHeader: {
    gap: 4,
  },
  h2: {
    fontSize: FontSize.h2,
    fontWeight: '700',
  },
  reviewSubtitle: {
    fontSize: FontSize.caption,
    lineHeight: 18,
  },
  mergeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    padding: Spacing.md,
    borderRadius: BorderRadius.button,
    borderWidth: 1,
  },
  mergeText: {
    fontSize: FontSize.caption + 1,
    fontWeight: '700',
  },
  subjectCard: {
    borderWidth: 2,
    borderRadius: BorderRadius.card,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  subjectHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.xs,
  },
  checkboxTouch: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  input: {
    minHeight: 44,
    borderWidth: 1,
    borderRadius: BorderRadius.input,
    paddingHorizontal: Spacing.sm,
    fontSize: FontSize.body - 1,
  },
  unitsContainer: {
    marginTop: Spacing.xs,
    gap: Spacing.xs,
  },
  sectionMiniLabel: {
    fontSize: FontSize.tiny + 1,
    fontWeight: '700',
    letterSpacing: 0.5,
    marginTop: Spacing.xs,
  },
  iconBtn44: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addSubjectBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
    minHeight: 48,
    borderRadius: BorderRadius.button,
    borderWidth: 1,
    borderStyle: 'dashed',
    marginTop: Spacing.xs,
  },
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    borderTopWidth: 1,
    padding: Spacing.md,
  },
  createBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    minHeight: 50,
    borderRadius: BorderRadius.button,
  },
  createBtnText: {
    fontSize: FontSize.body,
    fontWeight: '700',
  },
});
