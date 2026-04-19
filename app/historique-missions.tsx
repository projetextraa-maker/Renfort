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
import { fetchEtablissementNameMapByIds } from '../lib/etablissements'
import { normalizeMissionStatus } from '../lib/missions'
import { supabase } from '../lib/supabase'

const C = {
  bg:        '#F7F4EE',
  card:      '#FFFFFF',
  cardSoft:  '#F7F4EE',
  cardWarm:  '#FCF8F2',
  border:    '#EDE8DF',
  borderSoft:'#F0EBE3',
  title:     '#171614',
  text:      '#2A2723',
  muted:     '#B0A89C',
  soft:      '#7A7166',
  softDark:  '#5F574C',
  terra:     '#C46A3C',
  terraDark: '#9F542D',
  terraBg:   '#FEF3EB',
  terraBd:   '#F5C9A9',
  green:     '#2E8B57',
  greenBg:   '#F0F8F3',
  greenBd:   '#C0DEC8',
  amber:     '#B8893C',
  amberBg:   '#FBF5E8',
  amberBd:   '#E8D4A0',
  red:       '#C84B4B',
  redBg:     '#FEF2F2',
  redBd:     '#F2CACA',
  shadow:    '#2B2118',
}

function statutConfig(statut: string) {
  switch (normalizeMissionStatus(statut)) {
    case 'open':               return { label: 'En attente',             bg: C.amberBg, color: C.amber,   border: C.amberBd }
    case 'confirmed':          return { label: 'Confirmee',              bg: C.greenBg, color: C.green,   border: C.greenBd }
    case 'in_progress':        return { label: 'En cours',               bg: C.greenBg, color: C.green,   border: C.greenBd }
    case 'completed':          return { label: 'Terminee',               bg: '#F5F3F0', color: '#888',    border: '#E0D9D0' }
    case 'no_show':            return { label: 'Absent',                 bg: C.redBg,   color: C.red,     border: C.redBd   }
    case 'cancelled_by_patron':return { label: 'Annulee par vous',       bg: C.redBg,   color: C.red,     border: C.redBd   }
    case 'cancelled_by_server':return { label: 'Annulee par le serveur', bg: C.redBg,   color: C.red,     border: C.redBd   }
    case 'expired':            return { label: 'Expiree',                bg: C.redBg,   color: C.red,     border: C.redBd   }
    default:                   return { label: statut,                   bg: '#F5F3F0', color: '#888',    border: '#E0D9D0' }
  }
}

function StarDisplay({ note }: { note: number }) {
  return (
    <View style={{ flexDirection: 'row', gap: 4 }}>
      {[1,2,3,4,5].map(n => (
        <View
          key={n}
          style={{
            width: 12, height: 12, borderRadius: 6,
            backgroundColor: note >= n ? C.amber : '#D7CFC3',
          }}
        />
      ))}
    </View>
  )
}

