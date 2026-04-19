import { usePathname, useRouter } from 'expo-router'
import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'

type TabItem = {
  key: string
  label: string
  icon: string
  route: '/dashboard_patron' | '/missions-patron' | '/profil-patron'
}

const tabs: TabItem[] = [
  { key: 'dashboard', label: 'Tableau de bord', icon: 'D', route: '/dashboard_patron' },
  { key: 'missions', label: 'Missions', icon: 'M', route: '/missions-patron' },
  { key: 'profil', label: 'Profil', icon: 'P', route: '/profil-patron' },
]

export default function PatronBottomNav() {
  const router = useRouter()
  const pathname = usePathname()

  return (
    <View style={s.wrap}>
      <View style={s.bar}>
        {tabs.map((tab) => {
          const active = pathname === tab.route

          return (
            <TouchableOpacity
              key={tab.key}
              style={[s.tab, active && s.tabActive]}
              onPress={() => router.replace(tab.route)}
              activeOpacity={0.86}
            >
              <View style={[s.iconWrap, active && s.iconWrapActive]}>
                <Text style={[s.iconTxt, active && s.iconTxtActive]}>{tab.icon}</Text>
              </View>
              <Text style={[s.label, active && s.labelActive]}>{tab.label}</Text>
            </TouchableOpacity>
          )
        })}
      </View>
    </View>
  )
}

const s = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 16,
    paddingBottom: 18,
    paddingTop: 8,
  },
  bar: {
    flexDirection: 'row',
    backgroundColor: '#FFF9F4',
    borderWidth: 1,
    borderColor: '#EAD8C9',
    borderRadius: 22,
    padding: 8,
    shadowColor: '#2B2118',
    shadowOpacity: 0.08,
    shadowOffset: { width: 0, height: 10 },
    shadowRadius: 18,
    elevation: 6,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    borderRadius: 16,
  },
  tabActive: {
    backgroundColor: '#FEF0E5',
  },
  iconWrap: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#F2E8DE',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  iconWrapActive: {
    backgroundColor: '#C56B3D',
  },
  iconTxt: {
    fontSize: 12,
    fontWeight: '800',
    color: '#7A6E63',
  },
  iconTxtActive: {
    color: '#FFFFFF',
  },
  label: {
    fontSize: 11,
    fontWeight: '700',
    color: '#7A6E63',
    textAlign: 'center',
  },
  labelActive: {
    color: '#1A1715',
  },
})
