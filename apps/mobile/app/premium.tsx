import { useEffect, useState } from 'react';
import { Alert, Linking, Pressable, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PREMIUM_FEATURES } from '@daylish/core';

import { Button } from '@/components/Button.tsx';
import { Illustration } from '@/components/Illustration.tsx';
import { Text } from '@/components/Text.tsx';
import { Divider, Ticket } from '@/components/Ticket.tsx';
import {
  listOfferings,
  overrideAvailable,
  purchase,
  purchasesConfigured,
  restorePurchases,
  type Offering,
} from '@/state/entitlement.tsx';
import { useEntitlements } from '@/state/entitlement.tsx';
import { useSession } from '@/state/session.tsx';
import { enableBillingAlerts } from '@/lib/push.ts';
import { PRIVACY_URL, TERMS_URL } from '@/lib/links.ts';
import { useTheme } from '@/theme/index.tsx';

/**
 * One of the two links guideline 3.1.2 requires on a subscription screen.
 *
 * Its own component so both get the same tap target, the same failure message
 * and the `link` role, which is what tells VoiceOver this leaves the app.
 */
function LegalLink({ label, url }: { label: string; url: string }) {
  const open = async () => {
    try {
      await Linking.openURL(url);
    } catch {
      Alert.alert('Could not open the link', `You can read it at ${url}`);
    }
  };

  return (
    <Pressable
      onPress={() => void open()}
      accessibilityRole="link"
      accessibilityLabel={`${label}, opens in your browser`}
      hitSlop={8}
      style={{ minHeight: 44, justifyContent: 'center' }}
    >
      <Text variant="caption" tone="celeste">
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * What Premium is.
 *
 * Deliberately not a hard paywall: it is reachable, dismissable, and it does not
 * interrupt anything. Someone arrives here because they tapped a locked feature
 * and wanted to know what it does — so the job is to answer that honestly, not
 * to pressure them.
 *
 * The free tier is stated as plainly as the paid one. An app that hides what you
 * already have in order to sell what you do not is one people stop trusting
 * about everything else, including its calorie numbers.
 *
 * **The plan buttons appear only when the store returns something to sell**, so
 * a build with no RevenueCat key — every build until the Paid Applications
 * Agreement is active — shows the case for Premium without a button that cannot
 * take money. Prices always come from StoreKit rather than from this file.
 */
export default function PremiumScreen() {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { isPremium, source, setOverride, refresh } = useEntitlements();
  const { profile } = useSession();

  const [offerings, setOfferings] = useState<Offering[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void listOfferings().then(setOfferings);
  }, []);

  /**
   * Ask before iOS asks.
   *
   * The system prompt can be shown exactly once per install, and it gives no
   * context beyond the app's name — so firing it cold burns the only chance on a
   * question the person has not been told the point of. This asks in plain words
   * first and only spends the real prompt on a yes, which is the same reasoning
   * that keeps the reminders prompt behind the reminders switch.
   *
   * Deliberately not a blocker: declining returns to the app with the purchase
   * complete and nothing withheld.
   */
  const offerBillingAlerts = async () => {
    if (!profile) return;

    const wanted = await new Promise<boolean>((resolve) => {
      Alert.alert(
        'Tell you if a payment fails?',
        'The only thing we would ever send about your subscription — in time to fix it before access stops. Nothing promotional, ever.',
        [
          { text: 'No thanks', style: 'cancel', onPress: () => resolve(false) },
          { text: 'Yes, tell me', onPress: () => resolve(true) },
        ],
        { cancelable: false },
      );
    });

    if (wanted) await enableBillingAlerts(profile.id).catch(() => false);
  };

  const handlePurchase = async (offeringId: string) => {
    setBusy(true);
    try {
      const bought = await purchase(offeringId);
      await refresh();
      if (bought) {
        // After the purchase resolves, not before: a permission dialog stacked
        // on top of Apple's payment sheet is how people tap the wrong thing.
        await offerBillingAlerts();
        router.back();
      }
    } catch (cause) {
      Alert.alert(
        'That did not go through',
        cause instanceof Error ? cause.message : 'Nothing has been charged. Please try again.',
      );
    } finally {
      setBusy(false);
    }
  };

  /**
   * Required by guideline 3.1.1, and separate from buying.
   *
   * Someone reinstalling on a new phone has already paid; making them find this
   * is better than making them pay twice, so it is a visible control rather
   * than something buried in support.
   */
  const handleRestore = async () => {
    setBusy(true);
    try {
      const restored = await restorePurchases();
      await refresh();
      Alert.alert(
        restored ? 'Restored' : 'Nothing to restore',
        restored
          ? 'Your subscription is active on this device again.'
          : 'No previous purchase was found for this Apple ID.',
      );
    } catch (cause) {
      Alert.alert(
        'Could not restore',
        cause instanceof Error ? cause.message : 'Please try again.',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView
      contentContainerStyle={{
        paddingHorizontal: theme.spacing.lg,
        paddingTop: insets.top + theme.spacing.lg,
        paddingBottom: insets.bottom + theme.spacing.xxl,
        gap: theme.spacing.lg,
      }}
      showsVerticalScrollIndicator={false}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Text variant="display" style={{ flex: 1 }}>
          Premium
        </Text>
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Close"
          hitSlop={12}
        >
          <Text tone="secondary">Close</Text>
        </Pressable>
      </View>

      <Illustration name="premium" height={140} />

      <Text variant="heading">
        Daylish is a calorie tracker for free. Premium makes it a health app.
      </Text>
      <Text variant="caption" tone="secondary">
        Logging stays free forever — barcode, search, quick add, your whole
        journal, and exporting all of it whenever you like. Premium is for
        understanding what is happening to you, and planning what happens next.
      </Text>

      <Ticket rule={theme.palette.sun} label="What you get">
        {PREMIUM_FEATURES.map((feature, index) => (
          <View key={feature.title} style={{ gap: theme.spacing.md }}>
            {index > 0 ? <Divider /> : null}
            <View style={{ gap: 2 }}>
              <Text variant="bodyStrong">{feature.title}</Text>
              <Text variant="caption" tone="muted">
                {feature.blurb}
              </Text>
            </View>
          </View>
        ))}
      </Ticket>

      {/* Said out loud, because a tier list that only describes the paid side
          reads as a list of things being withheld. */}
      <Ticket label="Free, always">
        <Text variant="caption" tone="secondary">
          Logging by barcode, search and quick add. Your full journal and history.
          Today's calories and macros against your target. Fifty recipes, filtered
          by your allergens. Exporting everything, and your diary backed up to
          your account so it survives a lost phone.
        </Text>
      </Ticket>

      {isPremium ? (
        <Ticket rule={theme.palette.celesteInk} label="Active">
          <Text variant="caption" tone="secondary">
            {source === 'override'
              ? 'Premium is switched on for testing on this device. It is not a purchase and nothing has been charged.'
              : 'Premium is active on this account.'}
          </Text>
        </Ticket>
      ) : null}

      {/*
        Prices come from the store, never from here. A paywall whose stated
        price differs from StoreKit's is an App Review rejection, and a
        hardcoded one is wrong in every currency but one.
      */}
      {!isPremium && offerings.length > 0 ? (
        <Ticket rule={theme.palette.sun} label="Choose a plan">
          {offerings.map((offering) => (
            <Button
              key={offering.id}
              label={busy ? 'One moment…' : `${offering.title} · ${offering.price}`}
              onPress={busy ? () => {} : () => void handlePurchase(offering.id)}
              block
            />
          ))}
          <Text variant="caption" tone="muted">
            Renews automatically until cancelled. Manage or cancel any time in your
            Apple ID settings.
          </Text>
        </Ticket>
      ) : null}

      {purchasesConfigured ? (
        <Pressable
          onPress={busy ? undefined : () => void handleRestore()}
          accessibilityRole="button"
          accessibilityLabel="Restore a previous purchase"
          style={{ minHeight: 44, justifyContent: 'center', alignItems: 'center' }}
        >
          <Text variant="captionStrong" tone="celeste">
            Restore purchases
          </Text>
        </Pressable>
      ) : null}

      {/*
        Terms and privacy, on the paywall itself.

        Guideline 3.1.2 requires a functional link to both from inside the app
        for an auto-renewing subscription — not only from the store listing —
        and their absence here is a routine rejection. They sit under the plan
        buttons because that is where someone is deciding, and the renewal terms
        immediately above are the short version of what they link to.

        `openURL` is guarded: a link that silently does nothing is worse than one
        that says it could not open, because the person is left thinking the
        terms do not exist.
      */}
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'center',
          alignItems: 'center',
          gap: theme.spacing.md,
        }}
      >
        <LegalLink label="Terms of Use" url={TERMS_URL} />
        <Text variant="caption" tone="muted">
          ·
        </Text>
        <LegalLink label="Privacy Policy" url={PRIVACY_URL} />
      </View>

      {/*
        The testing switch, which is absent from store builds.

        It unlocks every paid feature with nothing charged, so it belongs on a
        development or internal build and nowhere else — a free unlock that a
        customer finds is a free unlock that gets posted. `overrideAvailable` is
        false whenever EXPO_PUBLIC_ALLOW_PREMIUM_OVERRIDE is unset, which is the
        case for the `production` EAS environment and therefore for anything that
        reaches the App Store.

        App Review does not lose anything by this: reviewers buy through
        StoreKit's sandbox, which settles without money moving and exercises the
        real RevenueCat path rather than a flag that bypasses it.
      */}
      {overrideAvailable ? (
        <Ticket label="Testing">
          <Text variant="caption" tone="muted">
            {purchasesConfigured
              ? 'Unlocks the paid features locally for testing. It charges nothing and is not a subscription.'
              : 'Purchases are not configured in this build. This switch unlocks the paid features locally so they can be tested; it charges nothing.'}
          </Text>
          <Button
            label={isPremium ? 'Switch Premium off' : 'Switch Premium on for testing'}
            variant={isPremium ? 'quiet' : 'secondary'}
            onPress={() => void setOverride(!isPremium)}
            block
          />
        </Ticket>
      ) : null}
    </ScrollView>
  );
}
