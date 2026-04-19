import { Tabs } from 'expo-router'
import { StyleSheet, Text, View } from 'react-native'

const C = {
  bg: '#F7F4EE',
  card: '#FFFFFF',
  border: '#E7DED2',
  shadow: '#201710',
  activeBg: '#EAF6EF',
  activeBorder: '#CAE4D3',
  activeText: '#2E8B57',
  inactiveBg: '#F4EFE7',
  inactiveText: '#8F877C',
}

function TabIcon({
  icon,
  label,
  focused,
}: {
  icon: string
  label: string
  focused: boolean
}) {
  return (
    <View style={sTab.item}>
      <View style={[sTab.iconWrap, focused ? sTab.iconWrapActive : sTab.iconWrapInactive]}>
        <Text style={[sTab.icon, focused ? sTab.iconActive : sTab.iconInactive]}>{icon}</Text>
      </View>
      <Text style={[sTab.label, focused ? sTab.labelActive : sTab.labelInactive]}>{label}</Text>
    </View>
  )
}

const sTab = StyleSheet.create({
  item: {
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 88,
    paddingTop: 6,
  },
  iconWrap: {
    width: 42,
    height: 42,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 5,
    borderWidth: 1,
  },
  iconWrapActive: {
    backgroundColor: C.activeBg,
    borderColor: C.activeBorder,
  },
  iconWrapInactive: {
    backgroundColor: C.inactiveBg,
    borderColor: '#ECE3D7',
  },
  icon: {
    fontSize: 18,
  },
  iconActive: {
    color: C.activeText,
  },
  iconInactive: {
    color: C.inactiveText,
  },
  label: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: -0.1,
  },
  labelActive: {
    color: C.activeText,
  },
  labelInactive: {
    color: C.inactiveText,
  },
})

export default function ServerTabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarShowLabel: false,
        tabBarStyle: {
          position: 'absolute',
          left: 14,
          right: 14,
          bottom: 14,
          height: 82,
          paddingTop: 10,
          paddingBottom: 12,
          backgroundColor: C.card,
          borderTopWidth: 0,
          borderWidth: 1,
          borderColor: C.border,
          borderRadius: 26,
          shadowColor: C.shadow,
          shadowOpacity: 0.09,
          shadowOffset: { width: 0, height: 12 },
          shadowRadius: 24,
          elevation: 10,
        },
        sceneStyle: {
          backgroundColor: C.bg,
        },
      }}
    >
      <Tabs.Screen
        name="missions"
        options={{
          tabBarIcon: ({ focused }) => <TabIcon icon="💼" label="Missions" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="disponibilites"
        options={{
          tabBarIcon: ({ focused }) => (
            <TabIcon icon="🗓️" label="Disponibilites" focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="profil"
        options={{
          tabBarIcon: ({ focused }) => <TabIcon icon="👤" label="Profil" focused={focused} />,
        }}
      />
    </Tabs>
  )
}
