import { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, Share, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { formatShoppingQuantity } from '@daylish/core';

import { Button } from '@/components/Button.tsx';
import { Illustration } from '@/components/Illustration.tsx';
import { Text } from '@/components/Text.tsx';
import { Divider, Eyebrow, Ticket } from '@/components/Ticket.tsx';
import {
  clearShoppingList,
  getShoppingList,
  removeFromShoppingList,
  toggleShoppingItem,
  type ShoppingList,
} from '@/data/shopping-list.ts';
import { useSession } from '@/state/session.tsx';
import { MIN_TAP_TARGET, useTheme } from '@/theme/index.tsx';

const EMPTY: ShoppingList = { recipes: [], lines: [], remaining: 0 };

/**
 * The shopping list.
 *
 * One list for everything you plan to cook, with ingredients shared between
 * recipes added together — four dinners that each want garlic produce one line
 * for garlic, not four. That combining is the entire reason the screen exists;
 * a per-recipe ingredient list is already on the recipe.
 *
 * Two things it deliberately shows that a plain list would not. Every line says
 * which recipes wanted it and in their own words ("2 cloves for Shakshuka"), so
 * a total in grams never has to be trusted blindly at the shelf. And optional
 * ingredients stay on the list, marked — dropping them silently would make a
 * list you cannot rely on to be complete, which is worse than one with a line
 * you choose to skip.
 */
export default function ShoppingListScreen() {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { profile } = useSession();

  const [list, setList] = useState<ShoppingList>(EMPTY);

  const reload = useCallback(() => {
    if (!profile) return;
    setList(getShoppingList(profile.id));
  }, [profile]);

  useFocusEffect(reload);

  const handleToggle = useCallback(
    (key: string) => {
      if (!profile) return;
      toggleShoppingItem(profile.id, key);
      reload();
    },
    [profile, reload],
  );

  const handleRemove = useCallback(
    (recipeId: string, title: string) => {
      if (!profile) return;
      Alert.alert(`Take ${title} off the list?`, 'Anything you have already ticked off stays ticked.', [
        { text: 'Keep it', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            removeFromShoppingList(profile.id, recipeId);
            reload();
          },
        },
      ]);
    },
    [profile, reload],
  );

  const handleClear = useCallback(() => {
    if (!profile) return;
    Alert.alert('Clear the whole list?', 'The recipes and everything you have ticked off.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clear it',
        style: 'destructive',
        onPress: () => {
          clearShoppingList(profile.id);
          reload();
        },
      },
    ]);
  }, [profile, reload]);

  /**
   * Shared as plain text rather than a file.
   *
   * A shopping list gets sent to whoever is passing the shop, and it has to
   * arrive as something they can read in the message — a `.json` attachment is
   * useless to a person standing in an aisle.
   */
  const handleShare = useCallback(() => {
    if (list.lines.length === 0) return;

    const body = list.lines
      .filter((line) => !line.checked)
      .map((line) => `• ${line.name} — ${formatShoppingQuantity(line.grams)}${line.optional ? ' (optional)' : ''}`)
      .join('\n');

    void Share.share({
      title: 'Shopping list',
      message: `Shopping list\n\n${body}\n\nFor: ${list.recipes.map((r) => r.title).join(', ')}`,
    });
  }, [list]);

  if (!profile) return null;

  const bought = list.lines.length - list.remaining;

  return (
    <View style={{ flex: 1, paddingTop: insets.top + theme.spacing.md }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.spacing.md,
          paddingHorizontal: theme.spacing.lg,
          paddingBottom: theme.spacing.md,
        }}
      >
        <Text variant="title" style={{ flex: 1 }}>
          Shopping
        </Text>
        {list.lines.length > 0 ? (
          <Pressable onPress={handleShare} accessibilityRole="button" hitSlop={12}>
            <Text variant="captionStrong" tone="celeste">
              Share
            </Text>
          </Pressable>
        ) : null}
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Close"
          hitSlop={12}
        >
          <Text tone="secondary">Close</Text>
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: theme.spacing.lg,
          paddingBottom: insets.bottom + theme.spacing.xxl,
          gap: theme.spacing.lg,
        }}
        showsVerticalScrollIndicator={false}
      >
        {list.recipes.length === 0 ? (
          <Ticket rule={theme.palette.hairline}>
            <Illustration name="emptyPantry" height={112} />
            <Text variant="heading">Nothing to buy yet</Text>
            <Text variant="caption" tone="secondary">
              Open a recipe you want to cook and add it here. Everything you add is combined into
              one list, so four dinners that all want onions come out as one line.
            </Text>
            <Button label="Browse meals" variant="secondary" onPress={() => router.back()} />
          </Ticket>
        ) : (
          <>
            {/* What the list is for. Tapping a recipe takes it off — the only
                edit that changes every line at once, so it belongs at the top
                rather than buried under the ingredients it produced. */}
            <Eyebrow>Cooking</Eyebrow>
            <Ticket rule={theme.palette.celesteInk}>
              {list.recipes.map((recipe, index) => (
                <View key={recipe.id} style={{ gap: theme.spacing.md }}>
                  {index > 0 ? <Divider /> : null}
                  <Pressable
                    onPress={() => handleRemove(recipe.recipeId, recipe.title)}
                    accessibilityRole="button"
                    accessibilityLabel={`${recipe.title}, ${recipe.servings} portions. Tap to remove from the list`}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: theme.spacing.md,
                      minHeight: MIN_TAP_TARGET,
                    }}
                  >
                    <Text variant="bodyStrong" style={{ flex: 1 }} numberOfLines={2}>
                      {recipe.title}
                    </Text>
                    <Text variant="caption" tone="muted" tabular>
                      {recipe.servings} {recipe.servings === 1 ? 'portion' : 'portions'}
                    </Text>
                  </Pressable>
                </View>
              ))}
            </Ticket>

            <Eyebrow>
              {list.remaining === 0
                ? 'All bought'
                : `${list.remaining} to buy${bought > 0 ? ` · ${bought} in the basket` : ''}`}
            </Eyebrow>

            <Ticket rule={list.remaining === 0 ? theme.palette.sun : theme.palette.ink}>
              {list.lines.map((line, index) => (
                <View key={line.key} style={{ gap: theme.spacing.md }}>
                  {index > 0 ? <Divider /> : null}
                  <ShoppingRow
                    name={line.name}
                    quantity={formatShoppingQuantity(line.grams)}
                    optional={line.optional}
                    checked={line.checked}
                    sources={line.sources.map((s) => `${s.displayQuantity} for ${s.title}`)}
                    onPress={() => handleToggle(line.key)}
                  />
                </View>
              ))}
            </Ticket>

            <Button label="Clear the list" variant="quiet" onPress={handleClear} block />
          </>
        )}
      </ScrollView>
    </View>
  );
}

