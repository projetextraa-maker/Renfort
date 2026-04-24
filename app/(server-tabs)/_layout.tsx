import { Tabs } from 'expo-router'
import { StyleSheet, Text, View } from 'react-native'

const C = {
  bg: '#F7F4EE',
  card: '#FCFAF7',
  border: '#E7DED2',
  shadow: '#201710',
  activeBg: '#EAF6EF',
  activeBorder: '#CAE4D3',
  activeText: '#2E8B57',
  inactiveBg: '#F4EFE7',
  inactiveText: '#8F877C',
}

function TabGlyph({ icon, focused }: { icon: string; focused: boolean }) {
  return (
    <View style={[s.iconWrap, focused ? s.iconWrapActive : s.iconWrapInactive]}>
      <Text style={s.icon}>{icon}</Text>
    </View>
  )
}

function TabLabel({
  label,
  focused,
}: {
  label: string
  focused: boolean
}) {
  return (
    <Text
      numberOfLines={1}
      ellipsizeMode="clip"
      style={[s.label, focused ? s.labelActive : s.labelInactive]}
    >
      {label}
    </Text>
  )
}

const s = StyleSheet.create({
  iconWrap: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconWrapActive: {
    backgroundColor: C.activeBg,
    borderWidth: 1,
    borderColor: C.activeBorder,
  },
  iconWrapInactive: {
    backgroundColor: C.inactiveBg,
  },
  icon: {
    fontSize: 16,
  },
  label: {
    width: '100%',
    fontSize: 14,
    lineHeight: 18,
    textAlign: 'center',
    marginTop: 8,
    includeFontPadding: false,
  },
  labelActive: {
    color: C.activeText,
    fontWeight: '600',
  },
  labelInactive: {
    color: C.inactiveText,
    fontWeight: '500',
  },
})

export default function ServerTabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarShowLabel: true,
        tabBarLabelPosition: 'below-icon',
        tabBarStyle: {
          position: 'absolute',
          left: 14,
          right: 14,
          bottom: 14,
          height: 112,
          paddingTop: 10,
          paddingBottom: 14,
          backgroundColor: C.card,
          borderTopWidth: 0,
          borderWidth: 1,
          borderColor: C.border,
          borderRadius: 28,
          shadowColor: C.shadow,
          shadowOpacity: 0.08,
          shadowOffset: { width: 0, height: 10 },
          shadowRadius: 20,
          elevation: 8,
        },
        tabBarItemStyle: {
          flex: 1,
          width: '33.3333%',
          minWidth: 0,
          maxWidth: '33.3333%',
          alignItems: 'center',
          justifyContent: 'center',
          paddingHorizontal: 0,
          paddingVertical: 0,
        },
        tabBarIconStyle: {
          marginTop: 4,
          marginBottom: 0,
        },
        sceneStyle: {
          backgroundColor: C.bg,
        },
      }}
    >
      <Tabs.Screen
        name="missions"
        options={{
          tabBarIcon: ({ focused }) => <TabGlyph icon="💼" focused={focused} />,
          tabBarLabel: ({ focused }) => <TabLabel label="Missions" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="disponibilites"
        options={{
          tabBarIcon: ({ focused }) => <TabGlyph icon="🗓️" focused={focused} />,
          tabBarLabel: ({ focused }) => <TabLabel label="Disponibilités" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="profil"
        options={{
          tabBarIcon: ({ focused }) => <TabGlyph icon="👤" focused={focused} />,
          tabBarLabel: ({ focused }) => <TabLabel label="Profil" focused={focused} />,
        }}
      />
    </Tabs>
  )
}
