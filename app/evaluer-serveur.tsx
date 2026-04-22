import { useLocalSearchParams, useRouter } from 'expo-router'
import { useState } from 'react'
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { saveEvaluation } from '../lib/evaluations'
import { supabase } from '../lib/supabase'

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
  muted: '#B0A89C',
}

const NOTE_LABELS: { [key: number]: string } = {
  0: 'Appuyez sur une étoile',
  1: 'Très décevant',
  2: 'Décevant',
  3: 'Correct',
  4: 'Bien',
  5: 'Excellent !',
}

function StarRating({ note, onSelect }: { note: number; onSelect: (n: number) => void }) {
  return (
    <View style={s.starsRow}>
      {[1, 2, 3, 4, 5].map((n) => (
        <TouchableOpacity
          key={n}
          onPress={() => onSelect(n)}
          activeOpacity={0.7}
          style={s.starBtn}
        >
          <View style={[s.star, note >= n && s.starActive]}>
            <View style={[s.starInner, note >= n && s.starInnerActive]} />
          </View>
        </TouchableOpacity>
      ))}
    </View>
  )
}

export default function EvaluerServeur() {
  const router = useRouter()
  const { annonceId, serveurId, serveurNom } = useLocalSearchParams()
  const [note, setNote] = useState(0)
  const [loading, setLoading] = useState(false)

  const handleEvaluer = async () => {
    if (note === 0) {
      Alert.alert('Erreur', 'Veuillez choisir une note')
      return
    }
    setLoading(true)
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user || typeof annonceId !== 'string' || typeof serveurId !== 'string') {
        Alert.alert('Erreur', "Impossible d'enregistrer cette évaluation.")
        return
      }

      console.log('handleEvaluer payload', {
        mission_id: annonceId,
        serveur_id: serveurId,
        patron_id: user.id,
        note,
      })

      await saveEvaluation({
        serveurId,
        missionId: annonceId,
        patronId: user.id,
        note,
        commentaire: null,
      })

      const { error: annonceError } = await supabase.from('annonces').update({ note }).eq('id', annonceId)
      if (annonceError) {
        console.log('handleEvaluer annonce update error', annonceError)
        throw annonceError
      }

      Alert.alert('Merci !', 'Votre évaluation a été enregistrée.', [
        { text: 'OK', onPress: () => router.replace('/dashboard_patron') },
      ])
    } catch (error) {
      console.log('handleEvaluer full error', error)
      Alert.alert('Erreur', "Impossible d'enregistrer cette évaluation.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
      <TouchableOpacity style={s.backBtn} onPress={() => router.back()}>
        <Text style={s.backTxt}>Retour</Text>
      </TouchableOpacity>

      <Text style={s.eyebrow}>EVALUATION</Text>
      <Text style={s.title}>Évaluer le serveur</Text>
      <Text style={s.subtitle}>Comment s&apos;est passée la mission avec {serveurNom} ?</Text>

      <View style={s.ratingCard}>
        <StarRating note={note} onSelect={setNote} />
        <Text style={s.noteLabel}>{NOTE_LABELS[note]}</Text>
      </View>

      <View style={s.criteresCard}>
        <Text style={s.criteresTitle}>Ce que vous évaluez</Text>
        {['Ponctualité', 'Qualité du service', 'Professionnalisme', 'Communication'].map((c) => (
          <View key={c} style={s.critereRow}>
            <View style={s.critereDot} />
            <Text style={s.critere}>{c}</Text>
          </View>
        ))}
      </View>

      <TouchableOpacity
        style={[s.btn, (loading || note === 0) && s.btnDisabled]}
        onPress={handleEvaluer}
        disabled={loading || note === 0}
        activeOpacity={0.85}
      >
        <Text style={s.btnTxt}>{loading ? 'Envoi...' : 'Valider la note'}</Text>
      </TouchableOpacity>

      <TouchableOpacity style={s.laterBtn} onPress={() => router.replace('/dashboard_patron')} activeOpacity={0.7}>
        <Text style={s.laterTxt}>Noter plus tard</Text>
      </TouchableOpacity>
    </ScrollView>
  )
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  content: { paddingHorizontal: 22, paddingTop: 56, paddingBottom: 48 },

  backBtn: { marginBottom: 24 },
  backTxt: { fontSize: 15, color: C.terra, fontWeight: '600' },

  eyebrow: { fontSize: 10, letterSpacing: 1.2, textTransform: 'uppercase', color: C.muted, fontWeight: '500', marginBottom: 8 },
  title: { fontSize: 28, fontWeight: '800', color: C.title, letterSpacing: -0.5, marginBottom: 6 },
  subtitle: { fontSize: 14, color: C.textMuted, lineHeight: 20, marginBottom: 28 },

  ratingCard: {
    backgroundColor: C.card,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: C.border,
    padding: 24,
    alignItems: 'center',
    marginBottom: 14,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 8,
    elevation: 1,
  },
  starsRow: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  starBtn: { padding: 4 },
  star: { width: 48, height: 48, borderRadius: 14, backgroundColor: C.cardSoft, borderWidth: 1.5, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  starActive: { backgroundColor: C.terraBg, borderColor: C.terraBd },
  starInner: { width: 18, height: 18, borderRadius: 9, backgroundColor: C.muted },
  starInnerActive: { backgroundColor: C.terra },
  noteLabel: { fontSize: 17, fontWeight: '700', color: C.title },

  criteresCard: {
    backgroundColor: C.card,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: C.border,
    padding: 18,
    marginBottom: 14,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowOffset: { width: 0, height: 1 },
    shadowRadius: 4,
    elevation: 1,
  },
  criteresTitle: { fontSize: 13, fontWeight: '700', color: C.title, marginBottom: 12 },
  critereRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  critereDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.terra, marginRight: 10 },
  critere: { fontSize: 13, color: C.textSoft },

  btn: {
    backgroundColor: C.terra,
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
    marginBottom: 12,
    shadowColor: C.terra,
    shadowOpacity: 0.2,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 10,
    elevation: 2,
  },
  btnDisabled: { backgroundColor: C.muted, shadowOpacity: 0, elevation: 0 },
  btnTxt: { fontSize: 16, fontWeight: '800', color: '#fff', letterSpacing: -0.2 },

  laterBtn: { alignItems: 'center', paddingVertical: 12 },
  laterTxt: { fontSize: 14, color: C.textMuted, fontWeight: '500' },
})
