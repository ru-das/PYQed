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
import * as Haptics from 'expo-haptics';
import { useThemeColors, Spacing, FontSize, BorderRadius } from '../theme';
import {
  Provider,
  DEFAULT_PROVIDER,
  DEFAULT_MODEL_AISTUDIO,
  DEFAULT_MODEL_OPENROUTER,
} from '../config';
import { getApiSettings, saveApiSettings } from '../ai/settings';
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
        setTestResult(null);
      });
    }
  }, [visible]);

  const handleProviderChange = (newProvider: Provider) => {
    if (newProvider === provider) return;
    setProvider(newProvider);
    setTestResult(null);
    setModelId(
      newProvider === 'aistudio'
        ? DEFAULT_MODEL_AISTUDIO
        : DEFAULT_MODEL_OPENROUTER,
    );
  };

  const handleTestKey = async () => {
    if (!apiKey.trim()) {
      setTestResult({
        success: false,
        message: 'Please paste your API key first.',
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
    if (!apiKey.trim()) return;
    await saveApiSettings({
      provider,
      apiKey: apiKey.trim(),
      modelId: modelId.trim(),
    });
    onKeyReady(provider, apiKey.trim(), modelId.trim());
  };

  const canContinue = apiKey.trim().length > 0;

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
                Add a free Google AI Studio key
              </Text>
              <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
                Required for Gemma 4 to analyze syllabus and exam papers.
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

          {/* Provider Toggle */}
          <View
            style={[
              styles.segmentContainer,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <TouchableOpacity
              style={[
                styles.segmentBtn,
                provider === 'aistudio' && { backgroundColor: colors.accent },
              ]}
              onPress={() => handleProviderChange('aistudio')}
              accessibilityLabel="Google AI Studio"
            >
              <Text
                style={[
                  styles.segmentText,
                  {
                    color:
                      provider === 'aistudio'
                        ? colors.accentText
                        : colors.textSecondary,
                  },
                ]}
              >
                Google AI Studio
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.segmentBtn,
                provider === 'openrouter' && { backgroundColor: colors.accent },
              ]}
              onPress={() => handleProviderChange('openrouter')}
              accessibilityLabel="OpenRouter"
            >
              <Text
                style={[
                  styles.segmentText,
                  {
                    color:
                      provider === 'openrouter'
                        ? colors.accentText
                        : colors.textSecondary,
                  },
                ]}
              >
                OpenRouter
              </Text>
            </TouchableOpacity>
          </View>

          {/* 3 Steps */}
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
                Sign in to Google AI Studio with your Google account
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
                  : 'Paste OpenRouter Key (sk-or-...)'
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
              disabled={isTesting || !apiKey.trim()}
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
          <Text style={[styles.privacyNote, { color: colors.textSecondary }]}>
            🔒 Your key is stored only on this device in secure storage and never sent to any server.
          </Text>
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
  segmentContainer: {
    flexDirection: 'row',
    borderRadius: BorderRadius.button,
    borderWidth: 1,
    padding: 3,
  },
  segmentBtn: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: BorderRadius.button - 3,
  },
  segmentText: {
    fontSize: FontSize.caption,
    fontWeight: '600',
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
  privacyNote: {
    fontSize: FontSize.tiny + 1,
    textAlign: 'center',
    lineHeight: 16,
  },
});
