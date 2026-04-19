import { useFocusEffect, useRouter } from 'expo-router'
import React, { useCallback, useState } from 'react'
import { Alert, ScrollView, Share, StatusBar, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { EURO } from '../lib/currency'
import { buildReferralCode, fetchReferralOverview } from '../lib/referrals'
import { supabase } from '../lib/supabase'

type FilleulProgress = {
  id: string
  prenom: string
  nom: string
  missionsRealisees: number
  progressLabel: string
  totalEarned: number
  rewards: { milestone: number; reward_amount: number; rewarded_at: string | null }[]
}

const REWARD_STEPS = [
  { milestone: 1, amount: 5 },
  { milestone: 3, amount: 5 },
  { milestone: 5, amount: 10 },
] as const

function getNextReferralReward(missionsRealisees: number) {
  return REWARD_STEPS.find((step) => missionsRealisees < step.milestone) ?? null
}

function getRemainingMissionsText(missionsRealisees: number, nextMilestone: number) {
  const remaining = Math.max(nextMilestone - missionsRealisees, 0)
  return remaining <= 1
    ? `Plus que ${remaining} mission pour debloquer le prochain bonus`
    : `Plus que ${remaining} missions pour debloquer le prochain bonus`
}

function getStepState(filleul: FilleulProgress, milestone: number) {
  return filleul.rewards.some((reward) => reward.milestone === milestone)
}

const C = {
  bg: '#F7F4EE',
  card: '#FFFFFF',
  cardSoft: '#FCF8F2',
  border: '#E8DED1',
  borderSoft: '#F1E8DD',
  title: '#171614',
  text: '#2A2723',
  textSoft: '#6D675E',
  textMuted: '#9A9388',
  terra: '#C46A3C',
  terraDark: '#9F542D',
  terraBg: '#FEF3EB',
  terraBd: '#F5C9A9',
  green: '#2E8B57',
  greenBg: '#F0F8F3',
  greenBd: '#C0DEC8',
  shadow: '#2B2118',
}

export default function ParrainageScreen() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [referralCode, setReferralCode] = useState('')
  const [referredCount, setReferredCount] = useState(0)
  const [totalEarned, setTotalEarned] = useState(0)
  const [filleuls, setFilleuls] = useState<FilleulProgress[]>([])

  const loadData = useCallback(async () => {
    setLoading(true)

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      router.replace('/')
      return
    }

    const { data: serveurData } = await supabase
      .from('serveurs')
      .select('prenom, referral_code')
      .eq('id', user.id)
      .maybeSingle()

    let nextReferralCode = String(serveurData?.referral_code ?? '')
    if (!nextReferralCode) {
      nextReferralCode = buildReferralCode(String(serveurData?.prenom ?? ''), user.id)
      await supabase
        .from('serveurs')
        .update({ referral_code: nextReferralCode })
        .eq('id', user.id)
    }

    const overview = await fetchReferralOverview(user.id)

    setReferralCode(nextReferralCode)
    setReferredCount(overview.referredCount)
    setTotalEarned(overview.totalEarned)
    setFilleuls(overview.filleuls)
    setLoading(false)
  }, [router])

  useFocusEffect(
    useCallback(() => {
      loadData()
    }, [loadData])
  )

  const handleCopyCode = useCallback(() => {
    if (!referralCode) {
      Alert.alert('Information', 'Aucun code disponible pour le moment.')
      return
    }

    Alert.alert('Code de parrainage', `Votre code : ${referralCode}`)
  }, [referralCode])

  const handleShareCode = useCallback(async () => {
    if (!referralCode) return

    await Share.share({
      message: `Rejoins Renfort avec mon code ${referralCode} et realise tes premieres missions pour debloquer jusqu'a 20${EURO}.`,
    })
  }, [referralCode])

  return (
    <View style={s.screen}>
      <StatusBar barStyle="dark-content" backgroundColor={C.bg} />
      <ScrollView style={s.scroll} contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        <TouchableOpacity style={s.backBtn} onPress={() => router.back()} activeOpacity={0.8}>
          <Text style={s.backTxt}>Retour</Text>
        </TouchableOpacity>

        <Text style={s.eyebrow}>PARRAINAGE</Text>
        
        <View style={s.introCard}>
          <Text style={s.title}>Parrainez vos amis</Text>
          <Text style={s.sub}>
            Invitez des extras sur Renfort et gagnez jusqu&apos;a 20{EURO} par ami actif.
          </Text>
        </View>

        <View style={s.heroCard}>
          <Text style={s.heroLabel}>Votre code</Text>
          <Text style={s.heroCode}>{referralCode || 'Code en preparation'}</Text>
          <View style={s.heroActions}>
            <TouchableOpacity style={s.heroBtn} onPress={handleCopyCode} activeOpacity={0.88}>
              <Text style={s.heroBtnTxt}>Copier</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.heroBtn, s.heroBtnSoft]} onPress={handleShareCode} activeOpacity={0.88}>
              <Text style={[s.heroBtnTxt, s.heroBtnTxtSoft]}>Partager</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={s.sectionCard}>
          <Text style={s.sectionTitle}>Recompenses</Text>
          <View style={s.rewardList}>
            {REWARD_STEPS.map((step) => {
              const isReached = filleuls.some((filleul) => filleul.rewards.some((reward) => reward.milestone === step.milestone))
              return (
                <View key={step.milestone} style={[s.rewardCard, isReached && s.rewardCardDone]}>
                  <View style={[s.rewardIconWrap, isReached && s.rewardIconWrapDone]}>
                    <Text style={[s.rewardIconTxt, isReached && s.rewardIconTxtDone]}>{isReached ? '✓' : `${step.milestone}`}</Text>
                  </View>
                  <View style={s.rewardContent}>
                    <Text style={s.rewardTitle}>{`${step.milestone} mission${step.milestone > 1 ? 's' : ''}`}</Text>
                    <Text style={s.rewardSub}>{isReached ? 'Palier deja debloque' : 'En attente de validation'}</Text>
                  </View>
                  <Text style={s.rewardAmount}>{`+${step.amount}${EURO}`}</Text>
                </View>
              )
            })}
          </View>
        </View>

        <View style={s.sectionCard}>
          <Text style={s.sectionTitle}>Mes gains</Text>
          <View style={s.statsRow}>
            <View style={s.statCard}>
              <Text style={s.statValue}>{referredCount}</Text>
              <Text style={s.statLabel}>Amis parraines</Text>
            </View>
            <View style={s.statCard}>
              <Text style={s.statValue}>{totalEarned}{EURO}</Text>
              <Text style={s.statLabel}>Total gagne</Text>
            </View>
          </View>
        </View>

        <View style={s.sectionCard}>
          <Text style={s.sectionTitle}>Mes filleuls</Text>
          {loading ? (
            <Text style={s.emptyText}>Chargement...</Text>
          ) : filleuls.length === 0 ? (
            <Text style={s.emptyText}>Aucun filleul pour le moment.</Text>
          ) : (
            filleuls.map((filleul) => (
              <View key={filleul.id} style={s.filleulCard}>
                <View style={s.filleulTop}>
                  <View>
                    <Text style={s.filleulName}>{filleul.prenom} {filleul.nom}</Text>
                    <Text style={s.filleulMeta}>{filleul.progressLabel} missions</Text>
                  </View>
                  <View style={s.progressBadge}>
                    <Text style={s.progressBadgeTxt}>{filleul.progressLabel}</Text>
                  </View>
                </View>
                <Text style={s.filleulMeta}>
                  {filleul.missionsRealisees} mission{filleul.missionsRealisees > 1 ? 's' : ''} validee{filleul.missionsRealisees > 1 ? 's' : ''}
                </Text>
                <View style={s.filleulProgressTrack}>
                  <View
                    style={[
                      s.filleulProgressFill,
                      { width: `${Math.max(8, Math.min((filleul.missionsRealisees / 5) * 100, 100))}%` },
                    ]}
                  />
                </View>
                <View style={s.filleulMilestones}>
                  {REWARD_STEPS.map((step) => {
                    const isReached = getStepState(filleul, step.milestone)
                    return (
                      <View key={`${filleul.id}-${step.milestone}`} style={[s.filleulStep, isReached && s.filleulStepDone]}>
                        <Text style={[s.filleulStepTxt, isReached && s.filleulStepTxtDone]}>
                          {isReached ? `✓ ${step.milestone}` : `${step.milestone}`}
                        </Text>
                      </View>
                    )
                  })}
                </View>
                <Text style={s.filleulRewards}>
                  Gains debloques : {filleul.totalEarned}{EURO}
                </Text>
                {getNextReferralReward(filleul.missionsRealisees) ? (
                  <Text style={s.filleulNextBonus}>
                    {`Prochain bonus : ${getNextReferralReward(filleul.missionsRealisees)?.amount}${EURO} a ${getNextReferralReward(filleul.missionsRealisees)?.milestone} missions`}
                  </Text>
                ) : (
                  <Text style={s.filleulNextBonusDone}>Tous les bonus sont debloques</Text>
                )}
                {getNextReferralReward(filleul.missionsRealisees) && (
                  <Text style={s.filleulHint}>
                    {getRemainingMissionsText(
                      filleul.missionsRealisees,
                      getNextReferralReward(filleul.missionsRealisees)!.milestone
                    )}
                  </Text>
                )}
              </View>
            ))
          )}
        </View>
      </ScrollView>
    </View>
  )
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 20, paddingTop: 56, paddingBottom: 36 },
  backBtn: { alignSelf: 'flex-start', marginBottom: 16 },
  backTxt: { fontSize: 15, color: C.terra, fontWeight: '700' },
  eyebrow: { fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', color: C.textMuted, marginBottom: 10, fontWeight: '700' },
  introCard: {
    backgroundColor: C.card,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: C.border,
    padding: 20,
    marginBottom: 14,
    shadowColor: C.shadow,
    shadowOpacity: 0.05,
    shadowOffset: { width: 0, height: 8 },
    shadowRadius: 16,
    elevation: 2,
  },
  title: { fontSize: 30, fontWeight: '800', color: C.title, letterSpacing: -0.5, marginBottom: 10 },
  sub: { fontSize: 15, color: C.textSoft, lineHeight: 22 },
  heroCard: {
    backgroundColor: C.card,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: C.border,
    padding: 20,
    marginBottom: 14,
    shadowColor: C.shadow,
    shadowOpacity: 0.06,
    shadowOffset: { width: 0, height: 8 },
    shadowRadius: 18,
    elevation: 3,
  },
  heroLabel: { fontSize: 13, color: C.textMuted, fontWeight: '700', marginBottom: 8, textTransform: 'uppercase' },
  heroCode: { fontSize: 28, color: C.title, fontWeight: '900', letterSpacing: -0.6, marginBottom: 16 },
  heroActions: { flexDirection: 'row', gap: 10 },
  heroBtn: {
    flex: 1,
    backgroundColor: C.terra,
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: C.terraDark,
  },
  heroBtnSoft: { backgroundColor: C.cardSoft, borderColor: C.borderSoft },
  heroBtnTxt: { fontSize: 14, fontWeight: '800', color: '#FFFFFF' },
  heroBtnTxtSoft: { color: C.textSoft },
  sectionCard: {
    backgroundColor: C.card,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: C.border,
    padding: 18,
    marginBottom: 14,
  },
  sectionTitle: { fontSize: 18, fontWeight: '800', color: C.title, marginBottom: 14 },
  rewardList: { gap: 10 },
  rewardCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.cardSoft,
    borderWidth: 1,
    borderColor: C.borderSoft,
    borderRadius: 18,
    padding: 14,
  },
  rewardCardDone: {
    backgroundColor: C.greenBg,
    borderColor: C.greenBd,
  },
  rewardIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: C.terraBg,
    borderWidth: 1,
    borderColor: C.terraBd,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  rewardIconWrapDone: {
    backgroundColor: C.green,
    borderColor: C.green,
  },
  rewardIconTxt: { fontSize: 13, fontWeight: '800', color: C.terraDark },
  rewardIconTxtDone: { color: '#FFFFFF' },
  rewardContent: { flex: 1 },
  rewardTitle: { fontSize: 14, color: C.text, fontWeight: '600' },
  rewardSub: { fontSize: 12, color: C.textMuted, marginTop: 3 },
  rewardAmount: { fontSize: 15, color: C.terra, fontWeight: '800' },
  statsRow: { flexDirection: 'row', gap: 10 },
  statCard: { flex: 1, backgroundColor: C.cardSoft, borderWidth: 1, borderColor: C.borderSoft, borderRadius: 18, paddingVertical: 18, alignItems: 'center' },
  statValue: { fontSize: 24, fontWeight: '900', color: C.title, marginBottom: 4 },
  statLabel: { fontSize: 12, color: C.textMuted, fontWeight: '600' },
  emptyText: { fontSize: 14, color: C.textMuted },
  filleulCard: { backgroundColor: C.cardSoft, borderRadius: 18, borderWidth: 1, borderColor: C.borderSoft, padding: 14, marginBottom: 10 },
  filleulTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  filleulName: { fontSize: 15, fontWeight: '800', color: C.title },
  filleulMeta: { fontSize: 13, color: C.textSoft },
  filleulRewards: { fontSize: 13, color: C.terraDark, fontWeight: '700', marginTop: 6 },
  filleulProgressTrack: {
    height: 8,
    backgroundColor: '#F0E5D8',
    borderRadius: 999,
    overflow: 'hidden',
    marginTop: 10,
    marginBottom: 10,
  },
  filleulProgressFill: {
    height: '100%',
    backgroundColor: C.terra,
    borderRadius: 999,
  },
  filleulMilestones: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  filleulStep: {
    backgroundColor: '#F5EEE7',
    borderWidth: 1,
    borderColor: '#E4D8CB',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  filleulStepDone: {
    backgroundColor: C.greenBg,
    borderColor: C.greenBd,
  },
  filleulStepTxt: { fontSize: 12, color: C.textSoft, fontWeight: '700' },
  filleulStepTxtDone: { color: C.green, fontWeight: '800' },
  progressBadge: { backgroundColor: C.greenBg, borderWidth: 1, borderColor: C.greenBd, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  progressBadgeTxt: { fontSize: 12, fontWeight: '800', color: C.green },
  filleulNextBonus: { fontSize: 13, color: C.title, fontWeight: '700', marginTop: 8 },
  filleulNextBonusDone: { fontSize: 13, color: C.green, fontWeight: '800', marginTop: 8 },
  filleulHint: { fontSize: 12, color: C.textMuted, marginTop: 4, lineHeight: 18 },
})
