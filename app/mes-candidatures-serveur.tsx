import { useFocusEffect, useRouter } from 'expo-router'
import React, { useCallback, useState } from 'react'
import { RefreshControl, ScrollView, StatusBar, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { EURO } from '../lib/currency'
import {
  fetchMissionNegotiationForServer,
  type MissionRateNegotiationRecord,
} from '../lib/mission-rate-negotiations'
import { getNearbyOffresForServeur, type OffreProche } from '../lib/offres'
import { supabase } from '../lib/supabase'
import {
  fetchWorkerTrackedApplications,
  getWorkerTrackedApplicationTone,
  type WorkerTrackedApplication,
} from '../lib/worker-applications'

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
  accentSoft: '#EFF8F2',
  accentSoftBorder: '#CFE2D4',
  terra: '#C46A3C',
  terraBg: '#FEF4EB',
  terraBd: '#F2CFB4',
  red: '#C84B4B',
  redBg: '#FEF2F2',
  redBd: '#F0CECE',
}

function posteInitiale(p: string) { return p?.slice(0, 2).toUpperCase() ?? '??' }
function posteColor(p: string) { const l = p.toLowerCase(); if (l.includes('bar')) return '#C46A3C'; if (l.includes('chef') || l.includes('rang')) return '#2E8B57'; if (l.includes('runner')) return '#B8893C'; return '#9A9388' }
function formatDateFr(d: string) { try { return new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) } catch { return d } }
const netEstime = (s: number) => Math.round(s * 0.75)

async function getCurrentUserId() {
  const { data: { user } } = await supabase.auth.getUser()
  return user?.id ?? null
}

type NegotiationItem = OffreProche & { negotiation: MissionRateNegotiationRecord }

