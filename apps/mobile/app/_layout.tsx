import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useFonts } from 'expo-font';
import { Archivo_600SemiBold, Archivo_700Bold } from '@expo-google-fonts/archivo';
import { ArchivoBlack_400Regular } from '@expo-google-fonts/archivo-black';
import {
  Figtree_400Regular,
  Figtree_500Medium,
  Figtree_600SemiBold,
} from '@expo-google-fonts/figtree';

import { Text } from '@/components/Text.tsx';
import { EntitlementProvider } from '@/state/entitlement.tsx';
import { SessionProvider, useSession } from '@/state/session.tsx';
import { ThemeProvider, useTheme } from '@/theme/index.tsx';

function Boot() {
  const theme = useTheme();
  const { ready, error, session } = useSession();

  const [fontsLoaded, fontError] = useFonts({
    Archivo_600SemiBold,
    Archivo_700Bold,
    ArchivoBlack_400Regular,
    Figtree_400Regular,
    Figtree_500Medium,
    Figtree_600SemiBold,
  });

  // A font failure must not block the app — the type falls back to the system
  // face and everything stays usable, which is better than a dead screen.
  const typeReady = fontsLoaded || Boolean(fontError);

  if (!ready || !typeReady) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: theme.palette.background,
        }}
      >
        <ActivityIndicator color={theme.palette.celesteInk} />
      </View>
    );
  }

  if (error) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          padding: theme.spacing.xl,
          gap: theme.spacing.md,
          backgroundColor: theme.palette.background,
        }}
      >
        <Text variant="heading">Daylish could not start</Text>
        <Text variant="caption" tone="secondary" style={{ textAlign: 'center' }}>
          {error}
        </Text>
      </View>
    );
  }

  /**
   * The gate.
   *
   * `Stack.Protected` unmounts everything behind it the moment `guard` goes
   * false, which is what makes signing out safe: the journal is torn down rather
   * than left rendered underneath a redirect, so there is no frame in which the
   * next person to pick up the phone sees the last one's food.
   */
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: theme.palette.background },
      }}
    >
      <Stack.Protected guard={Boolean(session)}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="onboarding" />
        <Stack.Screen name="scan" options={{ presentation: 'modal' }} />
        <Stack.Screen name="search" options={{ presentation: 'modal' }} />
        <Stack.Screen name="quick-add" options={{ presentation: 'modal' }} />
        <Stack.Screen name="weigh-in" options={{ presentation: 'modal' }} />
        <Stack.Screen name="fasting" options={{ presentation: 'modal' }} />
        <Stack.Screen name="edit-item" options={{ presentation: 'modal' }} />
        <Stack.Screen name="recipe" options={{ presentation: 'modal' }} />
        <Stack.Screen name="shopping-list" options={{ presentation: 'modal' }} />
        <Stack.Screen name="premium" options={{ presentation: 'modal' }} />
      </Stack.Protected>

      <Stack.Protected guard={!session}>
        <Stack.Screen name="sign-in" />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <EntitlementProvider>
          <SessionProvider>
            <StatusBar style="dark" />
            <Boot />
          </SessionProvider>
        </EntitlementProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
