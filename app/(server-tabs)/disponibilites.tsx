import { useFocusEffect } from 'expo-router'
import { useCallback, useState } from 'react'
import { Alert, ScrollView, StatusBar, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native'
import {
  CANONICAL_WEEKLY_AVAILABILITY_SLOTS,
  getAvailabilityKey,
  WEEKLY_AVAILABILITY_DAYS,
  type AvailabilityDayKey,
  type CanonicalAvailabilitySlotKey,
  type ServeurDisponibiliteHebdo,
} from '../../lib/serveur-disponibilites'
import {
  fetchServeurDisponibilitesHebdo,
  replaceServeurDisponibilitesHebdo,
} from '../../lib/serveur-disponibilites-api'
import { getFriendlyWriteError } from '../../lib/supabase-errors'
import { supabase } from '../../lib/supabase'

const SLOTS_VISIBLES = CANONICAL_WEEKLY_AVAILABILITY_SLOTS

const DAY_SHORT: Record<string, string> = {
  monday: 'Lun',
  tuesday: 'Mar',
  wednesday: 'Mer',
  thursday: 'Jeu',
  friday: 'Ven',
  saturday: 'Sam',
  sunday: 'Dim',
}

const C = {
  bg: '#F7F4EE',
  card: '#FFFFFF',
  cardSoft: '#F4EFE7',
  border: '#E6DED2',
  title: '#171614',
  textSoft: '#6D675E',
  textMuted: '#9A9388',
  accent: '#2E8B57',
  accentSoft: '#E8F5ED',
  accentBd: '#CFE7D8',
  accentBg: '#F0F8F3',
  terra: '#C46A3C',
  terraBg: '#FEF3EB',
  terraBd: '#F5C9A9',
  amber: '#B8893C',
  amberBg: '#FBF5E8',
  amberBd: '#E8D4A0',
  red: '#C84B4B',
  redBg: '#FEF2F2',
  redBd: '#F2CACA',
}

export default function DisponibilitesServeurScreen() {
  const [serveurId, setServeurId] = useState<string | null>(null)
  const [disponible, setDisponible] = useState(false)
  const [availabilities, setAvailabilities] = useState<ServeurDisponibiliteHebdo[]>([])
  const [saving, setSaving] = useState(false)
  const [toggling, setToggling] = useState(false)

  const charger = async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return

    setServeurId(user.id)

    const { data } = await supabase
      .from('serveurs')
      .select('disponible')
      .eq('id', user.id)
      .single()

    if (data) setDisponible(data.disponible ?? false)

    const slots = await fetchServeurDisponibilitesHebdo(user.id)
    setAvailabilities(slots)
  }

  useFocusEffect(
    useCallback(() => {
      charger()
    }, [])
  )

  const hasSlots = availabilities.length > 0
  const isVisible = disponible && hasSlots

  const handleToggle = async (val: boolean) => {
    if (!serveurId || toggling) return

    setToggling(true)
    setDisponible(val)

    try {
      await supabase.from('serveurs').update({ disponible: val }).eq('id', serveurId)
    } catch {
      setDisponible(!val)
    } finally {
      setToggling(false)
    }
  }

  const isSelected = (jour: AvailabilityDayKey, creneau: CanonicalAvailabilitySlotKey) =>
    availabilities.some(
      (item) => getAvailabilityKey(item.jour, item.creneau) === getAvailabilityKey(jour, creneau)
    )

  const isFullDaySelected = (jour: AvailabilityDayKey) =>
    isSelected(jour, 'midday') && isSelected(jour, 'evening')

  const toggle = (jour: AvailabilityDayKey, creneau: CanonicalAvailabilitySlotKey) => {
    const key = getAvailabilityKey(jour, creneau)
    setAvailabilities((prev) => {
      const exists = prev.some(
        (item) => getAvailabilityKey(item.jour, item.creneau) === key
      )
      if (exists) {
        return prev.filter(
          (item) => getAvailabilityKey(item.jour, item.creneau) !== key
        )
      }
      return [...prev, { jour, creneau }]
    })
  }

  const toggleJour = (jour: AvailabilityDayKey) => {
    if (isFullDaySelected(jour)) {
      setAvailabilities((prev) => prev.filter((item) => item.jour !== jour))
      return
    }

    const nouveaux = SLOTS_VISIBLES.filter((slot) => !isSelected(jour, slot.key)).map((slot) => ({
      jour,
      creneau: slot.key,
    }))
    setAvailabilities((prev) => [...prev, ...nouveaux])
  }

  const toggleJournée = (jour: AvailabilityDayKey) => {
    if (isFullDaySelected(jour)) {
      setAvailabilities((prev) => prev.filter((item) => item.jour !== jour))
      return
    }

    setAvailabilities((prev) => {
      const next = [...prev]
      if (!isSelected(jour, 'midday')) next.push({ jour, creneau: 'midday' })
      if (!isSelected(jour, 'evening')) next.push({ jour, creneau: 'evening' })
      return next
    })
  }

  const toutCocher = () => {
    const toutes: ServeurDisponibiliteHebdo[] = []
    WEEKLY_AVAILABILITY_DAYS.forEach((day) => {
      SLOTS_VISIBLES.forEach((slot) => {
        toutes.push({ jour: day.key, creneau: slot.key })
      })
    })
    setAvailabilities(toutes)
  }

  const toutEffacer = () => setAvailabilities([])

  const toutCoche = WEEKLY_AVAILABILITY_DAYS.every((day) =>
    SLOTS_VISIBLES.every((slot) => isSelected(day.key, slot.key))
  )

  const sauvegarder = async () => {
    if (!serveurId) return

    setSaving(true)
    try {
      const result = await replaceServeurDisponibilitesHebdo(serveurId, availabilities)
      if (!result.ok) {
        console.error('disponibilites save error', result.error)
        Alert.alert('Erreur', getFriendlyWriteError(result.error, 'Impossible de sauvegarder les disponibilités pour le moment.'))
        return
      }
      Alert.alert('Succès', 'Disponibilités mises à jour !')
    } catch {
      Alert.alert('Erreur', 'Impossible de sauvegarder.')
    } finally {
      setSaving(false)
    }
  }

  const statusMsg = () => {
    if (isVisible) {
      return {
        text: 'Visible dans les recherches',
        color: C.accent,
        bg: C.accentSoft,
        bd: C.accentBd,
      }
    }
    if (disponible && !hasSlots) {
      return {
        text: 'Ajoutez des créneaux pour être visible',
        color: C.amber,
        bg: C.amberBg,
        bd: C.amberBd,
      }
    }
    return {
      text: 'Profil masqué aux patrons',
      color: C.textMuted,
      bg: C.cardSoft,
      bd: C.border,
    }
  }

  const msg = statusMsg()

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.content}>
      <StatusBar barStyle="dark-content" backgroundColor={C.bg} />

      <Text style={s.overline}>DISPONIBILITÉS</Text>
      <Text style={s.pageTitle}>Votre calendrier</Text>
      <Text style={s.pageSub}>Gérez ici votre visibilité et les créneaux où vous souhaitez apparaître.</Text>

      <View style={s.card}>
        <View style={s.toggleRow}>
          <View style={{ flex: 1 }}>
            <Text style={s.cardTitle}>Visible aux patrons</Text>
            <Text style={s.cardSub}>Interrupteur de visibilité global</Text>
          </View>
          <Switch
            value={disponible}
            onValueChange={handleToggle}
            disabled={toggling}
            trackColor={{ false: '#ddd', true: C.accent }}
            thumbColor="#fff"
          />
        </View>

        <View style={[s.statusBadge, { backgroundColor: msg.bg, borderColor: msg.bd }]}>
          <View style={[s.statusDot, { backgroundColor: msg.color }]} />
          <Text style={[s.statusTxt, { color: msg.color }]}>{msg.text}</Text>
        </View>
      </View>

      <View style={s.calendarSection}>
        <View style={s.calendarHeader}>
          <View style={{ flex: 1 }}>
            <Text style={s.cardTitle}>Mon calendrier</Text>
            <Text style={s.cardSub}>Créneaux où vous êtes habituellement disponible</Text>
          </View>

          <View style={s.countBadge}>
            <Text style={s.countNum}>{availabilities.length}</Text>
            <Text style={s.countLbl}>actifs</Text>
          </View>
        </View>

        <TouchableOpacity
          style={[s.globalBtn, toutCoche && s.globalBtnRed]}
          onPress={toutCoche ? toutEffacer : toutCocher}
          activeOpacity={0.8}
        >
          <Text style={[s.globalBtnTxt, toutCoche && s.globalBtnTxtRed]}>
            {toutCoche ? 'Tout effacer' : 'Dispo tous les jours'}
          </Text>
        </TouchableOpacity>

        {WEEKLY_AVAILABILITY_DAYS.map((day) => {
          const hasMidday = isSelected(day.key, 'midday')
          const hasEvening = isSelected(day.key, 'evening')
          const tousJourCoches = hasMidday && hasEvening
          const auMoinsUnCoche = hasMidday || hasEvening

          return (
            <View key={day.key} style={[s.dayRow, auMoinsUnCoche && s.dayRowActive]}>
              <TouchableOpacity
                style={[s.dayBtn, tousJourCoches && s.dayBtnActive]}
                onPress={() => toggleJour(day.key)}
                activeOpacity={0.7}
              >
                <Text style={[s.dayTxt, tousJourCoches && s.dayTxtActive]}>
                  {DAY_SHORT[day.key]}
                </Text>
              </TouchableOpacity>

              <View style={s.slotsRow}>
                <TouchableOpacity
                  key={`${day.key}-midday`}
                  style={[s.slotBtn, hasMidday && s.slotBtnActive, tousJourCoches && s.slotBtnLinkedActive]}
                  onPress={() => toggle(day.key, 'midday')}
                  activeOpacity={0.75}
                >
                  <Text style={[s.slotTxt, hasMidday && s.slotTxtActive, tousJourCoches && s.slotTxtLinkedActive]}>
                    Midi
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[s.slotBtn, s.slotBtnJournée, tousJourCoches && s.slotBtnActive]}
                  onPress={() => toggleJournée(day.key)}
                  activeOpacity={0.75}
                >
                  <Text style={[s.slotTxt, s.slotTxtJournée, tousJourCoches && s.slotTxtActive]}>
                    Journée
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  key={`${day.key}-evening`}
                  style={[s.slotBtn, hasEvening && s.slotBtnActive, tousJourCoches && s.slotBtnLinkedActive]}
                  onPress={() => toggle(day.key, 'evening')}
                  activeOpacity={0.75}
                >
                  <Text style={[s.slotTxt, hasEvening && s.slotTxtActive, tousJourCoches && s.slotTxtLinkedActive]}>
                    Soir
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          )
        })}

        <TouchableOpacity
          style={[s.saveBtn, saving && s.saveBtnDisabled]}
          onPress={sauvegarder}
          disabled={saving}
          activeOpacity={0.88}
        >
          <Text style={s.saveBtnTxt}>
            {saving ? 'Sauvegarde...' : 'Sauvegarder mes disponibilités'}
          </Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  )
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  content: { padding: 20, paddingTop: 56, paddingBottom: 120 },
  overline: {
    fontSize: 11,
    color: C.textMuted,
    marginBottom: 8,
    fontWeight: '800',
    letterSpacing: 1.1,
  },
  pageTitle: {
    fontSize: 30,
    fontWeight: '800',
    color: C.title,
    letterSpacing: -0.7,
    marginBottom: 8,
  },
  pageSub: {
    fontSize: 13,
    lineHeight: 19,
    color: C.textSoft,
    marginBottom: 18,
    maxWidth: 320,
  },
  card: {
    backgroundColor: C.card,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: C.border,
    padding: 16,
    marginBottom: 20,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowOffset: { width: 0, height: 3 },
    shadowRadius: 8,
    elevation: 1,
  },
  cardTitle: { fontSize: 16, fontWeight: '700', color: C.title, marginBottom: 3 },
  cardSub: { fontSize: 12, color: C.textMuted },
  toggleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 6,
  },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusTxt: { fontSize: 12, fontWeight: '700', flex: 1 },
  calendarSection: {
    backgroundColor: C.card,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: C.border,
    padding: 16,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowOffset: { width: 0, height: 3 },
    shadowRadius: 8,
    elevation: 1,
  },
  calendarHeader: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 14 },
  countBadge: {
    backgroundColor: C.terraBg,
    borderWidth: 1,
    borderColor: C.terraBd,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    alignItems: 'center',
    minWidth: 56,
  },
  countNum: { fontSize: 20, fontWeight: '800', color: C.terra, letterSpacing: -0.5 },
  countLbl: { fontSize: 9, color: C.terra, marginTop: 1 },
  globalBtn: {
    backgroundColor: C.terraBg,
    borderWidth: 1.5,
    borderColor: C.terra,
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
    marginBottom: 14,
  },
  globalBtnRed: { backgroundColor: C.redBg, borderColor: C.redBd },
  globalBtnTxt: { fontSize: 14, fontWeight: '700', color: C.terra },
  globalBtnTxtRed: { color: C.red },
  dayRow: {
    backgroundColor: C.bg,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
    padding: 10,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  dayRowActive: { borderColor: C.terraBd, backgroundColor: '#FFFDF9' },
  dayBtn: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: C.cardSoft,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayBtnActive: { backgroundColor: C.terra, borderColor: C.terra },
  dayTxt: { fontSize: 12, fontWeight: '800', color: C.textSoft },
  dayTxtActive: { color: '#FFFFFF' },
  slotsRow: { flex: 1, flexDirection: 'row', gap: 7 },
  slotBtn: {
    flex: 1,
    backgroundColor: '#F1EBE3',
    borderWidth: 1,
    borderColor: '#DDD2C4',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  slotBtnActive: {
    backgroundColor: C.terra,
    borderColor: C.terra,
    borderWidth: 1,
  },
  slotBtnLinkedActive: {
    backgroundColor: C.terra,
    borderColor: C.terra,
    borderWidth: 1,
  },
  slotBtnJournée: {
    flex: 1.2,
    backgroundColor: '#F1EBE3',
    borderColor: '#DDD2C4',
  },
  slotTxt: { fontSize: 10, fontWeight: '700', color: '#4F453D' },
  slotTxtActive: { color: '#FFFFFF' },
  slotTxtLinkedActive: { color: '#FFFFFF' },
  slotTxtJournée: { color: '#4F453D', fontWeight: '800' },
  saveBtn: {
    backgroundColor: C.accent,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 16,
  },
  saveBtnDisabled: { opacity: 0.6 },
  saveBtnTxt: { fontSize: 15, fontWeight: '700', color: '#FFFFFF' },
})
