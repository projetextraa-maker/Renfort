import { useFocusEffect, useRouter } from 'expo-router'
import React, { useCallback, useState } from 'react'
import { RefreshControl, ScrollView, StatusBar, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { ANNONCE_COMPAT_SELECT, normalizeAnnonceRecords } from '../lib/annonce-read'
import { EURO } from '../lib/currency'
import { fetchEtablissementNameMapByIds } from '../lib/etablissements'
import { COMPLETED_MISSION_READ_STATUSES } from '../lib/missions'
import { supabase } from '../lib/supabase'

const C = {
  bg: '#F7F3EC',
  card: '#FFFEFC',
  cardSoft: '#F7F1E8',
  border: '#E8DED1',
  borderSoft: '#F0E8DC',
  title: '#1B1713',
  textSoft: '#6F665C',
  textMuted: '#9E9488',
  accent: '#2E8B57',
}

function posteInitiale(p: string) { return p?.slice(0, 2).toUpperCase() ?? '??' }
function posteColor(p: string) { const l = p.toLowerCase(); if (l.includes('bar')) return '#C46A3C'; if (l.includes('chef') || l.includes('rang')) return '#2E8B57'; if (l.includes('runner')) return '#B8893C'; return '#9A9388' }
function formatDateFr(d: string) { try { return new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) } catch { return d } }
const netEstime = (s: number) => Math.round(s * 0.75)

type MissionFinished = {
  id: string
  poste: string
  etablissement_id?: string | null
  ville: string
  date: string
  heure_debut: string
  heure_fin: string
  salaire: number
  statut: string
  nom_restaurant: string
}

async function getCurrentUserId() {
  const { data: { user } } = await supabase.auth.getUser()
  return user?.id ?? null
}

