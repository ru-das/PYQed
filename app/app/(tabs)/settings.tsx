import React, { useState, useEffect, useSyncExternalStore } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  Linking,
  Switch,
} from 'react-native';
import Constants from 'expo-constants';
import { Logo } from '../../src/components/Logo';
import { ProviderSelect } from '../../src/components/ProviderSelect';
import { Button, Chip } from '../../src/components/ui';
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

type IconName = keyof typeof Ionicons.glyphMap;

/** Small icon in front of a section heading. */
function SectionTitle({ icon, text }: { icon: IconName; text: string }) {
  const colors = useThemeColors();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <Ionicons name={icon} size={16} color={colors.textSecondary} />
      <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>{text}</Text>
    </View>
  );
}

/** A row of mutually exclusive options. */
function Choice<T extends string | number | boolean>({ value, options, onChange }: {
  value: T;
  options: { value: T; label: string; icon?: IconName }[];
  onChange: (v: T) => void;
}) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, marginTop: Spacing.xs }}>
      {options.map((o) => (
        <Chip
          key={String(o.value)}
          label={o.label}
          icon={o.icon}
          active={o.value === value}
          accessibilityRole="radio"
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onChange(o.value); }}
        />
      ))}
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

  // OpenAI-compatible servers may be keyless, but need a base URL and a model ID
  const canTest =
    provider === 'openai' ? baseUrl.trim().length > 0 && modelId.trim().length > 0 : apiKey.trim().length > 0;

  // Test API key
  const handleTestKey = async () => {
    if (!canTest) return;

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

  if (isLoading) return <View style={{ flex: 1, backgroundColor: colors.background }} />;

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      {/* Section: Provider */}
      <View style={styles.section}>
        <SectionTitle icon="sparkles-outline" text="AI PROVIDER" />
        <ProviderSelect value={provider} onChange={handleSwitchProvider} />
      </View>

      {/* Section: Base URL (OpenAI-compatible only) */}
      {provider === 'openai' && (
        <View style={styles.section}>
          <SectionTitle icon="link-outline" text="BASE URL" />
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
          <SectionTitle icon="key-outline" text="API KEY" />
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
        <SectionTitle icon="hardware-chip-outline" text="MODEL ID" />
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
            <Chip label="26B MoE (default)" active={modelId === DEFAULT_MODEL_AISTUDIO} onPress={() => handleSaveModel(DEFAULT_MODEL_AISTUDIO)} />
            <Chip label="31B Dense (larger)" active={modelId === ALT_MODEL_AISTUDIO} onPress={() => handleSaveModel(ALT_MODEL_AISTUDIO)} />
          </View>
        )}
      </View>

      {/* Section: Thinking */}
      <View style={styles.section}>
        <SectionTitle icon="bulb-outline" text="THINKING" />
        <Choice
          value={prefs.thinking}
          onChange={(v) => set({ thinking: v })}
          options={[{ value: true, label: 'On (recommended)', icon: 'bulb-outline' }, { value: false, label: 'Off', icon: 'flash-outline' }]}
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
      <Button
        label="Test Key"
        variant="outline"
        icon="checkmark-circle-outline"
        loading={isTesting}
        disabled={!canTest}
        onPress={handleTestKey}
        accessibilityLabel="Test API Key"
      />

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
        <SectionTitle icon="color-palette-outline" text="APPEARANCE" />
        <Choice
          value={prefs.theme}
          onChange={(v) => set({ theme: v })}
          options={[{ value: 'system', label: 'Match phone', icon: 'phone-portrait-outline' }, { value: 'light', label: 'Light', icon: 'sunny-outline' }, { value: 'dark', label: 'Dark', icon: 'moon-outline' }]}
        />
      </View>

      {/* Section: Imports */}
      <View style={styles.section}>
        <SectionTitle icon="documents-outline" text="PAGES PER IMPORT" />
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
        <SectionTitle icon="share-outline" text="SHARING PAGE IMAGES" />
        <Choice
          value={prefs.shareImages}
          onChange={(v) => set({ shareImages: v })}
          options={[{ value: 'ask', label: 'Ask each time', icon: 'help-circle-outline' }, { value: 'without', label: 'Never', icon: 'close-circle-outline' }, { value: 'with', label: 'Always', icon: 'images-outline' }]}
        />
        <Text style={[styles.helperText, { color: colors.textSecondary }]}>
          Images make the shared file much bigger.
        </Text>
      </View>

      {/* Section: Feedback */}
      <View style={styles.section}>
        <SectionTitle icon="options-outline" text="FEEDBACK" />
        {([
          ['haptics', 'Vibration', 'A small tap when you save or answer a flashcard.', 'pulse-outline'],
          ['notifications', 'Notifications', 'Progress and "done" alerts while a long import runs.', 'notifications-outline'],
        ] as const).map(([key, label, hint, icon]) => (
          <View key={key} style={[styles.rowBetween, { marginTop: Spacing.xs }]}>
            <Ionicons name={icon} size={22} color={colors.textSecondary} style={{ marginRight: Spacing.sm }} />
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