export default function MesCandidaturesServeurScreen() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [candidatures, setCandidatures] = useState<WorkerTrackedApplication[]>([])
  const [negotiations, setNegotiations] = useState<NegotiationItem[]>([])

  const fetchData = useCallback(async () => {
    const userId = await getCurrentUserId()
    if (!userId) {
      router.replace('/')
      return
    }

    const [tracked, nearbyOffres] = await Promise.all([
      fetchWorkerTrackedApplications(userId),
      getNearbyOffresForServeur(userId, undefined, 50),
    ])

    const negotiationEntries = await Promise.all(
      nearbyOffres.map(async (offre) => {
        const negotiation = await fetchMissionNegotiationForServer(userId, offre.id)
        return negotiation ? ({ ...offre, negotiation }) : null
      })
    )

    setCandidatures(tracked)
    setNegotiations(
      negotiationEntries.filter((item): item is NegotiationItem =>
        Boolean(item && ['pending', 'accepted'].includes(item.negotiation.status))
      )
    )
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
          <Text style={s.eyebrow}>SUIVI</Text>
          <Text style={s.pageTitle}>Mes candidatures</Text>
          <Text style={s.pageSub}>
            {candidatures.length} candidature{candidatures.length > 1 ? 's' : ''} active{candidatures.length > 1 ? 's' : ''}
          </Text>
        </View>

        {loading ? (
          <View style={s.emptyCard}>
            <Text style={s.emptyTxt}>Chargement...</Text>
          </View>
        ) : (
          <>
            {negotiations.length > 0 && (
              <>
                <View style={s.sectionHeader}>
                  <Text style={s.sectionTitle}>Négociations</Text>
                  <View style={s.sectionBadge}><Text style={s.sectionBadgeTxt}>{negotiations.length}</Text></View>
                </View>
                <View style={s.list}>
                  {negotiations.map((item, index) => (
                    <View key={item.id} style={[s.card, index < negotiations.length - 1 && s.cardMb]}>
                      <View style={s.cardTop}>
                        <View style={[s.iconWrap, { backgroundColor: `${posteColor(item.poste)}18` }]}>
                          <Text style={[s.iconTxt, { color: posteColor(item.poste) }]}>{posteInitiale(item.poste)}</Text>
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={s.cardPoste}>{item.poste}</Text>
                          <Text style={s.cardResto}>{item.nom_restaurant ?? 'Établissement'}</Text>
                        </View>
                        <View style={[s.badge, item.negotiation.status === 'accepted' ? s.badgePositive : s.badgeWarm]}>
                          <Text style={[s.badgeTxt, item.negotiation.status === 'accepted' ? s.badgeTxtPositive : s.badgeTxtWarm]}>
                            {item.negotiation.status === 'accepted' ? 'Acceptée' : 'Négociation'}
                          </Text>
                        </View>
                      </View>
                      <View style={s.detailList}>
                        <View style={s.detailRow}><Text style={s.detailLabel}>Date</Text><Text style={s.detailValue}>{formatDateFr(item.date)}</Text></View>
                        <View style={s.detailRow}><Text style={s.detailLabel}>Horaires</Text><Text style={s.detailValue}>{item.heure_debut} - {item.heure_fin}</Text></View>
                        <View style={s.detailRow}><Text style={s.detailLabel}>Mission</Text><Text style={s.detailValueStrong}>{item.salaire}{EURO} / h brut</Text></View>
                        <View style={s.detailRow}><Text style={s.detailLabel}>Votre offre</Text><Text style={s.detailValueStrong}>{item.negotiation.counter_rate}{EURO} / h brut</Text></View>
                      </View>
                    </View>
                  ))}
                </View>
              </>
            )}

            <View style={s.sectionHeader}>
              <Text style={s.sectionTitle}>Candidatures</Text>
              <View style={s.sectionBadge}><Text style={s.sectionBadgeTxt}>{candidatures.length}</Text></View>
            </View>

            {candidatures.length === 0 ? (
              <View style={s.emptyCard}>
                <Text style={s.emptyTitle}>Aucune candidature active</Text>
                <Text style={s.emptyTxt}>Les missions auxquelles vous avez postulé apparaîtront ici.</Text>
              </View>
            ) : (
              <View style={s.list}>
                {candidatures.map((candidature, index) => {
                  const tone = getWorkerTrackedApplicationTone(candidature.status)
                  return (
                    <View key={candidature.demande_id} style={[s.card, index < candidatures.length - 1 && s.cardMb]}>
                      <View style={s.cardTop}>
                        <View style={[s.iconWrap, { backgroundColor: `${posteColor(candidature.poste)}18` }]}>
                          <Text style={[s.iconTxt, { color: posteColor(candidature.poste) }]}>{posteInitiale(candidature.poste)}</Text>
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={s.cardPoste}>{candidature.poste}</Text>
                          <Text style={s.cardResto}>{candidature.etablissement_nom}</Text>
                        </View>
                        <View style={[s.badge, { backgroundColor: tone.bg, borderColor: tone.border }]}>
                          <Text style={[s.badgeTxt, { color: tone.text }]}>{candidature.status_label}</Text>
                        </View>
                      </View>
                      <View style={s.detailList}>
                        <View style={s.detailRow}><Text style={s.detailLabel}>Ville</Text><Text style={s.detailValue}>{candidature.ville}</Text></View>
                        <View style={s.detailRow}><Text style={s.detailLabel}>Date</Text><Text style={s.detailValue}>{formatDateFr(candidature.date)}</Text></View>
                        <View style={s.detailRow}><Text style={s.detailLabel}>Horaires</Text><Text style={s.detailValue}>{candidature.heure_debut} - {candidature.heure_fin}</Text></View>
                        <View style={s.detailRow}><Text style={s.detailLabel}>Tarif</Text><Text style={s.detailValueStrong}>{candidature.salaire != null ? `~${netEstime(candidature.salaire)}${EURO} / h net` : '-'}</Text></View>
                      </View>
                    </View>
                  )
                })}
              </View>
            )}
          </>
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
  sectionHeader: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sectionTitle: { fontSize: 20, fontWeight: '800', color: C.title },
  sectionBadge: { minWidth: 24, height: 24, borderRadius: 12, backgroundColor: '#EED8C5', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  sectionBadgeTxt: { fontSize: 10, fontWeight: '800', color: '#8C5A38' },
  list: { paddingHorizontal: 16 },
  card: { backgroundColor: C.card, borderRadius: 24, borderWidth: 1, borderColor: C.border, padding: 16, shadowColor: '#2B2118', shadowOpacity: 0.04, shadowOffset: { width: 0, height: 6 }, shadowRadius: 12, elevation: 1 },
  cardMb: { marginBottom: 12 },
  cardTop: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  iconWrap: { width: 46, height: 46, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  iconTxt: { fontSize: 13, fontWeight: '800' },
  cardPoste: { fontSize: 16, fontWeight: '800', color: C.title },
  cardResto: { fontSize: 12, color: C.textMuted, marginTop: 3, fontWeight: '600' },
  badge: { borderRadius: 999, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 5 },
  badgeWarm: { backgroundColor: C.terraBg, borderColor: C.terraBd },
  badgePositive: { backgroundColor: C.accentSoft, borderColor: C.accentSoftBorder },
  badgeTxt: { fontSize: 10, fontWeight: '800' },
  badgeTxtWarm: { color: C.terra },
  badgeTxtPositive: { color: C.accent },
  detailList: { gap: 8, backgroundColor: '#FBF8F3', borderRadius: 16, borderWidth: 1, borderColor: C.borderSoft, paddingHorizontal: 12, paddingVertical: 11 },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  detailLabel: { fontSize: 11, color: C.textMuted, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5 },
  detailValue: { flex: 1, textAlign: 'right', fontSize: 12, color: C.title, fontWeight: '700' },
  detailValueStrong: { flex: 1, textAlign: 'right', fontSize: 13, color: C.title, fontWeight: '800' },
  emptyCard: { marginHorizontal: 16, backgroundColor: C.card, borderRadius: 24, borderWidth: 1, borderColor: C.border, paddingHorizontal: 20, paddingVertical: 22, alignItems: 'center' },
  emptyTitle: { fontSize: 16, fontWeight: '800', color: C.title, marginBottom: 6, textAlign: 'center' },
  emptyTxt: { fontSize: 13, color: C.textSoft, textAlign: 'center', lineHeight: 18 },
})
