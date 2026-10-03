import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useColorScheme } from 'react-native';
import { useThemeColors } from '../src/theme';

export default function RootLayout() {
  const scheme = useColorScheme();
  const colors = useThemeColors();

  return (
    <>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.text,
          headerTitleStyle: { fontWeight: '700' },
          headerShadowVisible: false,
          contentStyle: { backgroundColor: colors.background },
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="subject/[id]" options={{ title: 'Subject' }} />
        <Stack.Screen name="subject/edit" options={{ title: 'Subject' }} />
        <Stack.Screen name="subject/topic" options={{ title: 'Topic' }} />
        <Stack.Screen name="subject/paper" options={{ title: 'Paper' }} />
        <Stack.Screen name="subject/practice" options={{ title: 'Practice' }} />
        <Stack.Screen name="syllabus-import" options={{ title: 'Import syllabus' }} />
        <Stack.Screen name="paper-import" options={{ title: 'Add papers' }} />
      </Stack>
    </>
  );
}