export default function HistoriqueMissions() {
  const router = useRouter()
  const [missions,   setMissions]   = useState<any[]>([])
  const [etablissementNames, setEtablissementNames] = useState<Record<string, string>>({})
  const [loading,    setLoading]    = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const chargerMissions = async () => {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setLoading(false); return }

    const { data, error } = await supabase
      .from('annonces')
      .select(`${ANNONCE_COMPAT_SELECT}, serveurs(prenom, nom)`)
      .eq('patron_id', user.id)
      .not('statut', 'in', '("ouverte","open","pending")')
      .order('created_at', { ascending: false })

    if (!error && data) {
      const normalized = normalizeAnnonceRecords(data as any[]).map((mission, index) => ({
        ...mission,
        serveurs: (data as any[])[index]?.serveurs ?? null,
      }))
      setEtablissementNames(await fetchEtablissementNameMapByIds(
        normalized.map((mission) => mission.etablissement_id).filter(Boolean) as string[]
      ))
      setMissions(normalized)
    }
    setLoading(false)
  }

  useFocusEffect(useCallback(() => { chargerMissions() }, []))

  const onRefresh = async () => {
    setRefreshing(true)
    await chargerMissions()
    setRefreshing(false)
  }

  const isEvaluable = (statut: string) => {
    const n = normalizeMissionStatus(statut)
    return n === 'completed'
  }

  return (
    <View style={s.screen}>
      <StatusBar barStyle="dark-content" backgroundColor={C.bg} />

      <ScrollView
        style={s.scroll}
        contentContainerStyle={s.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.terra} />
        }
      >
        {/* HEADER */}
        <View style={s.header}>
          <TouchableOpacity style={s.backBtn} onPress={() => router.back()} activeOpacity={0.75}>
            <Text style={s.backTxt}>← Retour</Text>
          </TouchableOpacity>
          <Text style={s.eyebrow}>HISTORIQUE</Text>
          <Text style={s.pageTitle}>Missions</Text>
          <Text style={s.pageSub}>
            {missions.length} mission{missions.length > 1 ? 's' : ''} au total
          </Text>
        </View>

        {/* CONTENU */}
        {loading ? (
          <View style={s.emptyCard}>
            <Text style={s.emptyTxt}>Chargement...</Text>
          </View>
        ) : missions.length === 0 ? (
          <View style={s.emptyCard}>
            <Text style={s.emptyTitle}>Aucune mission dans l&apos;historique</Text>
            <Text style={s.emptyTxt}>Les missions terminees apparaitront ici.</Text>
          </View>
        ) : (
          missions.map((mission: any, i: number) => {
            const cfg     = statutConfig(mission.statut)
            const nomSrv  = mission.serveurs
              ? `${mission.serveurs.prenom} ${mission.serveurs.nom}`
              : null
            const evaluable = isEvaluable(mission.statut) && !mission.note && mission.serveur_id

            return (
              <View key={mission.id} style={[s.card, i < missions.length - 1 && s.cardMb]}>

                {/* TOP */}
                <View style={s.cardTop}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.cardPoste}>{mission.poste}</Text>
                    <Text style={s.cardMeta}>{mission.etablissement_id ? etablissementNames[mission.etablissement_id] ?? mission.ville : mission.ville}</Text>
                    <Text style={s.cardMeta}>{mission.ville} - {mission.date}</Text>
                  </View>
                  <View style={[s.badge, { backgroundColor: cfg.bg, borderColor: cfg.border }]}>
                    <Text style={[s.badgeTxt, { color: cfg.color }]}>{cfg.label}</Text>
                  </View>
                </View>

                {/* INFOS */}
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

                {/* SERVEUR */}
                {nomSrv && (
                  <View style={s.serveurRow}>
                    <View style={s.serveurAvatar}>
                      <Text style={s.serveurAvatarTxt}>
                        {nomSrv.split(' ').map((p: string) => p[0]).join('').slice(0, 2).toUpperCase()}
                      </Text>
                    </View>
                    <View>
                      <Text style={s.serveurLabel}>Prestataire</Text>
                      <Text style={s.serveurNom}>{nomSrv}</Text>
                    </View>
                  </View>
                )}

                {/* NOTE EXISTANTE */}
                {mission.note != null && (
                  <View style={s.noteRow}>
                    <StarDisplay note={mission.note} />
                    <Text style={s.noteLbl}>Note attribuee</Text>
                  </View>
                )}

                {/* BOUTON EVALUER */}
                {evaluable && (
                  <TouchableOpacity
                    style={s.evalBtn}
                    onPress={() => router.push({
                      pathname: '/evaluer-serveur',
                      params: {
                        annonceId: mission.id,
                        serveurId: mission.serveur_id,
                        serveurNom: nomSrv || 'le prestataire',
                      },
                    })}
                    activeOpacity={0.85}
                  >
                    <Text style={s.evalBtnTxt}>Evaluer le prestataire</Text>
                  </TouchableOpacity>
                )}
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
  screen:  { flex: 1, backgroundColor: C.bg },
  scroll:  { flex: 1 },
  content: { paddingBottom: 124 },

  header:    { paddingTop: 56, paddingHorizontal: 24, paddingBottom: 24 },
  backBtn:   { marginBottom: 16, alignSelf: 'flex-start' },
  backTxt:   { fontSize: 15, color: C.terra, fontWeight: '700' },
  eyebrow:   { fontSize: 10, letterSpacing: 1.2, textTransform: 'uppercase', color: C.muted, marginBottom: 6, fontWeight: '500' },
  pageTitle: { fontSize: 34, fontWeight: '800', color: C.title, letterSpacing: -0.6, lineHeight: 38 },
  pageSub:   { fontSize: 14, color: C.muted, marginTop: 6 },

  emptyCard:  { marginHorizontal: 20, marginTop: 8, backgroundColor: C.card, borderRadius: 22, borderWidth: 1, borderColor: C.border, padding: 32, alignItems: 'center' },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: C.text, marginBottom: 8 },
  emptyTxt:   { fontSize: 14, color: C.muted, textAlign: 'center', lineHeight: 20 },

  card:    { marginHorizontal: 20, backgroundColor: C.card, borderRadius: 22, borderWidth: 1, borderColor: C.border, padding: 18, shadowColor: C.shadow, shadowOpacity: 0.05, shadowOffset: { width: 0, height: 4 }, shadowRadius: 12, elevation: 2 },
  cardMb:  { marginBottom: 12 },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 14 },
  cardPoste: { fontSize: 17, fontWeight: '800', color: C.title, letterSpacing: -0.3, marginBottom: 3 },
  cardMeta:  { fontSize: 12, color: C.muted },

  badge:    { borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5, marginLeft: 8 },
  badgeTxt: { fontSize: 11, fontWeight: '700' },

  infoRow:    { flexDirection: 'row', gap: 10, marginBottom: 14 },
  infoCard:   { flex: 1, backgroundColor: C.cardWarm, borderRadius: 14, borderWidth: 1, borderColor: C.borderSoft, paddingHorizontal: 12, paddingVertical: 10 },
  infoLabel:  { fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6, color: C.muted, marginBottom: 4 },
  infoValue:  { fontSize: 13, fontWeight: '700', color: C.text },

  serveurRow:      { flexDirection: 'row', alignItems: 'center', backgroundColor: C.cardWarm, borderRadius: 14, borderWidth: 1, borderColor: C.borderSoft, padding: 12, marginBottom: 12 },
  serveurAvatar:   { width: 36, height: 36, borderRadius: 18, backgroundColor: C.cardSoft, alignItems: 'center', justifyContent: 'center', marginRight: 10, borderWidth: 1, borderColor: C.border },
  serveurAvatarTxt:{ fontSize: 11, fontWeight: '700', color: C.title },
  serveurLabel:    { fontSize: 10, fontWeight: '700', color: C.muted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 },
  serveurNom:      { fontSize: 14, fontWeight: '700', color: C.text },

  noteRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  noteLbl: { fontSize: 12, color: C.muted, fontWeight: '600' },

  evalBtn:    { backgroundColor: C.amberBg, borderWidth: 1, borderColor: C.amberBd, borderRadius: 14, paddingVertical: 13, alignItems: 'center', marginTop: 4 },
  evalBtnTxt: { fontSize: 14, fontWeight: '700', color: C.amber },
})
