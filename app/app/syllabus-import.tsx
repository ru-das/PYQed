import React, { useState, useRef, useEffect, useSyncExternalStore } from 'react';
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
import * as Haptics from '../src/haptics';
import { Ionicons } from '@expo/vector-icons';
import { toast } from '../src/components/Toast';
import { useThemeColors, Spacing, FontSize, BorderRadius } from '../src/theme';
import { pickPhotos } from '../src/pick';
import { hasApiKey } from '../src/ai/settings';
import { SyllabusSource } from '../src/ai/importSyllabus';
import {
  startSyllabusJob,
  getSyllabusJob,
  subscribe,
  clearSyllabusJob,
  cancelSyllabusJob,
} from '../src/ai/syllabusJob';
import { mergeSyllabusSubjects } from '../src/logic/syllabus';
import { usePdfWorker } from '../src/pdf/usePdfWorker';
import { ApiKeySheet } from '../src/components/ApiKeySheet';
import { Button, ErrorCard, Footer, SourceCard } from '../src/components/ui';
import { ImportProgress, SYLLABUS_PHRASES, syllabusSteps } from '../src/components/ImportProgress';
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
  const { ensureWorker, worker } = usePdfWorker();
  const savedRef = useRef(false); // set once subjects are created, so leaving needs no confirm

  // Flow states
  // The import runs in a module-level job, so it survives leaving this screen
  const job = useSyncExternalStore(subscribe, getSyllabusJob);
  const [step, setStep] = useState<'picker' | 'processing' | 'review'>(
    getSyllabusJob().status === 'idle' ? 'picker' : 'processing',
  );
  const [pastedText, setPastedText] = useState('');
  const [isPasting, setIsPasting] = useState(false);

  // Key sheet modal
  const [showKeySheet, setShowKeySheet] = useState(false);
  const pendingSourceRef = useRef<SyllabusSource | null>(null);

  // Only used while photos are being resized, before the job starts
  const [prep, setPrep] = useState({ message: 'Preparing photos...', current: 0, total: 1 });

  // Whole-import elapsed time, ticking once a second while the job runs
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (job.status !== 'running') return;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, [job.status]);
  const elapsedSec =
    job.startedAt === 0
      ? 0
      : Math.max(0, Math.floor(((job.status === 'running' ? now : job.endedAt) - job.startedAt) / 1000));

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
        {
          text: 'Discard',
          style: 'destructive',
          onPress: () => {
            clearSyllabusJob();
            navigation.dispatch(e.data.action);
          },
        },
      ]);
    });
  }, [navigation, step]);

  // When the job finishes (also if it finished while we were away), turn its result into review items
  useEffect(() => {
    if (step !== 'processing' || job.status !== 'done' || !job.result) return;
    setSubjects(
      job.result.map((s) => ({
        id: newId(),
        selected: true,
        name: s.name,
        code: s.code || '',
        units: s.units.map((u) => ({
          id: newId(),
          name: u.name,
          topics: u.topics.map((t) => ({ id: newId(), name: t.name, details: t.details || undefined })),
        })),
      })),
    );
    setStep('review');
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    if (job.notice) Alert.alert('Check the result', job.notice);
  }, [step, job.status, job.result, job.notice]);

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

  // 2. Hand the source to the background job; the screen just watches it
  const runImport = (source: SyllabusSource) => {
    pendingSourceRef.current = source; // kept so "Try again" can re-run it
    setStep('processing');
    startSyllabusJob(source, source.type === 'pdf' ? ensureWorker : undefined);
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
          setPrep({ current: 0, total: n, message: 'Preparing photos...' });
        },
        (i, n) => setPrep({ current: i, total: n, message: `Preparing photo ${i} of ${n}...` }),
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
            // The merge joins subjects by name, so every selected one gets the first one's name
            const batches = selectedSubjects.map((s) => [
              { name: selectedSubjects[0].name, code: s.code || null, units: s.units },
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
    clearSyllabusJob();
    router.replace('/(tabs)');
    toast(`Created ${toSave.length} subject${toSave.length > 1 ? 's' : ''}`);
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
      {worker}

      {/* API Key Modal Sheet */}
      <ApiKeySheet
        visible={showKeySheet}
        onDismiss={() => {
          setShowKeySheet(false);
          pendingSourceRef.current = null;
          setStep('picker'); // picking photos already switched to the progress page
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
              Pick your syllabus and PYQed will find the subjects, units and topics. Tip: photograph only the syllabus pages you need. You can edit everything before saving.
            </Text>
          </View>

          <View style={styles.cardsList}>
            <SourceCard
              icon="images-outline"
              title="Photos of syllabus pages (Recommended)"
              body="Only the pages for your subjects. Faster and more accurate than a whole PDF."
              onPress={handlePickPhotos}
              accessibilityLabel="Import from Photos"
            />
            <SourceCard
              icon="document-text-outline"
              title="Syllabus PDF"
              body="Reads every page, so it's slower. Photos of just your pages work better."
              onPress={handlePickPdf}
              accessibilityLabel="Import from PDF"
            />
            <SourceCard
              icon="clipboard-outline"
              title="Paste Syllabus Text"
              body="Copy & paste text directly from a course page"
              onPress={() => setIsPasting(!isPasting)}
              trailing={isPasting ? 'chevron-up' : 'chevron-down'}
            />

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
                <Button
                  label="Analyze Text"
                  icon="checkmark"
                  onPress={handleDonePasting}
                  accessibilityLabel="Analyze Pasted Text"
                />
              </View>
            )}
          </View>
        </ScrollView>
      )}

      {/* --- Step 2: Processing State --- */}
      {step === 'processing' && (
        <View style={styles.centerContent}>
          {job.status === 'error' ? (
            <ErrorCard
              title="Import failed"
              message={job.error ?? ''}
              actions={
                <>
                  <Button
                    label="Choose another file"
                    variant="outline"
                    style={{ flex: 1 }}
                    onPress={() => {
                      clearSyllabusJob();
                      setStep('picker');
                    }}
                  />
                  <Button
                    label="Try Again"
                    style={{ flex: 1 }}
                    onPress={() => {
                      const src = job.source ?? pendingSourceRef.current;
                      if (src) {
                        runImport(src);
                      } else {
                        clearSyllabusJob();
                        setStep('picker');
                      }
                    }}
                  />
                </>
              }
            >
              {job.errorDetail && job.errorDetail !== job.error && (
                <Text style={{ color: colors.textSecondary, fontSize: 12, textAlign: 'center' }}>{job.errorDetail}</Text>
              )}
            </ErrorCard>
          ) : (
            job.status === 'idle' ? (
              <ImportProgress
                title={prep.message}
                elapsedSec={0}
                current={prep.current}
                total={prep.total}
              />
            ) : (
              <ImportProgress
                title={job.progress.stage === 'reading' ? job.progress.message : 'Analyzing syllabus...'}
                elapsedSec={elapsedSec}
                steps={syllabusSteps(job.progress)}
                phrases={SYLLABUS_PHRASES}
                peek={job.progress.live?.peek}
                canLeave={job.status === 'running' && job.progress.stage !== 'reading'}
                onStop={() => {
                  cancelSyllabusJob();
                  setStep('picker');
                }}
                current={job.progress.stage === 'reading' ? job.progress.current : 0}
                total={job.progress.stage === 'reading' ? job.progress.total : 0}
              />
            )
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
            <Button
              label="Add another subject"
              variant="outline"
              icon="add-circle-outline"
              onPress={addSubject}
            />
          </ScrollView>

          <Footer>
            <Button
              label={`Create ${selectedSubjects.length} Subject${selectedSubjects.length === 1 ? '' : 's'}`}
              icon="checkmark-circle"
              disabled={selectedSubjects.length === 0}
              onPress={handleCreateSubjects}
              accessibilityLabel="Create subjects"
            />
          </Footer>
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
  centerContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.lg,
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
});
