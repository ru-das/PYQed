import React, { useState, useEffect } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Linking,
  Pressable,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from '../haptics';
import { useThemeColors, Spacing, FontSize, BorderRadius } from '../theme';
import { ProviderSelect } from './ProviderSelect';
import {
  Provider,
  DEFAULT_PROVIDER,
  DEFAULT_MODEL_AISTUDIO,
  PROVIDER_LABELS,
} from '../config';
import { getApiSettings, saveApiSettings, setActiveProvider } from '../ai/settings';
import { generateJSON } from '../ai/client';

export type ApiKeySheetProps = {
  visible: boolean;
  onDismiss: () => void;
  onKeyReady: (provider: Provider, apiKey: string, modelId: string) => void;
};

export function ApiKeySheet({ visible, onDismiss, onKeyReady }: ApiKeySheetProps) {
  const colors = useThemeColors();

  const [provider, setProvider] = useState<Provider>(DEFAULT_PROVIDER);
  const [apiKey, setApiKey] = useState('');
  const [modelId, setModelId] = useState(DEFAULT_MODEL_AISTUDIO);
  const [baseUrl, setBaseUrl] = useState('');
  const [isKeyVisible, setIsKeyVisible] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);

  // Load existing settings when modal opens
  useEffect(() => {
    if (visible) {
      getApiSettings().then((settings) => {
        setProvider(settings.provider);
        setApiKey(settings.apiKey);
        setModelId(settings.modelId);
        setBaseUrl(settings.baseUrl);
        setTestResult(null);
      });
    }
  }, [visible]);

  // Switching loads that provider's own saved key / model / base URL
  const handleProviderChange = async (newProvider: Provider) => {
    if (newProvider === provider) return;
    setProvider(newProvider);
    setTestResult(null);
    const cfg = await setActiveProvider(newProvider);
    setApiKey(cfg.apiKey);
    setModelId(cfg.modelId);
    setBaseUrl(cfg.baseUrl);
  };

  const handleTestKey = async () => {
    if (!canTest) {
      setTestResult({
        success: false,
        message: isOpenAI
          ? 'Please enter the base URL and model ID first.'
          : 'Please paste your API key first.',
      });
      return;
    }

    setIsTesting(true);
    setTestResult(null);

    try {
      const result = await generateJSON({
        prompt: 'Ping test. Return JSON strictly in format: {"status": "ok"}',
        schemaName: '__test',
        provider,
        apiKey: apiKey.trim(),
        modelId: modelId.trim(),
        baseUrl: baseUrl.trim(),
      });

      if (result.ok) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setTestResult({
          success: true,
          message: 'Key works!',
        });
        await saveApiSettings({
          provider,
          apiKey: apiKey.trim(),
          modelId: modelId.trim(),
          baseUrl: baseUrl.trim(),
        });
      } else {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        setTestResult({
          success: false,
          message: result.friendlyError || result.error,
        });
      }
    } catch (err: any) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setTestResult({
        success: false,
        message: err?.message || 'Failed to test key.',
      });
    } finally {
      setIsTesting(false);
    }
  };

  const handleContinue = async () => {
    if (!canContinue) return;
    await saveApiSettings({
      provider,
      apiKey: apiKey.trim(),
      modelId: modelId.trim(),
      baseUrl: baseUrl.trim(),
    });
    onKeyReady(provider, apiKey.trim(), modelId.trim());
  };

  // OpenAI-compatible servers may be keyless, but need a base URL and a model ID
  const isOpenAI = provider === 'openai';
  const canTest = isOpenAI
    ? baseUrl.trim().length > 0 && modelId.trim().length > 0
    : apiKey.trim().length > 0;
  const canContinue = canTest;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onDismiss}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.overlay}
      >
        <Pressable style={styles.backdrop} onPress={onDismiss} />

        <View
          style={[
            styles.sheetContainer,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        >
          {/* Header */}
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.title, { color: colors.text }]}>
                {provider === 'aistudio'
                  ? 'Add a free Google AI Studio key'
                  : `Connect ${PROVIDER_LABELS[provider]}`}
              </Text>
              <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
                Required for AI to analyze syllabus and exam papers.
              </Text>
            </View>
            <TouchableOpacity
              onPress={onDismiss}
              style={styles.closeBtn}
              accessibilityLabel="Close"
            >
              <Ionicons name="close" size={22} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          <ProviderSelect value={provider} onChange={handleProviderChange} />

          {isOpenAI && (
            <>
              <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
                Any service with an OpenAI-style /chat/completions API. Pick a model that can read images.
              </Text>
              <View
                style={[styles.inputRow, { backgroundColor: colors.card, borderColor: colors.border }]}
              >
                <TextInput
                  style={[styles.input, { color: colors.text }]}
                  placeholder="Base URL (https://api.groq.com/openai/v1)"
                  placeholderTextColor={colors.textSecondary}
                  value={baseUrl}
                  onChangeText={(t) => {
                    setBaseUrl(t);
                    setTestResult(null);
                  }}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="url"
                />
              </View>
              <View
                style={[styles.inputRow, { backgroundColor: colors.card, borderColor: colors.border }]}
              >
                <TextInput
                  style={[styles.input, { color: colors.text }]}
                  placeholder="Model ID"
                  placeholderTextColor={colors.textSecondary}
                  value={modelId}
                  onChangeText={(t) => {
                    setModelId(t);
                    setTestResult(null);
                  }}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </View>
            </>
          )}

          {/* 3 Steps */}
          {!isOpenAI && (
          <View style={styles.stepsContainer}>
            <View style={styles.stepRow}>
              <View
                style={[
                  styles.stepBadge,
                  { backgroundColor: colors.chip },
                ]}
              >
                <Text style={[styles.stepBadgeText, { color: colors.text }]}>
                  1
                </Text>
              </View>
              <Text style={[styles.stepText, { color: colors.text }]}>
                {provider === 'aistudio'
                  ? 'Sign in to Google AI Studio with your Google account'
                  : 'Sign in to OpenRouter'}
              </Text>
            </View>

            <View style={styles.stepRow}>
              <View
                style={[
                  styles.stepBadge,
                  { backgroundColor: colors.chip },
                ]}
              >
                <Text style={[styles.stepBadgeText, { color: colors.text }]}>
                  2
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.stepText, { color: colors.text }]}>
                  Create a free API key
                </Text>
                <TouchableOpacity
                  onPress={() =>
                    Linking.openURL(
                      provider === 'aistudio'
                        ? 'https://aistudio.google.com/apikey'
                        : 'https://openrouter.ai/keys',
                    )
                  }
                  style={styles.linkButton}
                  accessibilityLabel="Open API key page"
                >
                  <Text style={[styles.linkButtonText, { color: colors.accent }]}>
                    Get free key at {provider === 'aistudio' ? 'Google AI Studio' : 'OpenRouter'} ↗
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.stepRow}>
              <View
                style={[
                  styles.stepBadge,
                  { backgroundColor: colors.chip },
                ]}
              >
                <Text style={[styles.stepBadgeText, { color: colors.text }]}>
                  3
                </Text>
              </View>
              <Text style={[styles.stepText, { color: colors.text }]}>
                Paste your key below and tap Continue
              </Text>
            </View>
          </View>
          )}

          {/* Key Input */}
          <View
            style={[
              styles.inputRow,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <TextInput
              style={[styles.input, { color: colors.text }]}
              placeholder={
                provider === 'aistudio'
                  ? 'Paste AI Studio Key (AIzaSy...)'
                  : provider === 'openrouter'
                    ? 'Paste OpenRouter Key (sk-or-...)'
                    : 'Paste API key (optional for local servers)'
              }
              placeholderTextColor={colors.textSecondary}
              value={apiKey}
              onChangeText={(text) => {
                setApiKey(text);
                setTestResult(null);
              }}
              secureTextEntry={!isKeyVisible}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <TouchableOpacity
              onPress={() => setIsKeyVisible(!isKeyVisible)}
              style={styles.iconBtn}
              accessibilityLabel={isKeyVisible ? 'Hide key' : 'Show key'}
            >
              <Ionicons
                name={isKeyVisible ? 'eye-off-outline' : 'eye-outline'}
                size={20}
                color={colors.textSecondary}
              />
            </TouchableOpacity>
          </View>

          {/* Test Result Message */}
          {testResult && (
            <View
              style={[
                styles.resultBanner,
                {
                  backgroundColor: testResult.success
                    ? colors.successBg
                    : colors.redBg,
                  borderColor: testResult.success ? colors.success : colors.red,
                },
              ]}
            >
              <Ionicons
                name={testResult.success ? 'checkmark-circle' : 'alert-circle'}
                size={18}
                color={testResult.success ? colors.success : colors.red}
              />
              <Text
                style={[
                  styles.resultText,
                  { color: testResult.success ? colors.success : colors.red },
                ]}
              >
                {testResult.message}
              </Text>
            </View>
          )}

          {/* Action Buttons */}
          <View style={styles.actionsRow}>
            <TouchableOpacity
              style={[
                styles.testBtn,
                { borderColor: colors.border, backgroundColor: colors.card },
              ]}
              onPress={handleTestKey}
              disabled={isTesting || !canTest}
              accessibilityLabel="Test API Key"
            >
              {isTesting ? (
                <ActivityIndicator color={colors.accent} size="small" />
              ) : (
                <Text style={[styles.testBtnText, { color: colors.text }]}>
                  Test key
                </Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.continueBtn,
                { backgroundColor: colors.accent },
                !canContinue && { opacity: 0.5 },
              ]}
              onPress={handleContinue}
              disabled={!canContinue}
              accessibilityLabel="Continue import"
            >
              <Text
                style={[styles.continueBtnText, { color: colors.accentText }]}
              >
                Continue
              </Text>
            </TouchableOpacity>
          </View>

          {/* Privacy Note */}
          <View style={styles.privacyRow}>
            <Ionicons name="lock-closed-outline" size={14} color={colors.textSecondary} />
            <Text style={[styles.privacyNote, { color: colors.textSecondary, flex: 1 }]}>
              Your key is stored only on this device in secure storage and never sent to any server.
            </Text>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  sheetContainer: {
    borderTopLeftRadius: BorderRadius.card + 6,
    borderTopRightRadius: BorderRadius.card + 6,
    borderTopWidth: 1,
    padding: Spacing.lg,
    paddingBottom: Spacing.xl + (Platform.OS === 'ios' ? 16 : 8),
    gap: Spacing.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
  },
  title: {
    fontSize: FontSize.h3,
    fontWeight: '700',
  },
  subtitle: {
    fontSize: FontSize.caption,
    marginTop: 2,
    lineHeight: 18,
  },
  closeBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepsContainer: {
    gap: Spacing.sm,
    paddingVertical: Spacing.xs,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
  },
  stepBadge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  stepBadgeText: {
    fontSize: FontSize.tiny + 1,
    fontWeight: '700',
  },
  stepText: {
    flex: 1,
    fontSize: FontSize.caption + 1,
    lineHeight: 20,
  },
  linkButton: {
    marginTop: 3,
  },
  linkButtonText: {
    fontSize: FontSize.caption,
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: BorderRadius.button,
    borderWidth: 1,
    paddingHorizontal: Spacing.md,
  },
  input: {
    flex: 1,
    paddingVertical: 12,
    fontSize: FontSize.body - 1,
  },
  iconBtn: {
    padding: Spacing.xs,
  },
  resultBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    padding: Spacing.sm,
    borderRadius: BorderRadius.chip,
    borderWidth: 1,
  },
  resultText: {
    flex: 1,
    fontSize: FontSize.caption,
    fontWeight: '500',
  },
  actionsRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginTop: Spacing.xs,
  },
  testBtn: {
    minHeight: 46,
    paddingHorizontal: Spacing.lg,
    borderRadius: BorderRadius.button,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  testBtnText: {
    fontSize: FontSize.caption + 1,
    fontWeight: '600',
  },
  continueBtn: {
    flex: 1,
    minHeight: 46,
    borderRadius: BorderRadius.button,
    alignItems: 'center',
    justifyContent: 'center',
  },
  continueBtnText: {
    fontSize: FontSize.body - 1,
    fontWeight: '700',
  },
  privacyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
  },
  privacyNote: {
    fontSize: FontSize.tiny + 1,
    textAlign: 'left',
    lineHeight: 16,
  },
});