export default function MissionsTermineesServeurScreen() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [missions, setMissions] = useState<MissionFinished[]>([])

  const fetchData = useCallback(async () => {
    const userId = await getCurrentUserId()
    if (!userId) {
      router.replace('/')
      return
    }

    const { data: completedAnnonces } = await supabase
      .from('annonces')
      .select(ANNONCE_COMPAT_SELECT)
      .eq('serveur_id', userId)
      .in('statut', [...COMPLETED_MISSION_READ_STATUSES])
      .order('date', { ascending: false })
      .order('heure_debut', { ascending: false })

    const normalized = normalizeAnnonceRecords(completedAnnonces as any[])
    if (normalized.length === 0) {
      setMissions([])
      return
    }

    const patronIds = [...new Set(normalized.map((a: any) => a.patron_id))]
    const etablissementIds = [...new Set(normalized.map((a: any) => a.etablissement_id).filter(Boolean))]
    const { data: patronsData } = await supabase.from('patrons').select('id, nom_restaurant').in('id', patronIds)
    const etablissementMap = etablissementIds.length > 0 ? await fetchEtablissementNameMapByIds(etablissementIds as string[]) : {}
    const patronMap: Record<string, string> = {}
    ;(patronsData ?? []).forEach((p: any) => { patronMap[String(p.id)] = p.nom_restaurant ?? 'Restaurant' })

    setMissions(normalized.map((a: any) => ({
      id: a.id,
      poste: a.poste,
      etablissement_id: a.etablissement_id,
      ville: a.ville,
      date: a.date,
      heure_debut: a.heure_debut,
      heure_fin: a.heure_fin,
      salaire: a.salaire,
      statut: a.statut,
      nom_restaurant: (a.etablissement_id ? etablissementMap[String(a.etablissement_id)] : null) ?? patronMap[String(a.patron_id)] ?? 'Restaurant',
    })))
  }, [router])

  useFocusEffect(
    useCallback(() => {
      let mounted = true
      ;(async () => {
        try {
          await fetchData()
        } finally {
          if (mounted) setLoading(false)
        }
      })()
      return () => { mounted = false }
    }, [fetchData])
  )

  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    await fetchData()
    setRefreshing(false)
  }, [fetchData])

  return (
    <View style={s.screen}>
      <StatusBar barStyle="dark-content" backgroundColor={C.bg} />
      <ScrollView
        style={s.scroll}
        contentContainerStyle={s.content}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.accent} />}
      >
        <View style={s.header}>
          <TouchableOpacity style={s.backBtn} onPress={() => router.back()} activeOpacity={0.8}>
            <Text style={s.backTxt}>Retour</Text>
          </TouchableOpacity>
          <Text style={s.eyebrow}>HISTORIQUE</Text>
          <Text style={s.pageTitle}>Terminées</Text>
          <Text style={s.pageSub}>
            {missions.length} mission{missions.length > 1 ? 's' : ''} clôturée{missions.length > 1 ? 's' : ''}
          </Text>
        </View>

        {loading ? (
          <View style={s.emptyCard}>
            <Text style={s.emptyTxt}>Chargement...</Text>
          </View>
        ) : missions.length === 0 ? (
          <View style={s.emptyCard}>
            <Text style={s.emptyTitle}>Aucune mission terminée</Text>
            <Text style={s.emptyTxt}>Vos missions clôturées apparaîtront ici.</Text>
          </View>
        ) : (
          <View style={s.list}>
            {missions.map((mission, index) => (
              <View key={mission.id} style={[s.card, index < missions.length - 1 && s.cardMb]}>
                <View style={s.cardTop}>
                  <View style={[s.iconWrap, { backgroundColor: `${posteColor(mission.poste)}18` }]}>
                    <Text style={[s.iconTxt, { color: posteColor(mission.poste) }]}>{posteInitiale(mission.poste)}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.cardPoste}>{mission.poste}</Text>
                    <Text style={s.cardResto}>{mission.nom_restaurant}</Text>
                  </View>
                  <View style={s.badge}>
                    <Text style={s.badgeTxt}>Terminée</Text>
                  </View>
                </View>
                <View style={s.detailList}>
                  <View style={s.detailRow}><Text style={s.detailLabel}>Date</Text><Text style={s.detailValue}>{formatDateFr(mission.date)}</Text></View>
                  <View style={s.detailRow}><Text style={s.detailLabel}>Horaires</Text><Text style={s.detailValue}>{mission.heure_debut} - {mission.heure_fin}</Text></View>
                  <View style={s.detailRow}><Text style={s.detailLabel}>Ville</Text><Text style={s.detailValue}>{mission.ville}</Text></View>
                  <View style={s.detailRow}><Text style={s.detailLabel}>Tarif</Text><Text style={s.detailValueStrong}>{`~${netEstime(mission.salaire)}${EURO} / h net`}</Text></View>
                </View>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  )
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  scroll: { flex: 1 },
  content: { paddingBottom: 80 },
  header: { paddingHorizontal: 20, paddingTop: 56, paddingBottom: 18 },
  backBtn: { alignSelf: 'flex-start', marginBottom: 12 },
  backTxt: { fontSize: 15, color: C.accent, fontWeight: '800' },
  eyebrow: { fontSize: 10, letterSpacing: 1.2, textTransform: 'uppercase', color: C.textMuted, marginBottom: 6, fontWeight: '800' },
  pageTitle: { fontSize: 28, fontWeight: '800', color: C.title, marginBottom: 4 },
  pageSub: { fontSize: 14, color: C.textSoft },
  list: { paddingHorizontal: 16 },
  card: { backgroundColor: C.card, borderRadius: 24, borderWidth: 1, borderColor: C.border, padding: 16, shadowColor: '#2B2118', shadowOpacity: 0.04, shadowOffset: { width: 0, height: 6 }, shadowRadius: 12, elevation: 1 },
  cardMb: { marginBottom: 12 },
  cardTop: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  iconWrap: { width: 46, height: 46, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  iconTxt: { fontSize: 13, fontWeight: '800' },
  cardPoste: { fontSize: 16, fontWeight: '800', color: C.title },
  cardResto: { fontSize: 12, color: C.textMuted, marginTop: 3, fontWeight: '600' },
  badge: { borderRadius: 999, borderWidth: 1, borderColor: C.borderSoft, backgroundColor: C.cardSoft, paddingHorizontal: 10, paddingVertical: 5 },
  badgeTxt: { fontSize: 10, fontWeight: '800', color: C.textSoft },
  detailList: { gap: 8, backgroundColor: '#FBF8F3', borderRadius: 16, borderWidth: 1, borderColor: C.borderSoft, paddingHorizontal: 12, paddingVertical: 11 },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  detailLabel: { fontSize: 11, color: C.textMuted, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5 },
  detailValue: { flex: 1, textAlign: 'right', fontSize: 12, color: C.title, fontWeight: '700' },
  detailValueStrong: { flex: 1, textAlign: 'right', fontSize: 13, color: C.title, fontWeight: '800' },
  emptyCard: { marginHorizontal: 16, backgroundColor: C.card, borderRadius: 24, borderWidth: 1, borderColor: C.border, paddingHorizontal: 20, paddingVertical: 22, alignItems: 'center' },
  emptyTitle: { fontSize: 16, fontWeight: '800', color: C.title, marginBottom: 6, textAlign: 'center' },
  emptyTxt: { fontSize: 13, color: C.textSoft, textAlign: 'center', lineHeight: 18 },
})
