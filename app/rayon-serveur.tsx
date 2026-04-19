import { supabase } from '@/lib/supabase'
import Slider from '@react-native-community/slider'
import { useRouter } from 'expo-router'
import React, { useEffect, useState } from 'react'
import { ActivityIndicator, Alert, SafeAreaView, StyleSheet, Text, TouchableOpacity, View } from 'react-native'

export default function RayonServeur() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [rayon, setRayon] = useState(50)

  useEffect(() => {
    const loadRayon = async () => {
      const { data: { user } } = await supabase.auth.getUser()

      if (!user) {
        router.replace('/')
        return
      }

      const { data, error } = await supabase
        .from('serveurs')
        .select('rayon')
        .eq('id', user.id)
        .single()

      if (!error && data?.rayon) {
        setRayon(data.rayon)
      }

      setLoading(false)
    }

    loadRayon()
  }, [router])

  const handleSave = async () => {
    try {
      setSaving(true)

      const { data: { user } } = await supabase.auth.getUser()

      if (!user) {
        router.replace('/')
        return
      }

      const { error } = await supabase
        .from('serveurs')
        .update({ rayon })
        .eq('id', user.id)

      if (error) throw error

      Alert.alert('Parfait', 'Rayon mis à jour')
      router.back()
    } catch {
      Alert.alert('Erreur', 'Impossible de mettre à jour le rayon')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator size="large" color="#2E8B57" />
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.box}>
        <Text style={styles.title}>Ajuster mon rayon</Text>
        <Text style={styles.subtitle}>Choisissez la distance maximale pour voir les missions autour de vous.</Text>

        <Text style={styles.value}>{rayon} km</Text>

        <Slider
          style={{ width: '100%', height: 40 }}
          minimumValue={10}
          maximumValue={100}
          step={10}
          value={rayon}
          onValueChange={setRayon}
          minimumTrackTintColor="#2E8B57"
          maximumTrackTintColor="#D9D9D9"
          thumbTintColor="#2E8B57"
        />

        <TouchableOpacity style={styles.button} onPress={handleSave} disabled={saving}>
          <Text style={styles.buttonText}>
            {saving ? 'Enregistrement...' : 'Enregistrer'}
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F7F4EE',
    justifyContent: 'center',
    padding: 20,
  },
  box: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 20,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: '#171614',
    marginBottom: 10,
  },
  subtitle: {
    fontSize: 16,
    color: '#6D675E',
    marginBottom: 20,
    lineHeight: 22,
  },
  value: {
    fontSize: 36,
    fontWeight: '800',
    color: '#2E8B57',
    textAlign: 'center',
    marginBottom: 20,
  },
  button: {
    backgroundColor: '#2E8B57',
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
    marginTop: 20,
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
})
