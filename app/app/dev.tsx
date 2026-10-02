import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  Alert,
  TextInput,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import * as SecureStore from 'expo-secure-store';
import { Ionicons } from '@expo/vector-icons';
import {
  useThemeColors,
  Spacing,
  FontSize,
  BorderRadius,
} from '../src/theme';
import {
  Provider,
  DEFAULT_PROVIDER,
  DEFAULT_MODEL_AISTUDIO,
  ALT_MODEL_AISTUDIO,
  IMAGE_LONG_EDGE,
  IMAGE_JPEG_QUALITY,
  SECURE_STORE_KEYS,
} from '../src/config';
import { generateJSON } from '../src/ai/client';
import { pageToQuestionsPrompt } from '../src/ai/prompts';
import {
  PageQuestionsResponse,
  deriveQuestionType,
  checkNeedsReview,
} from '../src/ai/validators';

export default function DevTestPageScreen() {
  const colors = useThemeColors();

  const [selectedImage, setSelectedImage] = useState<{
    uri: string;
    width: number;
    height: number;
    base64?: string;
  } | null>(null);

  const [selectedModel, setSelectedModel] = useState<string>(
    DEFAULT_MODEL_AISTUDIO,
  );
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [timeTakenMs, setTimeTakenMs] = useState<number | null>(null);
  const [rawOutput, setRawOutput] = useState<string | null>(null);
  const [parsedData, setParsedData] =
    useState<PageQuestionsResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [elapsedMs, setElapsedMs] = useState<number>(0);
  const [userYear, setUserYear] = useState<string>('');

  // Pick an image from photo library
  const handlePickImage = async () => {
    try {
      const permission =
        await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert(
          'Permission Required',
          'Camera roll permission is needed to select a test paper.',
        );
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: false,
        quality: 1,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const asset = result.assets[0];
        setIsProcessing(true);
        setRawOutput(null);
        setParsedData(null);
        setErrorMessage(null);
        setTimeTakenMs(null);

        // Determine long edge resize
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

        setSelectedImage({
          uri: manipulated.uri,
          width: manipulated.width,
          height: manipulated.height,
          base64: manipulated.base64,
        });
      }
    } catch (err: any) {
      Alert.alert('Image Pick Error', err?.message || 'Failed to pick image');
    } finally {
      setIsProcessing(false);
    }
  };

  // Run extraction via AI client
  const handleRunExtraction = async () => {
    if (!selectedImage?.base64) {
      Alert.alert('No Image', 'Please pick a question paper photo first.');
      return;
    }

    setIsProcessing(true);
    setRawOutput(null);
    setParsedData(null);
    setErrorMessage(null);
    setTimeTakenMs(null);
    setElapsedMs(0);

    const startTs = Date.now();
    const tick = setInterval(() => {
      setElapsedMs(Date.now() - startTs);
    }, 100);

    try {
      const savedProvider = (await SecureStore.getItemAsync(
        SECURE_STORE_KEYS.provider,
      )) as Provider | null;
      const provider = savedProvider || DEFAULT_PROVIDER;

      let key = '';
      if (provider === 'aistudio') {
        key = (await SecureStore.getItemAsync(SECURE_STORE_KEYS.aiStudioKey)) || '';
      } else {
        key = (await SecureStore.getItemAsync(SECURE_STORE_KEYS.openRouterKey)) || '';
      }

      if (!key.trim()) {
        Alert.alert(
          'API Key Missing',
          'Please set your API key in the Settings tab first.',
        );
        return;
      }

      const prompt = pageToQuestionsPrompt(1, 1);

      const result = await generateJSON<PageQuestionsResponse>({
        prompt,
        images: [selectedImage.base64],
        schemaName: 'pageQuestions',
        provider,
        apiKey: key.trim(),
        modelId: selectedModel.trim(),
      });

      setTimeTakenMs(result.timeMs);
      setRawOutput(result.rawText || '');

      if (result.ok) {
        setParsedData(result.data);
      } else {
        setErrorMessage(result.friendlyError || result.error);
      }
    } catch (e: any) {
      setErrorMessage(e?.message || 'Extraction failed');
    } finally {
      clearInterval(tick);
      setIsProcessing(false);
    }
  };

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={styles.content}
    >
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.text }]}>
          M1 Feasibility Tester
        </Text>
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
          Test Gemma 4 question extraction on a single paper photo.
        </Text>
      </View>

      {/* Model Selection for comparison */}
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>
          SELECT MODEL TO TEST
        </Text>
        <View style={styles.modelRow}>
          <TouchableOpacity
            style={[
              styles.modelChip,
              { backgroundColor: colors.card, borderColor: colors.border },
              selectedModel === DEFAULT_MODEL_AISTUDIO && {
                borderColor: colors.accent,
                backgroundColor: colors.surface,
              },
            ]}
            onPress={() => setSelectedModel(DEFAULT_MODEL_AISTUDIO)}
          >
            <Text
              style={[
                styles.modelChipText,
                {
                  color:
                    selectedModel === DEFAULT_MODEL_AISTUDIO
                      ? colors.accent
                      : colors.textSecondary,
                },
              ]}
            >
              Gemma 4 26B (MoE)
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.modelChip,
              { backgroundColor: colors.card, borderColor: colors.border },
              selectedModel === ALT_MODEL_AISTUDIO && {
                borderColor: colors.accent,
                backgroundColor: colors.surface,
              },
            ]}
            onPress={() => setSelectedModel(ALT_MODEL_AISTUDIO)}
          >
            <Text
              style={[
                styles.modelChipText,
                {
                  color:
                    selectedModel === ALT_MODEL_AISTUDIO
                      ? colors.accent
                      : colors.textSecondary,
                },
              ]}
            >
              Gemma 4 31B (Dense)
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Image Preview / Picker */}
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>
          PAPER PHOTO
        </Text>

        {selectedImage ? (
          <View
            style={[
              styles.previewContainer,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <Image
              source={{ uri: selectedImage.uri }}
              style={styles.previewImage}
              resizeMode="contain"
            />
            <View style={styles.imageMeta}>
              <Text
                style={[styles.metaText, { color: colors.textSecondary }]}
              >
                Resized to: {selectedImage.width} × {selectedImage.height} px
              </Text>
              <TouchableOpacity
                onPress={handlePickImage}
                style={[
                  styles.changeBtn,
                  { backgroundColor: colors.background },
                ]}
              >
                <Text style={{ color: colors.accent, fontWeight: '600' }}>
                  Change Photo
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <TouchableOpacity
            style={[
              styles.uploadBox,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
            onPress={handlePickImage}
            accessibilityLabel="Pick photo from gallery"
          >
            <Ionicons name="image-outline" size={40} color={colors.accent} />
            <Text style={[styles.uploadText, { color: colors.text }]}>
              Pick PYQ Photo from Gallery
            </Text>
            <Text
              style={[styles.uploadSubtext, { color: colors.textSecondary }]}
            >
              Automatically resized to ~1600px JPEG 0.8
            </Text>
          </TouchableOpacity>
        )}
      </View>

      {selectedImage && (
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>
            PAPER YEAR (Overrides AI detection)
          </Text>
          <TextInput
            style={[
              styles.yearInput,
              { color: colors.text, backgroundColor: colors.card, borderColor: colors.border },
            ]}
            placeholder="e.g. 2023"
            placeholderTextColor={colors.textSecondary}
            value={userYear}
            onChangeText={setUserYear}
            keyboardType="number-pad"
            maxLength={4}
          />
        </View>
      )}

      {/* Extract Button */}
      {selectedImage && (
        <View style={{ gap: Spacing.xs }}>
          <TouchableOpacity
            style={[
              styles.actionBtn,
              { backgroundColor: colors.accent },
              isProcessing && { opacity: 0.7 },
            ]}
            onPress={handleRunExtraction}
            disabled={isProcessing}
          >
            {isProcessing ? (
              <>
                <ActivityIndicator color={colors.accentText} size="small" />
                <Text style={[styles.actionBtnText, { color: colors.accentText }]}>
                  Reading page... ({(elapsedMs / 1000).toFixed(1)}s)
                </Text>
              </>
            ) : (
              <>
                <Ionicons
                  name="scan-outline"
                  size={20}
                  color={colors.accentText}
                />
                <Text
                  style={[styles.actionBtnText, { color: colors.accentText }]}
                >
                  Run Gemma 4 Extraction
                </Text>
              </>
            )}
          </TouchableOpacity>
          {isProcessing && (
            <Text
              style={{
                fontSize: FontSize.caption,
                color: colors.textSecondary,
                textAlign: 'center',
                marginTop: Spacing.xs,
              }}
            >
              ⏱ {(elapsedMs / 1000).toFixed(1)}s elapsed — Gemma 4 is transcribing questions (usually 30–90s on free tier)...
            </Text>
          )}
        </View>
      )}

      {/* Extraction Stats Banner */}
      {timeTakenMs !== null && (
        <View
          style={[
            styles.statsBanner,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <View style={styles.statItem}>
            <Text style={[styles.statLabel, { color: colors.textSecondary }]}>
              Model
            </Text>
            <Text style={[styles.statValue, { color: colors.text }]}>
              {selectedModel}
            </Text>
          </View>
          <View style={styles.statItem}>
            <Text style={[styles.statLabel, { color: colors.textSecondary }]}>
              Time Taken
            </Text>
            <Text
              style={[
                styles.statValue,
                { color: colors.accent, fontWeight: '700' },
              ]}
            >
              {(timeTakenMs / 1000).toFixed(2)}s
            </Text>
          </View>
          <View style={styles.statItem}>
            <Text style={[styles.statLabel, { color: colors.textSecondary }]}>
              Questions Found
            </Text>
            <Text style={[styles.statValue, { color: colors.text }]}>
              {parsedData?.questions?.length ?? 0}
            </Text>
          </View>
        </View>
      )}

      {/* Error display */}
      {errorMessage && (
        <View
          style={[
            styles.errorBox,
            { backgroundColor: colors.redBg, borderColor: colors.red },
          ]}
        >
          <Ionicons name="alert-circle" size={20} color={colors.red} />
          <Text style={[styles.errorText, { color: colors.red }]}>
            {errorMessage}
          </Text>
        </View>
      )}

      {/* Parsed Questions List */}
      {parsedData && (
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>
            PARSED QUESTIONS ({parsedData.questions.length})
          </Text>

          {parsedData.paper && (
            <View
              style={[
                styles.paperCard,
                { backgroundColor: colors.card, borderColor: colors.border },
              ]}
            >
              <Text style={[styles.paperTitle, { color: colors.text }]}>
                {parsedData.paper.subject_name || 'Subject Unknown'}
                {parsedData.paper.subject_code
                  ? ` (${parsedData.paper.subject_code})`
                  : ''}
              </Text>
              {(() => {
                const displayYear =
                  userYear.trim() ||
                  (parsedData.paper.year?.toString() ?? 'Not detected');
                return (
                  <Text
                    style={[styles.paperMeta, { color: colors.textSecondary }]}
                  >
                    Year: {displayYear} • Session:{' '}
                    {parsedData.paper.session ?? 'N/A'}
                  </Text>
                );
              })()}
            </View>
          )}

          {parsedData.questions.map((q, idx) => {
            const derivedType = deriveQuestionType(q.marks, q.has_options);
            const needsReview = checkNeedsReview(q.text, q.marks);

            return (
              <View
                key={idx}
                style={[
                  styles.questionCard,
                  { backgroundColor: colors.card, borderColor: colors.border },
                ]}
              >
                <View style={styles.questionHeader}>
                  <Text style={[styles.questionLabel, { color: colors.accent }]}>
                    Q
                  </Text>
                  <View
                    style={[
                      styles.marksChip,
                      {
                        backgroundColor:
                          q.marks !== null ? colors.amberBg : colors.redBg,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.marksText,
                        {
                          color: q.marks !== null ? colors.amber : colors.red,
                        },
                      ]}
                    >
                      {q.marks !== null ? `${q.marks}M` : '? marks'}
                    </Text>
                  </View>
                </View>

                <Text style={[styles.questionText, { color: colors.text }]}>
                  {q.text}
                </Text>

                <View style={styles.tagRow}>
                  <View style={[styles.chip, { backgroundColor: colors.chip }]}>
                    <Text style={[styles.chipText, { color: colors.textSecondary }]}>
                      {derivedType.toUpperCase()}
                    </Text>
                  </View>
                  {q.group && (
                    <View style={[styles.chip, { backgroundColor: colors.chip }]}>
                      <Text style={[styles.chipText, { color: colors.textSecondary }]}>
                        {q.group}
                      </Text>
                    </View>
                  )}
                  {q.or_alternative && (
                    <Text style={[styles.tagBadge, { color: colors.amber }]}>
                      ↳ OR Alternative
                    </Text>
                  )}
                  {q.continues_previous && (
                    <Text style={[styles.tagBadge, { color: colors.textSecondary }]}>
                      ↳ Continues from prev page
                    </Text>
                  )}
                  {needsReview && (
                    <Text style={[styles.tagBadge, { color: colors.red }]}>
                      ⚠️ Needs review
                    </Text>
                  )}
                </View>
              </View>
            );
          })}
        </View>
      )}

      {/* Raw Output Accordion */}
      {rawOutput && (
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>
            RAW MODEL RESPONSE
          </Text>
          <View
            style={[
              styles.rawCodeBox,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <Text
              style={[styles.rawCodeText, { color: colors.text }]}
              selectable
            >
              {rawOutput}
            </Text>
          </View>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
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
  },
  section: {
    gap: Spacing.xs,
  },
  sectionTitle: {
    fontSize: FontSize.caption,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  modelRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginTop: Spacing.xs,
  },
  modelChip: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: BorderRadius.button,
    borderWidth: 1,
    alignItems: 'center',
  },
  modelChipText: {
    fontSize: FontSize.caption,
    fontWeight: '600',
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
  },
  uploadSubtext: {
    fontSize: FontSize.caption,
  },
  previewContainer: {
    borderRadius: BorderRadius.card,
    borderWidth: 1,
    overflow: 'hidden',
    padding: Spacing.sm,
  },
  previewImage: {
    width: '100%',
    height: 220,
    borderRadius: BorderRadius.button,
  },
  imageMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: Spacing.sm,
    paddingHorizontal: Spacing.xs,
  },
  metaText: {
    fontSize: FontSize.caption,
  },
  changeBtn: {
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: BorderRadius.chip,
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
    fontSize: FontSize.caption + 1,
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
  paperCard: {
    padding: Spacing.md,
    borderRadius: BorderRadius.card,
    borderWidth: 1,
    marginBottom: Spacing.xs,
  },
  paperTitle: {
    fontSize: FontSize.h3,
    fontWeight: '700',
  },
  paperMeta: {
    fontSize: FontSize.caption,
    marginTop: 4,
  },
  questionCard: {
    padding: Spacing.md,
    borderRadius: BorderRadius.card,
    borderWidth: 1,
    gap: Spacing.sm,
    marginBottom: Spacing.xs,
  },
  questionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  questionLabel: {
    fontSize: FontSize.h2,
    fontWeight: '800',
  },
  yearInput: {
    borderWidth: 1,
    borderRadius: BorderRadius.input,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    fontSize: FontSize.body,
    marginTop: Spacing.xs,
  },
  chip: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: BorderRadius.chip,
  },
  chipText: {
    fontSize: FontSize.tiny,
    fontWeight: '600',
  },
  marksChip: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: BorderRadius.chip,
  },
  marksText: {
    fontSize: FontSize.caption,
    fontWeight: '700',
  },
  questionText: {
    fontSize: FontSize.body - 1,
    lineHeight: 22,
  },
  tagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  tagBadge: {
    fontSize: FontSize.caption,
    fontWeight: '600',
  },
  rawCodeBox: {
    padding: Spacing.md,
    borderRadius: BorderRadius.card,
    borderWidth: 1,
    maxHeight: 250,
  },
  rawCodeText: {
    fontSize: FontSize.caption - 1,
    fontFamily: 'monospace',
    lineHeight: 18,
  },
});
