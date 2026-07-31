import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/Button.tsx';
import { Illustration } from '@/components/Illustration.tsx';
import { Text } from '@/components/Text.tsx';
import { Ticket } from '@/components/Ticket.tsx';
import { requireSupabase } from '@/lib/supabase.ts';
import { MIN_TAP_TARGET, useTheme } from '@/theme/index.tsx';

type Mode = 'signIn' | 'signUp';

/** Supabase rejects anything shorter, and saying so up front beats a round trip. */
const MIN_PASSWORD = 6;

/**
 * Sign in or create an account.
 *
 * One screen with a mode toggle rather than two, because the fields are
 * identical and the only real difference is which button is the destructive one
 * to press by mistake — someone who meant to sign in and accidentally creates a
 * second account has lost their diary as far as they can tell.
 *
 * Email and password only. Adding Google or Facebook sign-in would oblige us to
 * offer Sign in with Apple as well (App Review guideline 4.8), which is a
 * larger piece of work than it looks and is not needed to ship.
 */
export default function SignInScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  const [mode, setMode] = useState<Mode>('signIn');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkEmail, setCheckEmail] = useState(false);

  const trimmed = email.trim();
  const valid = useMemo(
    () => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(trimmed) && password.length >= MIN_PASSWORD,
    [trimmed, password],
  );

  const submit = useCallback(async () => {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);

    try {
      const client = requireSupabase();
      if (mode === 'signUp') {
        const { data, error: failure } = await client.auth.signUp({
          email: trimmed,
          password,
        });
        if (failure) throw failure;
        // With email confirmation switched on, Supabase returns a user but no
        // session. Saying "check your email" is the only honest thing to show —
        // otherwise the screen just sits there having apparently done nothing.
        if (!data.session) setCheckEmail(true);
      } else {
        const { error: failure } = await client.auth.signInWithPassword({
          email: trimmed,
          password,
        });
        if (failure) throw failure;
      }
      // On success the auth listener in SessionProvider swaps the route out;
      // this screen does not navigate by itself.
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  }, [valid, busy, mode, trimmed, password]);

  if (checkEmail) {
    return (
      <View
        style={{
          flex: 1,
          justifyContent: 'center',
          paddingHorizontal: theme.spacing.lg,
          gap: theme.spacing.lg,
        }}
      >
        <Ticket rule={theme.palette.celesteInk} label="Almost there">
          <Text variant="title">Check your email</Text>
          <Text variant="caption" tone="secondary">
            We sent a confirmation link to {trimmed}. Open it, then come back and sign in.
          </Text>
          <Button
            label="Back to sign in"
            variant="secondary"
            onPress={() => {
              setCheckEmail(false);
              setMode('signIn');
              setPassword('');
            }}
            block
          />
        </Ticket>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: 'center',
          paddingHorizontal: theme.spacing.lg,
          paddingTop: insets.top + theme.spacing.lg,
          paddingBottom: insets.bottom + theme.spacing.xxl,
          gap: theme.spacing.lg,
        }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={{ alignItems: 'center', gap: theme.spacing.xs }}>
          <Illustration name="welcome" height={132} />
          <Text variant="display">Daylish</Text>
          <Text variant="caption" tone="secondary">
            Your whole day, delicious.
          </Text>
        </View>

        <Ticket
          rule={theme.palette.sun}
          label={mode === 'signIn' ? 'Sign in' : 'Create an account'}
        >
          <Field
            label="Email"
            value={email}
            onChangeText={(next) => {
              setEmail(next);
              setError(null);
            }}
            placeholder="you@example.com"
            keyboardType="email-address"
            textContentType="emailAddress"
            autoComplete="email"
          />
          <Field
            label="Password"
            value={password}
            onChangeText={(next) => {
              setPassword(next);
              setError(null);
            }}
            placeholder={`At least ${MIN_PASSWORD} characters`}
            secureTextEntry
            textContentType={mode === 'signUp' ? 'newPassword' : 'password'}
            autoComplete={mode === 'signUp' ? 'new-password' : 'current-password'}
          />

          {error ? (
            <Text variant="caption" tone="sun">
              {error}
            </Text>
          ) : null}

          {busy ? (
            <View style={{ minHeight: MIN_TAP_TARGET, justifyContent: 'center' }}>
              <ActivityIndicator color={theme.palette.celesteInk} />
            </View>
          ) : (
            <Button
              label={mode === 'signIn' ? 'Sign in' : 'Create account'}
              onPress={submit}
              disabled={!valid}
              block
            />
          )}
        </Ticket>

        <Pressable
          onPress={() => {
            setMode((m) => (m === 'signIn' ? 'signUp' : 'signIn'));
            setError(null);
          }}
          accessibilityRole="button"
          style={{ minHeight: MIN_TAP_TARGET, alignItems: 'center', justifyContent: 'center' }}
        >
          <Text variant="caption" tone="celeste">
            {mode === 'signIn'
              ? 'No account yet? Create one'
              : 'Already have an account? Sign in'}
          </Text>
        </Pressable>

        <Text variant="caption" tone="muted" style={{ textAlign: 'center' }}>
          Your diary is stored on this phone. Your account exists so it can follow you to your
          next one.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Field({
  label,
  ...input
}: { label: string } & React.ComponentProps<typeof TextInput>) {
  const theme = useTheme();
  return (
    <View style={{ gap: theme.spacing.xs }}>
      <Text variant="eyebrow" tone="muted">
        {label}
      </Text>
      <TextInput
        autoCapitalize="none"
        autoCorrect={false}
        accessibilityLabel={label}
        placeholderTextColor={theme.palette.inkMuted}
        style={{
          minHeight: MIN_TAP_TARGET,
          paddingHorizontal: theme.spacing.lg,
          borderRadius: theme.radii.md,
          backgroundColor: theme.palette.surfaceSunken,
          color: theme.palette.ink,
          fontFamily: theme.fonts.body,
          fontSize: theme.typography.body.fontSize,
        }}
        {...input}
      />
    </View>
  );
}