/**
 * One thing to buy.
 *
 * The whole row is the target, because a checkbox is not a tap target on a
 * phone held in one hand in a shop. A ticked line stays visible and in place
 * rather than moving to the bottom — a list that reorders itself under your
 * thumb is one you lose your place in.
 */
function ShoppingRow({
  name,
  quantity,
  optional,
  checked,
  sources,
  onPress,
}: {
  name: string;
  quantity: string;
  optional: boolean;
  checked: boolean;
  /** "2 cloves for Shakshuka" — where the quantity came from. */
  sources: readonly string[];
  onPress: () => void;
}) {
  const theme = useTheme();

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={`${name}, ${quantity}${optional ? ', optional' : ''}`}
      style={{
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: theme.spacing.md,
        minHeight: MIN_TAP_TARGET,
        opacity: checked ? 0.45 : 1,
      }}
    >
      <View
        style={{
          width: 22,
          height: 22,
          marginTop: 2,
          borderRadius: theme.radii.sm,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: checked ? theme.palette.celesteInk : 'transparent',
          borderWidth: 1.5,
          borderColor: checked ? theme.palette.celesteInk : theme.palette.hairline,
        }}
      >
        {checked ? (
          <Text variant="captionStrong" tone="onDark">
            ✓
          </Text>
        ) : null}
      </View>

      <View style={{ flex: 1, gap: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: theme.spacing.sm }}>
          <Text
            variant="bodyStrong"
            style={{ flex: 1, textDecorationLine: checked ? 'line-through' : 'none' }}
          >
            {name}
          </Text>
          <Text variant="numericSmall">{quantity}</Text>
        </View>

        {/* Where the number came from. A total in grams is not something you can
            check against a shelf; "2 cloves for Shakshuka" is. */}
        <Text variant="caption" tone="muted" numberOfLines={2}>
          {optional ? 'Optional · ' : ''}
          {sources.join(' · ')}
        </Text>
      </View>
    </Pressable>
  );
}
