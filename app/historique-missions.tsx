import { useFocusEffect, useRouter } from 'expo-router'
import { useCallback, useState } from 'react'
import {
  RefreshControl,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import PatronBottomNav from '../components/PatronBottomNav'
import { ANNONCE_COMPAT_SELECT, normalizeAnnonceRecords } from '../lib/annonce-read'
import { EURO } from '../lib/currency'
import { fetchPatronMissionEvaluationMap } from '../lib/evaluations'
import { fetchEtablissementNameMapByIds } from '../lib/etablissements'
import { normalizeMissionStatus } from '../lib/missions'
import { supabase } from '../lib/supabase'

const C = {
  bg: '#F7F4EE',
  card: '#FFFFFF',
  cardSoft: '#F7F4EE',
  cardWarm: '#FCF8F2',
  border: '#EDE8DF',
  borderSoft: '#F0EBE3',
  title: '#171614',
  text: '#2A2723',
  muted: '#B0A89C',
  soft: '#7A7166',
  softDark: '#5F574C',
  terra: '#C46A3C',
  terraDark: '#9F542D',
  terraBg: '#FEF3EB',
  terraBd: '#F5C9A9',
  green: '#2E8B57',
  greenBg: '#F0F8F3',
  greenBd: '#C0DEC8',
  amber: '#B8893C',
  amberBg: '#FBF5E8',
  amberBd: '#E8D4A0',
  red: '#C84B4B',
  redBg: '#FEF2F2',
  redBd: '#F2CACA',
  shadow: '#2B2118',
}

function statutConfig(statut: string) {
  switch (normalizeMissionStatus(statut)) {
    case 'open':
      return { label: 'En attente', bg: C.amberBg, color: C.amber, border: C.amberBd }
    case 'confirmed':
      return { label: 'Confirmée', bg: C.greenBg, color: C.green, border: C.greenBd }
    case 'in_progress':
      return { label: 'En cours', bg: C.greenBg, color: C.green, border: C.greenBd }
    case 'completed':
      return { label: 'Terminée', bg: '#F5F3F0', color: '#888', border: '#E0D9D0' }
    case 'no_show':
      return { label: 'Absent', bg: C.redBg, color: C.red, border: C.redBd }
    case 'cancelled_by_patron':
      return { label: 'Annulée par vous', bg: C.redBg, color: C.red, border: C.redBd }
    case 'cancelled_by_server':
      return { label: 'Annulée par le serveur', bg: C.redBg, color: C.red, border: C.redBd }
    case 'expired':
      return { label: 'Expirée', bg: C.redBg, color: C.red, border: C.redBd }
    default:
      return { label: statut, bg: '#F5F3F0', color: '#888', border: '#E0D9D0' }
  }
}

function StarDisplay({ note }: { note: number }) {
  return (
    <View style={{ flexDirection: 'row', gap: 4 }}>
      {[1, 2, 3, 4, 5].map((n) => (
        <View
          key={n}
          style={{
            width: 12,
            height: 12,
            borderRadius: 6,
            backgroundColor: note >= n ? C.amber : '#D7CFC3',
          }}
        />
      ))}
    </View>
  )
}

function isEvaluable(statut: string) {
  return normalizeMissionStatus(statut) === 'completed'
}

export default function HistoriqueMissions() {
  const router = useRouter()
  const [missions, setMissions] = useState<any[]>([])
  const [etablissementNames, setEtablissementNames] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const chargerMissions = useCallback(async () => {
    setLoading(true)
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      setLoading(false)
      return
    }

    const { data, error } = await supabase
      .from('annonces')
      .select(`${ANNONCE_COMPAT_SELECT}, serveurs(prenom, nom)`)
      .eq('patron_id', user.id)
      .order('created_at', { ascending: false })

    if (!error && data) {
      const normalized = normalizeAnnonceRecords(data as any[])
        .map((mission, index) => ({
          ...mission,
          serveurs: (data as any[])[index]?.serveurs ?? null,
        }))
        .filter((mission) => normalizeMissionStatus(mission.statut) === 'completed')

      const evaluationMap = await fetchPatronMissionEvaluationMap(
        user.id,
        normalized
          .filter((mission) => isEvaluable(mission.statut) && mission.serveur_id)
          .map((mission) => mission.id)
      )

      const missionsWithRatingStatus = normalized.map((mission) => ({
        ...mission,
        rating_status:
          isEvaluable(mission.statut) && mission.serveur_id
            ? (evaluationMap[mission.id]?.status ?? 'pending')
            : 'rated',
      }))

      setEtablissementNames(
        await fetchEtablissementNameMapByIds(
          missionsWithRatingStatus.map((mission) => mission.etablissement_id).filter(Boolean) as string[]
        )
      )
      setMissions(missionsWithRatingStatus)
    }
    setLoading(false)
  }, [])

  useFocusEffect(
    useCallback(() => {
      chargerMissions()
    }, [chargerMissions])
  )

  const onRefresh = async () => {
    setRefreshing(true)
    await chargerMissions()
    setRefreshing(false)
  }

  return (
    <View style={s.screen}>
      <StatusBar barStyle="dark-content" backgroundColor={C.bg} />

      <ScrollView
        style={s.scroll}
        contentContainerStyle={s.content}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.terra} />}
      >
        <View style={s.header}>
          <TouchableOpacity style={s.backBtn} onPress={() => router.back()} activeOpacity={0.75}>
            <Text style={s.backTxt}>Retour</Text>
          </TouchableOpacity>
          <Text style={s.eyebrow}>HISTORIQUE</Text>
          <Text style={s.pageTitle}>Missions terminées</Text>
          <Text style={s.pageSub}>
            {missions.length} mission{missions.length > 1 ? 's' : ''} terminée{missions.length > 1 ? 's' : ''}
          </Text>
        </View>

        {loading ? (
          <View style={s.emptyCard}>
            <Text style={s.emptyTxt}>Chargement...</Text>
          </View>
        ) : missions.length === 0 ? (
          <View style={s.emptyCard}>
            <Text style={s.emptyTitle}>Aucune mission dans l&apos;historique</Text>
            <Text style={s.emptyTxt}>Les missions terminées apparaîtront ici une fois clôturées.</Text>
          </View>
        ) : (
          missions.map((mission: any, i: number) => {
            const cfg = statutConfig(mission.statut)
            const nomSrv = mission.serveurs ? `${mission.serveurs.prenom} ${mission.serveurs.nom}` : null
            const evaluable =
              isEvaluable(mission.statut) && mission.rating_status === 'pending' && mission.serveur_id

            return (
              <View key={mission.id} style={[s.card, i < missions.length - 1 && s.cardMb]}>
                <View style={s.cardTop}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.cardPoste}>{mission.poste}</Text>
                    <Text style={s.cardMeta}>
                      {mission.etablissement_id ? etablissementNames[mission.etablissement_id] ?? mission.ville : mission.ville}
                    </Text>
                    <Text style={s.cardMeta}>{mission.ville} - {mission.date}</Text>
                  </View>
                  <View style={[s.badge, { backgroundColor: cfg.bg, borderColor: cfg.border }]}>
                    <Text style={[s.badgeTxt, { color: cfg.color }]}>{cfg.label}</Text>
                  </View>
                </View>

                <Text style={s.archiveHint}>
                  {evaluable
                    ? 'Mission terminée, check-out effectué. L’évaluation reste à faire.'
                    : 'Mission terminée et consultable dans votre historique.'}
                </Text>

                <View style={s.infoRow}>
                  <View style={s.infoCard}>
                    <Text style={s.infoLabel}>Horaire</Text>
                    <Text style={s.infoValue}>{mission.heure_debut} - {mission.heure_fin}</Text>
                  </View>
                  <View style={s.infoCard}>
                    <Text style={s.infoLabel}>Salaire</Text>
                    <Text style={s.infoValue}>{mission.salaire}{EURO} / h brut</Text>
                  </View>
                </View>

                {nomSrv && (
                  <View style={s.serveurRow}>
                    <View style={s.serveurAvatar}>
                      <Text style={s.serveurAvatarTxt}>
                        {nomSrv.split(' ').map((p: string) => p[0]).join('').slice(0, 2).toUpperCase()}
                      </Text>
                    </View>
                    <View>
                      <Text style={s.serveurLabel}>Serveur</Text>
                      <Text style={s.serveurNom}>{nomSrv}</Text>
                    </View>
                  </View>
                )}

                <View style={s.badgeRow}>
                  <View
                    style={[
                      s.badge,
                      {
                        backgroundColor: mission.rating_status === 'pending' ? C.terraBg : C.greenBg,
                        borderColor: mission.rating_status === 'pending' ? C.terraBd : C.greenBd,
                      },
                    ]}
                  >
                    <Text style={[s.badgeTxt, { color: mission.rating_status === 'pending' ? C.terraDark : C.green }]}>
                      {mission.rating_status === 'pending' ? 'Évaluation en attente' : 'Évaluée'}
                    </Text>
                  </View>
                </View>

                {mission.note != null && (
                  <View style={s.noteRow}>
                    <StarDisplay note={mission.note} />
                    <Text style={s.noteLbl}>Note déjà laissée</Text>
                  </View>
                )}

                <View style={s.actionsCol}>
                  <TouchableOpacity
                    style={s.evalBtn}
                    onPress={() => router.push({ pathname: '/mission-terminee-detail', params: { annonceId: mission.id } })}
                    activeOpacity={0.85}
                  >
                    <Text style={s.evalBtnTxt}>Voir le détail</Text>
                  </TouchableOpacity>
                  {evaluable && (
                    <TouchableOpacity
                      style={s.detailBtn}
                      onPress={() =>
                        router.push({
                          pathname: '/evaluer-serveur',
                          params: {
                            annonceId: mission.id,
                            serveurId: mission.serveur_id,
                            serveurNom: nomSrv || 'le serveur',
                          },
                        })
                      }
                      activeOpacity={0.85}
                    >
                      <Text style={s.detailBtnTxt}>Évaluer le serveur</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            )
          })
        )}
      </ScrollView>
      <PatronBottomNav />
    </View>
  )
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  scroll: { flex: 1 },
  content: { paddingBottom: 120 },

  header: { paddingHorizontal: 20, paddingTop: 56, paddingBottom: 20 },
  backBtn: { alignSelf: 'flex-start', marginBottom: 12 },
  backTxt: { fontSize: 15, color: C.terra, fontWeight: '700' },
  eyebrow: { fontSize: 10, letterSpacing: 1.3, textTransform: 'uppercase', color: C.muted, marginBottom: 6, fontWeight: '600' },
  pageTitle: { fontSize: 28, fontWeight: '800', color: C.title, marginBottom: 4 },
  pageSub: { fontSize: 14, color: C.soft },

  emptyCard: {
    marginHorizontal: 20,
    marginTop: 8,
    backgroundColor: C.card,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: C.border,
    padding: 22,
    alignItems: 'center',
  },
  emptyTitle: { fontSize: 16, fontWeight: '800', color: C.title, marginBottom: 6, textAlign: 'center' },
  emptyTxt: { fontSize: 13, color: C.soft, textAlign: 'center', lineHeight: 19 },

  card: {
    marginHorizontal: 16,
    backgroundColor: C.card,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: C.border,
    padding: 16,
    shadowColor: C.shadow,
    shadowOpacity: 0.05,
    shadowOffset: { width: 0, height: 6 },
    shadowRadius: 14,
    elevation: 2,
  },
  cardMb: { marginBottom: 12 },
  cardTop: { flexDirection: 'row', gap: 12, marginBottom: 14 },
  cardPoste: { fontSize: 18, fontWeight: '800', color: C.title, marginBottom: 3 },
  cardMeta: { fontSize: 13, color: C.soft, lineHeight: 18 },
  archiveHint: { fontSize: 12, color: C.soft, lineHeight: 18, marginBottom: 12 },

  badge: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
    alignSelf: 'flex-start',
  },
  badgeTxt: { fontSize: 11, fontWeight: '800' },
  badgeRow: { marginBottom: 12 },

  infoRow: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  infoCard: {
    flex: 1,
    backgroundColor: C.cardWarm,
    borderWidth: 1,
    borderColor: C.borderSoft,
    borderRadius: 16,
    padding: 12,
  },
  infoLabel: { fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.8, color: C.muted, marginBottom: 5, fontWeight: '700' },
  infoValue: { fontSize: 14, color: C.title, fontWeight: '700' },

  serveurRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: C.cardWarm,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.borderSoft,
    padding: 12,
    marginBottom: 12,
  },
  serveurAvatar: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: C.terraBg,
    borderWidth: 1,
    borderColor: C.terraBd,
    alignItems: 'center',
    justifyContent: 'center',
  },
  serveurAvatarTxt: { fontSize: 14, fontWeight: '800', color: C.terraDark },
  serveurLabel: { fontSize: 11, textTransform: 'uppercase', color: C.muted, fontWeight: '700', marginBottom: 2 },
  serveurNom: { fontSize: 14, color: C.title, fontWeight: '700' },

  noteRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  noteLbl: { fontSize: 13, color: C.softDark, fontWeight: '600' },

  actionsCol: { gap: 10 },
  evalBtn: {
    backgroundColor: C.terra,
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: 'center',
  },
  evalBtnTxt: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
  detailBtn: {
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: '#FFFFFF',
  },
  detailBtnTxt: { color: C.softDark, fontSize: 15, fontWeight: '700' },
})
