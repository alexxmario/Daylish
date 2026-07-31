import { Tabs } from 'expo-router';

import { TabIcon, type TabName } from '@/components/TabIcon.tsx';
import { useTheme } from '@/theme/index.tsx';

/**
 * The five destinations.
 *
 * Today  — the journal. The screen opened five times a day, so it is first.
 * Meals  — the recipe library: what you will cook.
 * Ideas  — suggestions ranked against what is left of your targets.
 * Progress — trends, insights, streaks.
 * You    — profile, targets, preferences, data.
 *
 * Logging is deliberately *not* a tab. It is a persistent action on Today,
 * because burying the app's most frequent action one navigation level down is
 * the mistake that makes competitors slow.
 *
 * Meals was hidden while the recipe library was empty. It now ships with the
 * library bundled and seeded at boot, so it is a real destination again.
 */
export default function TabsLayout() {
  const theme = useTheme();

  const screens: { name: string; title: string; icon: TabName }[] = [
    { name: 'index', title: 'Today', icon: 'today' },
    { name: 'meals', title: 'Meals', icon: 'meals' },
    { name: 'ideas', title: 'Ideas', icon: 'ideas' },
    { name: 'progress', title: 'Progress', icon: 'progress' },
    { name: 'you', title: 'You', icon: 'you' },
  ];

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.palette.celesteInk,
        tabBarInactiveTintColor: theme.palette.inkMuted,
        sceneStyle: { backgroundColor: theme.palette.background },
        tabBarStyle: {
          backgroundColor: theme.palette.surface,
          borderTopWidth: 1,
          borderTopColor: theme.palette.hairline,
          height: 88,
          paddingTop: 8,
        },
        tabBarLabelStyle: {
          fontFamily: theme.fonts.bodySemi,
          fontSize: 10,
          letterSpacing: 0.6,
          textTransform: 'uppercase',
          marginTop: 2,
        },
      }}
    >
      {screens.map((screen) => (
        <Tabs.Screen
          key={screen.name}
          name={screen.name}
          options={{
            title: screen.title,
            tabBarIcon: ({ color, focused }) => (
              <TabIcon name={screen.icon} color={color} focused={focused} />
            ),
          }}
        />
      ))}
    </Tabs>
  );
}
