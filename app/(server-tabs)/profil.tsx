import { useFocusEffect, useRouter } from 'expo-router'
import { useCallback, useState } from 'react'
import { Alert, Image, ScrollView, StatusBar, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { formatServeurExperience, type ServeurExperience } from '../../lib/serveur-experiences'
import { fetchServeurExperiences } from '../../lib/serveur-experiences-api'
import { computeServeurMissionStatsFromAnnonces } from '../../lib/serveur-stats'
import { supabase } from '../../lib/supabase'

const C = {
  bg: '#F7F4EE',
  card: '#FFFFFF',
  cardSoft: '#F4EFE7',
  border: '#E6DED2',
  borderSoft: '#EFE7DB',
  title: '#171614',
  textSoft: '#6D675E',
  textMuted: '#9A9388',
  accent: '#2E8B57',
  terra: '#C46A3C',
  amber: '#B8893C',
  red: '#C84B4B',
}

export default function ProfilServeurScreen() {
  const router = useRouter()
  const [serveur, setServeur] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [experiences, setExperiences] = useState<ServeurExperience[]>([])

  const chargerProfil = async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return

    const { data, error } = await supabase.from('serveurs').select('*').eq('id', user.id).single()
    if (!error && data) {
      const stats = await computeServeurMissionStatsFromAnnonces(data.id)
      setServeur({
        ...data,
        missions_realisees: stats.completedMissions,
        missions_annulees: stats.noShowMissions,
      })
      const nextExp = await fetchServeurExperiences(data.id)
      setExperiences(nextExp)
    }

    setLoading(false)
  }

  useFocusEffect(
    useCallback(() => {
      chargerProfil()
    }, [])
  )

  const handleDeconnexion = async () => {
    Alert.alert('Se deconnecter', 'Voulez-vous vous deconnecter ?', [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Se deconnecter',
        style: 'destructive',
        onPress: async () => {
          await supabase.auth.signOut()
          router.replace('/')
        },
      },
    ])
  }

  if (loading) {
    return (
      <View style={s.loading}>
        <Text>Chargement...</Text>
      </View>
    )
  }

  const initiales = `${serveur?.prenom?.[0] ?? ''}${serveur?.nom?.[0] ?? ''}`.toUpperCase()
  const totalPresence = (serveur?.missions_realisees ?? 0) + (serveur?.missions_annulees ?? 0)
  const tauxPresence =
    totalPresence > 0
      ? Math.min(100, Math.round((serveur.missions_realisees / totalPresence) * 100))
      : 100

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.content}>
      <StatusBar barStyle="dark-content" backgroundColor={C.bg} />

      <View style={s.header}>
        {serveur?.photo_url ? (
          <Image source={{ uri: serveur.photo_url }} style={s.photo} />
        ) : (
          <View style={s.avatar}>
            <Text style={s.avatarText}>{initiales}</Text>
          </View>
        )}
        <Text style={s.nom}>
          {serveur?.prenom} {serveur?.nom}
        </Text>
        <Text style={s.ville}>{serveur?.ville}</Text>

        <View style={s.statsRow}>
          <View style={s.stat}>
            <Text style={[s.statNum, { color: C.accent }]}>{serveur?.missions_realisees || 0}</Text>
            <Text style={s.statLbl}>Missions</Text>
          </View>
          <View style={s.statDiv} />
          <View style={s.stat}>
            <Text style={[s.statNum, { color: C.amber }]}>
              {serveur?.score ? Number(serveur.score).toFixed(1) : '-'}
            </Text>
            <Text style={s.statLbl}>Note</Text>
          </View>
          <View style={s.statDiv} />
          <View style={s.stat}>
            <Text style={[s.statNum, { color: tauxPresence >= 80 ? C.accent : C.red }]}>
              {tauxPresence}%
            </Text>
            <Text style={s.statLbl}>Presence</Text>
          </View>
        </View>
      </View>

      <View style={s.card}>
        <Text style={s.sectionOverline}>PROFIL</Text>
        <Text style={s.cardTitle}>Ma presentation</Text>
        <Text style={s.bioText}>
          {serveur?.description?.trim()
            ? serveur.description
            : 'Ajoutez une courte presentation pour aider les patrons a mieux vous choisir.'}
        </Text>
      </View>

      <View style={s.card}>
        <View style={s.cardRowHeader}>
          <Text style={s.cardTitle}>Mes experiences</Text>
          <TouchableOpacity onPress={() => router.push('/modifier-profil-serveur')} activeOpacity={0.75}>
            <Text style={s.cardLink}>Modifier</Text>
          </TouchableOpacity>
        </View>

        {experiences.length > 0 ? (
          <View style={s.expList}>
            {experiences.map((item, i) => (
              <View key={`exp-${i}`} style={s.expItem}>
                <Text style={s.expTxt}>{formatServeurExperience(item)}</Text>
              </View>
            ))}
          </View>
        ) : (
          <Text style={s.emptyTxt}>
            Aucune experience renseignee. Ajoutez-en pour rassurer les patrons.
          </Text>
        )}
      </View>

      <View style={s.card}>
        <Text style={s.cardTitle}>Mes coordonnees</Text>
        <Text style={s.infoTxt}>{serveur?.email}</Text>
        <Text style={s.infoTxt}>{serveur?.telephone}</Text>
        <Text style={s.infoTxt}>Rayon : {serveur?.rayon ?? 20} km</Text>
      </View>

      <TouchableOpacity
        style={s.editBtn}
        onPress={() => router.push('/modifier-profil-serveur')}
        activeOpacity={0.85}
      >
        <Text style={s.editBtnTxt}>Modifier mon profil</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={s.referralCard}
        onPress={() => router.push('/parrainage')}
        activeOpacity={0.85}
      >
        <View style={s.referralIcon}>
          <Text style={s.referralIconText}>P</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={s.referralTitle}>Parrainage</Text>
          <Text style={s.referralSub}>Invitez vos amis et gagnez jusqu&apos;a 20 EUR</Text>
        </View>
        <Text style={s.referralArrow}>&gt;</Text>
      </TouchableOpacity>

      <TouchableOpacity style={s.logoutBtn} onPress={handleDeconnexion} activeOpacity={0.7}>
        <Text style={s.logoutTxt}>Se deconnecter</Text>
      </TouchableOpacity>
    </ScrollView>
  )
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  content: { paddingBottom: 120 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    backgroundColor: '#1D9E75',
    paddingTop: 60,
    paddingBottom: 26,
    paddingHorizontal: 24,
    alignItems: 'center',
  },
  avatar: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: 'rgba(255,255,255,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  photo: {
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.35)',
    marginBottom: 12,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  avatarText: { fontSize: 26, fontWeight: '800', color: '#fff' },
  nom: { fontSize: 22, fontWeight: '800', color: '#fff', marginBottom: 4 },
  ville: { fontSize: 13, color: 'rgba(255,255,255,0.8)', marginBottom: 16 },
  statsRow: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 20,
    alignItems: 'center',
  },
  stat: { flex: 1, alignItems: 'center' },
  statDiv: { width: 1, height: 28, backgroundColor: 'rgba(255,255,255,0.3)' },
  statNum: { fontSize: 22, fontWeight: '800', marginBottom: 2 },
  statLbl: { fontSize: 11, color: 'rgba(255,255,255,0.75)' },
  card: {
    backgroundColor: C.card,
    margin: 16,
    marginBottom: 0,
    padding: 16,
    borderRadius: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  sectionOverline: {
    fontSize: 10,
    color: C.textMuted,
    fontWeight: '800',
    letterSpacing: 1,
    marginBottom: 10,
  },
  cardTitle: { fontSize: 16, fontWeight: '700', color: C.title, marginBottom: 10 },
  bioText: { fontSize: 14, color: C.textSoft, lineHeight: 21 },
  cardRowHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  cardLink: { fontSize: 13, color: C.terra, fontWeight: '700' },
  expList: { gap: 8 },
  expItem: {
    backgroundColor: C.cardSoft,
    borderWidth: 1,
    borderColor: C.borderSoft,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  expTxt: { fontSize: 13, lineHeight: 18, color: C.title, fontWeight: '600' },
  emptyTxt: { fontSize: 13, color: C.textSoft, lineHeight: 19 },
  infoTxt: { fontSize: 14, color: C.textSoft, marginBottom: 6 },
  editBtn: {
    margin: 16,
    marginBottom: 0,
    padding: 15,
    borderRadius: 14,
    alignItems: 'center',
    backgroundColor: C.accent,
  },
  editBtnTxt: { fontSize: 15, color: '#fff', fontWeight: '700' },
  referralCard: {
    backgroundColor: '#FFF8F1',
    margin: 16,
    marginBottom: 0,
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E8CBB2',
    flexDirection: 'row',
    alignItems: 'center',
  },
  referralIcon: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: '#F4E2D4',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  referralIconText: { fontSize: 16, fontWeight: '800', color: C.terra },
  referralTitle: { fontSize: 15, fontWeight: '700', color: C.title, marginBottom: 3 },
  referralSub: { fontSize: 12, color: C.textSoft },
  referralArrow: { fontSize: 22, color: C.terra, marginLeft: 8, fontWeight: '800' },
  logoutBtn: {
    margin: 16,
    marginTop: 12,
    padding: 15,
    borderRadius: 14,
    alignItems: 'center',
    backgroundColor: C.card,
    borderWidth: 1.5,
    borderColor: C.red,
    marginBottom: 8,
  },
  logoutTxt: { fontSize: 15, color: C.red, fontWeight: '600' },
})
