import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { MealSlot } from '@daylish/core';
import { nutrientsForGrams } from '@daylish/core';

import { Button } from '@/components/Button.tsx';
import { Ticket } from '@/components/Ticket.tsx';
import { ConfidenceBadge } from '@/components/ConfidenceBadge.tsx';
import { Text } from '@/components/Text.tsx';
import {
  cacheFood,
  searchCached,
  searchOpenFoodFacts,
  searchUsda,
  type ResolvedFood,
} from '@/data/foods.ts';
import { getFrequentFoods, logMeal } from '@/data/journal.ts';
import { listSavedMeals, logSavedMeal } from '@/data/saved-meals.ts';
import { MealSlotPicker } from './scan.tsx';
import { suggestMealSlot } from '@/lib/meal-slot.ts';
import { usdaTransport } from '@/lib/usda.ts';
import { useSession } from '@/state/session.tsx';
import { MIN_TAP_TARGET, useTheme } from '@/theme/index.tsx';

/**
 * Null when the app has no Supabase client to reach the proxy through. The key
 * itself is never here — it lives in a function secret, because an
 * `EXPO_PUBLIC_` value is compiled into the bundle for anyone to read.
 */
const USDA = usdaTransport();

/**
 * Food search.
 *
 * Local results appear as you type with no network round trip; the remote
 * lookup is debounced and merges in behind them. The zero-state is the user's
 * own frequent foods, which is where most logs come from in practice.
 */
