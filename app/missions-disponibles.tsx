import { useFocusEffect, useRouter } from 'expo-router'
import React, { useCallback, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { EURO } from '../lib/currency'
import { DISTANCE_FILTERS_KM } from '../lib/location-distance'
import { getNearbyOffresForServeur, OffreProche } from '../lib/offres'
import { getServerBusySlotMessage, isServerAvailable } from '../lib/server-availability'
import { detectMissionSlot } from '../lib/serveur-disponibilites'
import { supabase } from '../lib/supabase'

interface Patron {
  id: string
  nom_restaurant: string
  ville: string
}

interface EtablissementLabel {
  id: string
  nom: string
  ville: string
}

function netEstime(salaireBrut: number): number {
  return Math.round(salaireBrut * 0.75)
}

function posteBadge(poste: string): string {
  const p = poste.toLowerCase().trim()
  if (p.includes('bar')) return 'BA'
  if (p.includes('chef') || p.includes('rang')) return 'CR'
  if (p.includes('event') || p.includes('cocktail')) return 'EV'
  if (p.includes('runner')) return 'RU'
  if (p.includes('serveur')) return 'SE'
  return 'EX'
}

function formatDateFr(date: string): string {
  try {
    return new Date(date).toLocaleDateString('fr-FR', {
      day: 'numeric',
      month: 'short',
    })
  } catch {
    return date
  }
}

const C = {
  bg: '#F7F4EE',
  card: '#FFFFFF',
  cardSoft: '#F4EFE7',
  border: '#E6DED2',
  borderSoft: '#EFE7DB',
  title: '#171614',
  text: '#2A2723',
  textSoft: '#6D675E',
  textMuted: '#9A9388',
  terra: '#C46A3C',
  terraBg: '#FEF3EB',
  terraBd: '#F5C9A9',
  green: '#2E8B57',
  greenBg: '#F0F8F3',
  greenBd: '#C0DEC8',
}

export default function MissionsDisponibles() {
  const router = useRouter()

  const [annonces, setAnnonces] = useState<OffreProche[]>([])
  const [patrons, setPatrons] = useState<{ [key: string]: Patron }>({})
  const [etablissements, setEtablissements] = useState<{ [key: string]: EtablissementLabel }>({})
  const [dejaPostule, setDejaPostule] = useState<Set<string>>(new Set())
  const [offresRecuesIds, setOffresRecuesIds] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [postulating, setPostulating] = useState<string | null>(null)
  const [serveurId, setServeurId] = useState<string | null>(null)
  const [rayon, setRayon] = useState(20)

  const fetchData = useCallback(
    async (rayonOverride?: number) => {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser()

        if (!user) {
          router.replace('/')
          return
        }

        const { data: srv } = await supabase
          .from('serveurs')
          .select('id, rayon')
          .eq('id', user.id)
          .single()

        if (!srv) {
          router.replace('/')
          return
        }

        setServeurId(srv.id)

        const rayonActif = rayonOverride ?? rayon ?? srv.rayon ?? 50
        const nearby = await getNearbyOffresForServeur(user.id, rayonActif, 100)
        setAnnonces(nearby)

        const patronIds = [...new Set(nearby.map((a) => a.patron_id).filter(Boolean))]
        const etablissementIds = [...new Set(nearby.map((a) => a.etablissement_id).filter(Boolean))]
        if (patronIds.length > 0) {
          const { data: patronsData } = await supabase
            .from('patrons')
            .select('id, nom_restaurant, ville')
            .in('id', patronIds)

          const map: { [key: string]: Patron } = {}
          ;(patronsData ?? []).forEach((p: any) => {
            map[p.id] = p
          })
          setPatrons(map)
        } else {
          setPatrons({})
        }

        if (etablissementIds.length > 0) {
          const { data: etabData } = await supabase
            .from('etablissements')
            .select('id, nom, ville')
            .in('id', etablissementIds)

          const map: { [key: string]: EtablissementLabel } = {}
          ;(etabData ?? []).forEach((e: any) => {
            map[e.id] = e
          })
          setEtablissements(map)
        } else {
          setEtablissements({})
        }

        const { data: demandes } = await supabase
          .from('demandes')
          .select('annonce_id, initiateur, statut')
          .eq('serveur_id', user.id)
          .in('statut', ['en_attente', 'acceptee'])

        if (demandes) {
          setDejaPostule(
            new Set(
              demandes
                .filter((d: any) => d.initiateur === 'serveur')
                .map((d: any) => d.annonce_id)
            )
          )
          setOffresRecuesIds(
            new Set(
              demandes
                .filter((d: any) => d.initiateur === 'patron')
                .map((d: any) => d.annonce_id)
            )
          )
        } else {
          setDejaPostule(new Set())
          setOffresRecuesIds(new Set())
        }
      } catch (e) {
        console.error('fetchData error:', e)
      }
    },
    [router, rayon]
  )

  useFocusEffect(
    useCallback(() => {
      fetchData().finally(() => setLoading(false))
    }, [fetchData])
  )

  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    await fetchData()
    setRefreshing(false)
  }, [fetchData])

  const handleRayonChange = async (newRayon: number) => {
    setRayon(newRayon)
    await fetchData(newRayon)
  }

  const postuler = async (annonceId: string) => {
    if (!serveurId || postulating) return
    setPostulating(annonceId)

    try {
      const { data: existing } = await supabase
        .from('demandes')
        .select('id, initiateur, statut')
        .eq('annonce_id', annonceId)
        .eq('serveur_id', serveurId)
        .in('statut', ['en_attente', 'acceptee'])
        .maybeSingle()

      if (existing) {
        if (existing.initiateur === 'patron') {
          setOffresRecuesIds((prev) => new Set([...prev, annonceId]))
          Alert.alert('Info', 'Une proposition attend deja votre reponse pour cette mission.')
        } else {
          setDejaPostule((prev) => new Set([...prev, annonceId]))
          Alert.alert('Info', 'Votre interet est deja enregistre pour cette mission.')
        }
        return
      }

      const annonce = annonces.find((item) => item.id === annonceId)
      if (annonce) {
        const stillAvailable = await isServerAvailable(
          serveurId,
          annonce.date,
          detectMissionSlot(annonce.heure_debut, annonce.heure_fin),
          {
          heureDebut: annonce.heure_debut,
          heureFin: annonce.heure_fin,
          }
        )

        if (!stillAvailable) {
          Alert.alert('Info', getServerBusySlotMessage(detectMissionSlot(annonce.heure_debut, annonce.heure_fin), 'self'))
          return
        }
      }

      const { error } = await supabase.from('demandes').insert({
        annonce_id: annonceId,
        serveur_id: serveurId,
        statut: 'en_attente',
        initiateur: 'serveur',
      })

      if (error) {
        Alert.alert('Erreur', "Impossible d'envoyer votre interet")
        return
      }

      setDejaPostule((prev) => new Set([...prev, annonceId]))
      Alert.alert('Interet envoye', "L'etablissement a bien recu votre disponibilite.")
    } catch (e) {
      console.error('postuler error:', e)
      Alert.alert('Erreur', "Impossible d'envoyer votre interet")
    } finally {
      setPostulating(null)
    }
  }

  if (loading) {
    return (
      <View style={s.loadWrap}>
        <ActivityIndicator size="large" color={C.green} />
      </View>
    )
  }

  return (
    <View style={s.screen}>
      <StatusBar barStyle="dark-content" backgroundColor={C.bg} />

      <ScrollView
        style={s.scroll}
        contentContainerStyle={s.content}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.green} />}
      >
        <View style={s.header}>
          <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
            <Text style={s.backTxt}>Retour</Text>
          </TouchableOpacity>

          <View style={s.headerRow}>
            <View>
              <Text style={s.eyebrow}>MISSIONS OUVERTES</Text>
              <Text style={s.title}>Missions{'\n'}pres de vous</Text>
            </View>

            <View style={s.countBadge}>
              <Text style={s.countNum}>{annonces.length}</Text>
              <Text style={s.countLabel}>missions</Text>
            </View>
          </View>
        </View>

        <View style={s.rayonRow}>
          {DISTANCE_FILTERS_KM.map((r) => (
            <TouchableOpacity
              key={r}
              style={[s.rayonBtn, rayon === r && s.rayonBtnActive]}
              onPress={() => handleRayonChange(r)}
              activeOpacity={0.7}
            >
              <Text style={[s.rayonTxt, rayon === r && s.rayonTxtActive]}>{r} km</Text>
            </TouchableOpacity>
          ))}
        </View>

        {annonces.length === 0 ? (
          <View style={s.emptyCard}>
            <Text style={s.emptyEmoji}>Infos</Text>
            <Text style={s.emptyTitle}>Aucune mission ouverte</Text>
            <Text style={s.emptySub}>Revenez plus tard ou elargissez votre rayon dans votre profil</Text>
          </View>
        ) : (
          annonces.map((annonce, i) => {
            const patron = patrons[annonce.patron_id]
            const etablissement = annonce.etablissement_id ? etablissements[annonce.etablissement_id] : null
            const postule = dejaPostule.has(annonce.id)
            const offreRecue = offresRecuesIds.has(annonce.id)
            const isLoading = postulating === annonce.id
            const avatarBadge = posteBadge(annonce.poste).slice(0, 2)

            return (
              <View key={annonce.id} style={[s.card, i < annonces.length - 1 && s.cardMb, postule && s.cardPostule]}>
                <View style={s.cardTop}>
                  <View style={s.cardIconWrap}>
                    <Text
                      style={s.cardIconTxt}
                      numberOfLines={1}
                      adjustsFontSizeToFit
                      minimumFontScale={0.8}
                    >
                      {avatarBadge}
                    </Text>
                  </View>

                  <View style={{ flex: 1 }}>
                    <Text style={s.cardPoste}>{annonce.poste}</Text>
                    {(etablissement || patron) && (
                      <Text style={s.cardResto}>{etablissement?.nom ?? patron?.nom_restaurant}</Text>
                    )}
                  </View>

                  <Text style={s.cardDist}>{Math.round(annonce.distanceKm)} km</Text>
                </View>

                <View style={s.tagsRow}>
                  <View style={s.tag}>
                    <Text style={s.tagTxt}>Date {formatDateFr(annonce.date)}</Text>
                  </View>
                  <View style={s.tag}>
                    <Text style={s.tagTxt}>
                      Heure {annonce.heure_debut} - {annonce.heure_fin}
                    </Text>
                  </View>
                  <View style={s.tag}>
                    <Text style={s.tagTxt}>Lieu {annonce.ville}</Text>
                  </View>
                </View>

                <View style={s.salaireRow}>
                  <Text style={s.salaireVal}>{`~ ${netEstime(annonce.salaire)}${EURO}`}</Text>
                  <Text style={s.salaireLbl}> / h net</Text>
                </View>
                <Text style={s.salaireHint}>(estime apres charges)</Text>

                {annonce.description ? (
                  <Text style={s.description} numberOfLines={2}>
                    {annonce.description}
                  </Text>
                ) : null}

                {offreRecue ? (
                  <View style={s.btnPostule}>
                    <Text style={s.btnPostuleTxt}>En attente de votre reponse</Text>
                  </View>
                ) : postule ? (
                  <View style={s.btnPostule}>
                    <Text style={s.btnPostuleTxt}>✔ Interet envoye</Text>
                  </View>
                ) : (
                  <TouchableOpacity
                    style={[s.btnPostuler, isLoading && s.btnDisabled]}
                    onPress={() => postuler(annonce.id)}
                    disabled={isLoading}
                    activeOpacity={0.85}
                  >
                    <Text style={s.btnPostulerTxt}>{isLoading ? 'Envoi...' : 'Je suis interesse'}</Text>
                  </TouchableOpacity>
                )}
              </View>
            )
          })
        )}
      </ScrollView>
    </View>
  )
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  loadWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: C.bg },
  scroll: { flex: 1 },
  content: { paddingBottom: 48 },

  header: { paddingTop: 56, paddingHorizontal: 22, paddingBottom: 8 },
  backBtn: { marginBottom: 16 },
  backTxt: { fontSize: 15, color: C.terra, fontWeight: '600' },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingBottom: 20,
  },
  eyebrow: {
    fontSize: 10,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: C.textMuted,
    marginBottom: 6,
    fontWeight: '500',
  },
  title: {
    fontSize: 34,
    fontWeight: '800',
    color: C.title,
    letterSpacing: -0.6,
    lineHeight: 38,
  },
  countBadge: {
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 8,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowOffset: { width: 0, height: 1 },
    shadowRadius: 4,
    elevation: 1,
  },
  countNum: {
    fontSize: 28,
    fontWeight: '800',
    color: C.terra,
    letterSpacing: -1,
  },
  countLabel: {
    fontSize: 11,
    color: C.textMuted,
    marginTop: 2,
  },

  rayonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    marginBottom: 20,
  },
  rayonBtn: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 99,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.card,
    marginRight: 8,
  },
  rayonBtnActive: {
    backgroundColor: C.terraBg,
    borderColor: C.terraBd,
  },
  rayonTxt: {
    fontSize: 13,
    color: C.textMuted,
    fontWeight: '500',
  },
  rayonTxtActive: {
    color: C.terra,
  },

  emptyCard: {
    marginHorizontal: 16,
    backgroundColor: C.card,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: C.border,
    padding: 40,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 8,
    elevation: 1,
  },
  emptyEmoji: { fontSize: 28, marginBottom: 12 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: C.title, marginBottom: 6 },
  emptySub: { fontSize: 13, color: C.textMuted, textAlign: 'center', lineHeight: 18 },

  card: {
    marginHorizontal: 16,
    backgroundColor: C.card,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: C.border,
    padding: 18,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 8,
    elevation: 1,
  },
  cardMb: { marginBottom: 12 },
  cardPostule: { borderColor: C.greenBd, backgroundColor: '#FAFDF8' },

  cardTop: { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  cardIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: C.cardSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
    overflow: 'hidden',
  },
  cardIconTxt: {
    fontSize: 18,
    fontWeight: '800',
    color: C.textSoft,
    width: '100%',
    textAlign: 'center',
    lineHeight: 20,
  },
  cardPoste: {
    fontSize: 17,
    fontWeight: '700',
    color: C.title,
    letterSpacing: -0.2,
  },
  cardResto: {
    fontSize: 12,
    color: C.textMuted,
    marginTop: 3,
  },
  cardDist: {
    fontSize: 12,
    color: C.textMuted,
    flexShrink: 0,
  },

  tagsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 14 },
  tag: {
    backgroundColor: C.cardSoft,
    borderWidth: 1,
    borderColor: C.borderSoft,
    borderRadius: 99,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  tagTxt: { fontSize: 12, color: C.textSoft, fontWeight: '500' },

  salaireRow: { flexDirection: 'row', alignItems: 'baseline', marginBottom: 12 },
  salaireVal: { fontSize: 28, fontWeight: '800', color: C.title, letterSpacing: -0.8 },
  salaireLbl: { fontSize: 13, color: C.textMuted },
  salaireHint: { fontSize: 11, color: C.textMuted, marginBottom: 12, fontWeight: '500' },

  description: { fontSize: 13, color: C.textSoft, lineHeight: 18, marginBottom: 14 },

  btnPostuler: {
    backgroundColor: '#C56B3D',
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
    shadowColor: '#C56B3D',
    shadowOpacity: 0.2,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 10,
    elevation: 2,
  },
  btnDisabled: { opacity: 0.6, shadowOpacity: 0 },
  btnPostulerTxt: { fontSize: 15, fontWeight: '700', color: '#fff' },

  btnPostule: {
    backgroundColor: '#E8DED0',
    borderWidth: 1,
    borderColor: '#D6C6B2',
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
  },
  btnPostuleTxt: {
    fontSize: 14,
    fontWeight: '700',
    color: '#3B312B',
  },
})
