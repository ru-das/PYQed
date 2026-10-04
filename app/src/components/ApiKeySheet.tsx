import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from '../haptics';
import { useThemeColors, Spacing, FontSize, BorderRadius } from '../theme';
import { ProviderSelect } from './ProviderSelect';
import { Button, Sheet, SheetScroll } from './ui';
import {
  Provider,
  DEFAULT_PROVIDER,
  DEFAULT_MODEL_AISTUDIO,
  KEY_PAGES,
  KEY_PLACEHOLDER,
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
    <Sheet
      visible={visible}
      title={provider === 'aistudio' ? 'Add a free Google AI Studio key' : `Connect ${PROVIDER_LABELS[provider]}`}
      subtitle="Required for AI to analyze syllabus and exam papers."
      onClose={onDismiss}
    >
      <SheetScroll>
        <View style={styles.body}>
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
                onPress={() => Linking.openURL(KEY_PAGES[provider])}
                style={styles.linkButton}
                accessibilityLabel="Open API key page"
              >
                <Text style={[styles.linkButtonText, { color: colors.accent }]}>
                  Get free key at {PROVIDER_LABELS[provider]} ↗
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
            placeholder={KEY_PLACEHOLDER[provider]}
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
          <Button
            label="Test key"
            variant="outline"
            icon="checkmark-circle-outline"
            loading={isTesting}
            disabled={!canTest}
            onPress={handleTestKey}
            accessibilityLabel="Test API Key"
          />
          <Button
            label="Continue"
            disabled={!canContinue}
            onPress={handleContinue}
            style={{ flex: 1 }}
            accessibilityLabel="Continue import"
          />
        </View>

        {/* Privacy Note */}
        <View style={styles.privacyRow}>
          <Ionicons name="lock-closed-outline" size={14} color={colors.textSecondary} />
          <Text style={[styles.privacyNote, { color: colors.textSecondary, flex: 1 }]}>
            Your key is stored only on this device in secure storage and never sent to any server.
          </Text>
        </View>
        </View>
      </SheetScroll>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: { gap: Spacing.md },
  subtitle: {
    fontSize: FontSize.caption,
    marginTop: 2,
    lineHeight: 18,
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
