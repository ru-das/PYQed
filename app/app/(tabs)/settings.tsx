import React, { useState, useEffect, useSyncExternalStore } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Linking,
  Alert,
  Switch,
} from 'react-native';
import Constants from 'expo-constants';
import { Logo } from '../../src/components/Logo';
import { ProviderSelect } from '../../src/components/ProviderSelect';
import * as Haptics from '../../src/haptics';
import { Ionicons } from '@expo/vector-icons';
import {
  useThemeColors,
  Spacing,
  FontSize,
  BorderRadius,
} from '../../src/theme';
import {
  Provider,
  DEFAULT_PROVIDER,
  DEFAULT_MODEL_AISTUDIO,
  ALT_MODEL_AISTUDIO,
} from '../../src/config';
import { getApiSettings, setActiveProvider, updateApiSettings } from '../../src/ai/settings';
import { generateJSON } from '../../src/ai/client';
import { getPrefs, setPrefs, subscribePrefs, Prefs } from '../../src/prefs';

/** A row of mutually exclusive options, styled like the model chips. */
function Choice<T extends string | number | boolean>({ value, options, onChange }: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  const colors = useThemeColors();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, marginTop: Spacing.xs }}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <TouchableOpacity
            key={String(o.value)}
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onChange(o.value); }}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            accessibilityLabel={o.label}
            style={{
              minHeight: 44, justifyContent: 'center', paddingHorizontal: 14,
              borderRadius: BorderRadius.chip, borderWidth: 1,
              backgroundColor: colors.card, borderColor: on ? colors.accent : colors.border,
            }}
          >
            <Text style={{ fontSize: FontSize.caption + 1, fontWeight: '600', color: on ? colors.accent : colors.textSecondary }}>
              {o.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

export default function SettingsScreen() {
  const colors = useThemeColors();
  const prefs = useSyncExternalStore(subscribePrefs, getPrefs);
  const set = (p: Partial<Prefs>) => { setPrefs(p); };

  const [provider, setProvider] = useState<Provider>(DEFAULT_PROVIDER);
  const [apiKey, setApiKey] = useState<string>('');
  const [modelId, setModelId] = useState<string>(DEFAULT_MODEL_AISTUDIO);
  const [baseUrl, setBaseUrl] = useState<string>('');
  const [isKeyVisible, setIsKeyVisible] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isTesting, setIsTesting] = useState<boolean>(false);
  const [testResult, setTestResult] = useState<{
    success?: boolean;
    message?: string;
  } | null>(null);

  // Load saved settings
  useEffect(() => {
    getApiSettings()
      .then((cfg) => {
        setProvider(cfg.provider);
        setApiKey(cfg.apiKey);
        setModelId(cfg.modelId);
        setBaseUrl(cfg.baseUrl);
      })
      .finally(() => setIsLoading(false));
  }, []);

  const handleSwitchProvider = async (newProvider: Provider) => {
    if (newProvider === provider) return;
    setProvider(newProvider);
    setTestResult(null);
    const cfg = await setActiveProvider(newProvider);
    setApiKey(cfg.apiKey);
    setModelId(cfg.modelId);
    setBaseUrl(cfg.baseUrl);
  };

  // Saved as you type, so there is no Save button to forget
  const handleSaveKey = (text: string) => {
    setApiKey(text);
    setTestResult(null);
    updateApiSettings({ apiKey: text }).catch(() => {});
  };

  const handleSaveBaseUrl = (text: string) => {
    setBaseUrl(text);
    setTestResult(null);
    updateApiSettings({ baseUrl: text }).catch(() => {});
  };

  const handleSaveModel = (text: string) => {
    setModelId(text);
    setTestResult(null);
    if (text.trim()) updateApiSettings({ modelId: text }).catch(() => {});
  };

  // Test API key
  const handleTestKey = async () => {
    // OpenAI-compatible servers may be keyless, but need a base URL and a model
    if (provider === 'openai') {
      if (!baseUrl.trim() || !modelId.trim()) {
        Alert.alert('Details needed', 'Enter the base URL and model ID to test.');
        return;
      }
    } else if (!apiKey.trim()) {
      Alert.alert('API Key Required', 'Please enter an API key to test.');
      return;
    }

    setIsTesting(true);
    setTestResult(null);

    try {
      const result = await generateJSON({
        prompt:
          'Ping test. Return JSON strictly in format: {"status": "ok"}',
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
          message: `Key works! Response time: ${result.timeMs}ms`,
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

  const getMaskedKey = (key: string) => {
    if (!key) return '';
    if (key.length <= 8) return '••••••••';
    return '••••••••••••' + key.slice(-4);
  };

  if (isLoading) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      {/* Section: Provider */}
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>
          AI PROVIDER
        </Text>
        <ProviderSelect value={provider} onChange={handleSwitchProvider} />
      </View>

      {/* Section: Base URL (OpenAI-compatible only) */}
      {provider === 'openai' && (
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>
            BASE URL
          </Text>
          <View
            style={[
              styles.inputRow,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <TextInput
              style={[styles.input, { color: colors.text }]}
              placeholder="https://api.groq.com/openai/v1"
              placeholderTextColor={colors.textSecondary}
              value={baseUrl}
              onChangeText={handleSaveBaseUrl}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
            />
          </View>
          <Text style={[styles.helperText, { color: colors.textSecondary }]}>
            Any service with an OpenAI-style /chat/completions API. Pick a model that can read images.
          </Text>
        </View>
      )}

      {/* Section: API Key */}
      <View style={styles.section}>
        <View style={styles.rowBetween}>
          <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>
            API KEY
          </Text>
          {provider !== 'openai' && (
            <TouchableOpacity
              onPress={() =>
                Linking.openURL(
                  provider === 'aistudio'
                    ? 'https://aistudio.google.com/apikey'
                    : 'https://openrouter.ai/keys',
                )
              }
              accessibilityLabel="Get free key"
            >
              <Text style={[styles.linkText, { color: colors.accent }]}>
                Get free key ↗
              </Text>
            </TouchableOpacity>
          )}
        </View>

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
            onChangeText={handleSaveKey}
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

        {apiKey.length > 0 && (
          <Text style={[styles.helperText, { color: colors.textSecondary }]}>
            Stored securely on device: {getMaskedKey(apiKey)}
          </Text>
        )}
      </View>

      {/* Section: Model ID */}
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>
          MODEL ID
        </Text>
        <View
          style={[
            styles.inputRow,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <TextInput
            style={[styles.input, { color: colors.text }]}
            value={modelId}
            onChangeText={handleSaveModel}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>

        {provider === 'aistudio' && (
          <View style={styles.quickModelRow}>
            <TouchableOpacity
              style={[
                styles.quickChip,
                { backgroundColor: colors.card, borderColor: colors.border },
                modelId === DEFAULT_MODEL_AISTUDIO && {
                  borderColor: colors.accent,
                },
              ]}
              onPress={() => handleSaveModel(DEFAULT_MODEL_AISTUDIO)}
            >
              <Text
                style={[
                  styles.quickChipText,
                  {
                    color:
                      modelId === DEFAULT_MODEL_AISTUDIO
                        ? colors.accent
                        : colors.textSecondary,
                  },
                ]}
              >
                26B MoE (default)
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.quickChip,
                { backgroundColor: colors.card, borderColor: colors.border },
                modelId === ALT_MODEL_AISTUDIO && {
                  borderColor: colors.accent,
                },
              ]}
              onPress={() => handleSaveModel(ALT_MODEL_AISTUDIO)}
            >
              <Text
                style={[
                  styles.quickChipText,
                  {
                    color:
                      modelId === ALT_MODEL_AISTUDIO
                        ? colors.accent
                        : colors.textSecondary,
                  },
                ]}
              >
                31B Dense (larger)
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* Section: Thinking */}
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>THINKING</Text>
        <Choice
          value={prefs.thinking}
          onChange={(v) => set({ thinking: v })}
          options={[{ value: true, label: 'On (recommended)' }, { value: false, label: 'Off' }]}
        />
        <Text style={[styles.helperText, { color: colors.textSecondary }]}>
          {prefs.thinking
            ? 'Gemma works through each page before answering. It misses fewer questions on messy scans and tables, but a page can take a minute or more and uses more of your daily limit.'
            : 'Answers come back in seconds and use less of your daily limit, but expect more missed questions and wrong marks, so check the review screen closely.'}
        </Text>
        {provider === 'openai' && (
          <Text style={[styles.helperText, { color: colors.textSecondary }]}>
            Your server decides whether the model thinks; this switch only works for Google AI Studio and OpenRouter.
          </Text>
        )}
      </View>

      {/* Test Key Button */}
      <TouchableOpacity
        style={[
          styles.actionBtn,
          { backgroundColor: colors.accent },
          isTesting && { opacity: 0.7 },
        ]}
        onPress={handleTestKey}
        disabled={isTesting}
        accessibilityLabel="Test API Key"
      >
        {isTesting ? (
          <ActivityIndicator color={colors.accentText} size="small" />
        ) : (
          <>
            <Ionicons
              name="checkmark-circle-outline"
              size={20}
              color={colors.accentText}
            />
            <Text style={[styles.actionBtnText, { color: colors.accentText }]}>
              Test Key
            </Text>
          </>
        )}
      </TouchableOpacity>

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
            size={20}
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

      {/* Section: Appearance */}
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>APPEARANCE</Text>
        <Choice
          value={prefs.theme}
          onChange={(v) => set({ theme: v })}
          options={[{ value: 'system', label: 'Match phone' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]}
        />
      </View>

      {/* Section: Imports */}
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>PAGES PER IMPORT</Text>
        <Choice
          value={prefs.maxPages}
          onChange={(v) => set({ maxPages: v })}
          options={[{ value: 10, label: '10' }, { value: 30, label: '30' }, { value: 60, label: '60' }]}
        />
        <Text style={[styles.helperText, { color: colors.textSecondary }]}>
          Pages past this are skipped. A lower number saves your free daily limit.
        </Text>
      </View>

      {/* Section: Sharing */}
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>SHARING PAGE IMAGES</Text>
        <Choice
          value={prefs.shareImages}
          onChange={(v) => set({ shareImages: v })}
          options={[{ value: 'ask', label: 'Ask each time' }, { value: 'without', label: 'Never' }, { value: 'with', label: 'Always' }]}
        />
        <Text style={[styles.helperText, { color: colors.textSecondary }]}>
          Images make the shared file much bigger.
        </Text>
      </View>

      {/* Section: Feedback */}
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>FEEDBACK</Text>
        {([
          ['haptics', 'Vibration', 'A small tap when you save or answer a flashcard.'],
          ['notifications', 'Notifications', 'Progress and "done" alerts while a long import runs.'],
        ] as const).map(([key, label, hint]) => (
          <View key={key} style={[styles.rowBetween, { marginTop: Spacing.xs }]}>
            <View style={{ flex: 1, paddingRight: Spacing.md }}>
              <Text style={{ color: colors.text, fontSize: FontSize.body, fontWeight: '600' }}>{label}</Text>
              <Text style={[styles.helperText, { color: colors.textSecondary, marginTop: 0 }]}>{hint}</Text>
            </View>
            <Switch
              value={prefs[key]}
              onValueChange={(v) => set({ [key]: v })}
              trackColor={{ true: colors.accent, false: colors.border }}
              accessibilityLabel={label}
            />
          </View>
        ))}
      </View>

      {/* Section: About & Privacy */}
      <View
        style={[
          styles.aboutCard,
          { backgroundColor: colors.card, borderColor: colors.border },
        ]}
      >
        <View style={{ alignItems: 'center', marginBottom: Spacing.sm }}>
          <Logo size={72} />
        </View>
        <Text style={[styles.aboutTitle, { color: colors.text }]}>
          About PYQed
        </Text>
        <Text style={[styles.aboutBody, { color: colors.textSecondary, marginTop: Spacing.sm }]}>
          <Text style={{ fontWeight: '600' }}>Privacy:</Text> Papers and syllabi are sent to your chosen provider only while importing. Everything else stays on this phone. Your API key is kept in secure storage and is never included in shared files.
        </Text>
        <Text style={[styles.versionText, { color: colors.textSecondary, marginTop: Spacing.md }]}>
          Version {Constants.expoConfig?.version}
        </Text>
      </View>
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
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  section: {
    gap: Spacing.xs,
  },
  sectionTitle: {
    fontSize: FontSize.caption,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  linkText: {
    fontSize: FontSize.caption,
    fontWeight: '600',
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: BorderRadius.button,
    borderWidth: 1,
    paddingHorizontal: Spacing.md,
    marginTop: Spacing.xs,
  },
  input: {
    flex: 1,
    paddingVertical: 12,
    fontSize: FontSize.body,
  },
  iconBtn: {
    padding: Spacing.xs,
  },
  helperText: {
    fontSize: FontSize.caption,
    marginTop: Spacing.xs,
  },
  quickModelRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginTop: Spacing.xs,
  },
  quickChip: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: BorderRadius.chip,
    borderWidth: 1,
  },
  quickChipText: {
    fontSize: FontSize.caption,
    fontWeight: '500',
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
  resultBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    padding: Spacing.md,
    borderRadius: BorderRadius.card,
    borderWidth: 1,
  },
  resultText: {
    flex: 1,
    fontSize: FontSize.caption + 1,
    fontWeight: '500',
  },
  aboutCard: {
    padding: Spacing.md,
    borderRadius: BorderRadius.card,
    borderWidth: 1,
  },
  aboutTitle: {
    fontSize: FontSize.h3,
    fontWeight: '700',
    marginBottom: Spacing.xs,
  },
  aboutBody: {
    fontSize: FontSize.caption + 1,
    lineHeight: 20,
  },
  versionText: {
    fontSize: FontSize.caption,
    textAlign: 'center',
  },
});