export default function SearchScreen() {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { profile } = useSession();

  const [query, setQuery] = useState('');
  const [localResults, setLocalResults] = useState<ResolvedFood[]>([]);
  const [remoteResults, setRemoteResults] = useState<ResolvedFood[]>([]);
  const [searching, setSearching] = useState(false);
  /** True when every remote source failed to answer — offline, not empty. */
  const [unreachable, setUnreachable] = useState(false);
  const [selected, setSelected] = useState<ResolvedFood | null>(null);
  const [grams, setGrams] = useState(100);
  const [slot, setSlot] = useState<MealSlot>(suggestMealSlot());

  const frequent = useMemo(
    () => (profile ? getFrequentFoods(profile.id) : []),
    [profile],
  );

  // Ordered so meals usually eaten in the current slot come first.
  const savedMeals = useMemo(
    () => (profile ? listSavedMeals(profile.id, slot) : []),
    [profile, slot],
  );

  // Local search is synchronous and cheap, so it runs on every keystroke.
  useEffect(() => {
    if (query.trim().length < 2) {
      setLocalResults([]);
      return;
    }
    setLocalResults(searchCached(query.trim()));
  }, [query]);

  /**
   * Remote search, debounced and abortable so typing does not queue up requests
   * that are stale by the time they land.
   *
   * Open Food Facts needs no key and carries roughly four million products, so
   * it always runs — it is what makes search useful on a fresh install. USDA
   * runs alongside it only when a key is configured, and contributes
   * lab-verified entries that rank above crowdsourced ones.
   *
   * `allSettled` because these fail independently: Open Food Facts' search
   * endpoint is heavily loaded and 503s regularly, and losing it should not take
   * the USDA results down with it.
   */
  useEffect(() => {
    const term = query.trim();
    if (term.length < 3) {
      setRemoteResults([]);
      setUnreachable(false);
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => {
      setSearching(true);
      // Open Food Facts always runs — it needs no key. USDA joins it only when
      // one is configured, so it is a source that may not exist rather than a
      // source that returned nothing.
      const sources = [searchOpenFoodFacts(term, controller.signal)];
      if (USDA) sources.push(searchUsda(term, USDA, controller.signal));

      Promise.allSettled(sources)
        .then((settled) => {
          if (controller.signal.aborted) return;
          // Every source that ran failed, so this is "no network", not "no such
          // food". Saying the wrong one of those is a small lie the user acts on.
          setUnreachable(settled.every((r) => r.status === 'rejected'));
          const merged = settled.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
          // Lab-verified first, then by how much we trust the entry. USDA
          // entries therefore lead, which is why the array is no longer built
          // in a fixed source order.
          merged.sort(
            (a, b) => Number(b.verified) - Number(a.verified) || b.confidence - a.confidence,
          );
          setRemoteResults(merged);
        })
        .finally(() => {
          if (!controller.signal.aborted) setSearching(false);
        });
    }, 350);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  const results = useMemo(() => {
    // Local first: those are cached, instant, and often the user's own foods.
    const seen = new Set(localResults.map((r) => r.name.toLowerCase()));
    return [...localResults, ...remoteResults.filter((r) => !seen.has(r.name.toLowerCase()))];
  }, [localResults, remoteResults]);

  const handleLog = useCallback(() => {
    if (!profile || !selected) return;
    // A remote result is only persisted once the user actually logs it, so
    // browsing does not fill the cache with noise.
    if (!selected.fromCache) cacheFood(selected);

    logMeal({
      userId: profile.id,
      mealSlot: slot,
      logMethod: 'search',
      items: [
        {
          foodItemId: selected.id,
          displayName: selected.brand ? `${selected.name} (${selected.brand})` : selected.name,
          grams,
          per100g: selected.per100g,
          source: selected.source,
          confidence: selected.confidence,
        },
      ],
    });
    router.back();
  }, [profile, selected, slot, grams, router]);

  return (
    <View style={{ flex: 1, paddingTop: insets.top + theme.spacing.md }}>
      <View style={{ paddingHorizontal: theme.spacing.lg, gap: theme.spacing.md }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search foods"
            autoFocus
            accessibilityLabel="Search foods"
            placeholderTextColor={theme.palette.inkMuted}
            style={{
              flex: 1,
              minHeight: MIN_TAP_TARGET,
              paddingHorizontal: theme.spacing.lg,
              borderRadius: theme.radii.pill,
              backgroundColor: theme.palette.surfaceSunken,
              color: theme.palette.ink,
              fontSize: theme.typography.body.fontSize,
            }}
          />
          <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Close" hitSlop={12}>
            <Text tone="secondary">Cancel</Text>
          </Pressable>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{
          padding: theme.spacing.lg,
          paddingBottom: insets.bottom + 200,
          gap: theme.spacing.md,
        }}
        keyboardShouldPersistTaps="handled"
      >
        {query.trim().length < 2 ? (
          <View style={{ gap: theme.spacing.md }}>
            {/* Saved meals lead the zero-state. A whole meal in one tap beats a
                single food in one tap, and this is the screen people open when
                they already know what they ate. */}
            {savedMeals.length > 0 ? (
              <>
                <Text variant="heading">Your meals</Text>
                {savedMeals.map((meal) => (
                  <Pressable
                    key={meal.id}
                    onPress={() => {
                      if (!profile) return;
                      logSavedMeal(profile.id, meal.id, { mealSlot: slot });
                      router.back();
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={`Log ${meal.name}, ${Math.round(meal.energyKcal)} calories`}
                  >
                    <Ticket rule={theme.palette.sun} label={meal.name}>
                      <View
                        style={{
                          flexDirection: 'row',
                          alignItems: 'baseline',
                          gap: theme.spacing.sm,
                        }}
                      >
                        <Text variant="numericSmall">{Math.round(meal.energyKcal)}</Text>
                        <Text variant="eyebrow" tone="muted">
                          kcal
                        </Text>
                        <View style={{ flex: 1 }} />
                        <Text variant="caption" tone="muted" tabular>
                          {meal.itemCount} food{meal.itemCount === 1 ? '' : 's'} ·{' '}
                          {Math.round(meal.proteinG)} g protein
                        </Text>
                      </View>
                      <Text variant="captionStrong" tone="sun">
                        Log it
                      </Text>
                    </Ticket>
                  </Pressable>
                ))}
              </>
            ) : null}

            <Text variant="heading">Your frequent foods</Text>
            {frequent.length === 0 ? (
              <Text tone="secondary">
                Foods you log often will show up here so you can add them in one tap.
              </Text>
            ) : (
              frequent.map((food) => (
                <Ticket key={`${food.display_name}-${food.food_item_id ?? 'none'}`}>
                  <Text>{food.display_name}</Text>
                  <Text variant="caption" tone="muted" tabular>
                    Logged {food.uses} time{food.uses === 1 ? '' : 's'} · {Math.round(food.grams)} g
                  </Text>
                </Ticket>
              ))
            )}
          </View>
        ) : (
          <>
            {searching ? <ActivityIndicator color={theme.palette.celesteInk} /> : null}
            {results.length === 0 && !searching ? (
              <Text tone="secondary">
                {unreachable
                  ? 'Can\'t reach the food database. Your saved foods are still searchable, and anything you log now will sync later.'
                  : 'Nothing found. Try a simpler term, or scan the barcode.'}
              </Text>
            ) : null}
            {results.map((food) => (
              <Pressable
                key={food.id}
                onPress={() => {
                  setSelected(food);
                  setGrams(food.portions.find((p) => p.isDefault)?.grams ?? 100);
                }}
                accessibilityRole="button"
                accessibilityState={{ selected: selected?.id === food.id }}
              >
                <Ticket
                  style={{
                    borderColor:
                      selected?.id === food.id ? theme.palette.celesteInk : theme.palette.hairline,
                  }}
                >
                  <View style={{ gap: theme.spacing.xs }}>
                    <Text>{food.name}</Text>
                    {food.brand ? (
                      <Text variant="caption" tone="secondary">
                        {food.brand}
                      </Text>
                    ) : null}
                    {/* Spacer, not `space-between` — a verified food shows no
                        badge, and the calories must stay on the right. */}
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <ConfidenceBadge source={food.source} confidence={food.confidence} />
                      <View style={{ flex: 1 }} />
                      <Text variant="caption" tone="muted" tabular>
                        {Math.round(food.per100g.energyKcal ?? 0)} kcal / 100 g
                      </Text>
                    </View>
                  </View>
                </Ticket>
              </Pressable>
            ))}
          </>
        )}
      </ScrollView>

      {selected ? (
        <View
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            padding: theme.spacing.lg,
            paddingBottom: insets.bottom + theme.spacing.lg,
            gap: theme.spacing.md,
            backgroundColor: theme.palette.surface,
            borderTopWidth: 1,
            borderTopColor: theme.palette.hairline,
          }}
        >
          <Text variant="bodyStrong">{selected.name}</Text>
          <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
            {[50, 100, 150, 200].map((preset) => (
              <Pressable
                key={preset}
                onPress={() => setGrams(preset)}
                accessibilityRole="button"
                accessibilityLabel={`${preset} grams`}
                style={{
                  flex: 1,
                  minHeight: MIN_TAP_TARGET,
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: theme.radii.md,
                  backgroundColor:
                    grams === preset ? theme.palette.celesteSoft : theme.palette.surfaceSunken,
                }}
              >
                <Text variant="caption">{preset} g</Text>
              </Pressable>
            ))}
          </View>
          <Text variant="caption" tone="secondary" tabular>
            {Math.round(nutrientsForGrams(selected.per100g, grams).energyKcal ?? 0)} kcal ·{' '}
            {Math.round(nutrientsForGrams(selected.per100g, grams).proteinG ?? 0)} g protein
          </Text>
          <MealSlotPicker value={slot} onChange={setSlot} />
          <Button label="Log it" onPress={handleLog} block />
        </View>
      ) : null}
    </View>
  );
}
