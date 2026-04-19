import { useRouter } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import {
  Animated,
  Dimensions,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native'

const SCREEN_WIDTH = Dimensions.get('window').width
const BRAND_FONT_SIZE = SCREEN_WIDTH <= 375 ? 48 : 54
const BRAND_LINE_HEIGHT = SCREEN_WIDTH <= 375 ? 52 : 58
const BRAND_LETTER_SPACING = SCREEN_WIDTH <= 375 ? 4.2 : 4.8

const C = {
  bg: '#F7F4EE',
  bgWarm: '#F3E6D8',
  bgSoft: '#F6EEE3',
  border: '#E9DFD2',
  card: '#FFFDFC',
  title: '#181511',
  text: '#4A4239',
  terra: '#C46A3C',
  terraDark: '#9F542D',
  terraGlow: '#E3A17B',
  green: '#256F49',
  greenText: '#1F5F3E',
  muted: '#9A8C7E',
  shadow: '#2B2118',
}

export default function HomeScreen() {
  const router = useRouter()
  const [step, setStep] = useState<1 | 2>(1)
  const fadeAnim = useRef(new Animated.Value(0)).current
  const translateAnim = useRef(new Animated.Value(12)).current
  const brandFadeAnim = useRef(new Animated.Value(0)).current
  const brandTranslateAnim = useRef(new Animated.Value(10)).current
  const brandScaleAnim = useRef(new Animated.Value(0.985)).current
  const titleFadeAnim = useRef(new Animated.Value(0)).current
  const titleTranslateAnim = useRef(new Animated.Value(10)).current
  const subtitleFadeAnim = useRef(new Animated.Value(0)).current
  const subtitleTranslateAnim = useRef(new Animated.Value(10)).current
  const ctaFadeAnim = useRef(new Animated.Value(0)).current
  const ctaTranslateAnim = useRef(new Animated.Value(10)).current

  useEffect(() => {
    if (step === 1) {
      brandFadeAnim.setValue(0)
      brandTranslateAnim.setValue(10)
      brandScaleAnim.setValue(0.985)
      titleFadeAnim.setValue(0)
      titleTranslateAnim.setValue(10)
      subtitleFadeAnim.setValue(0)
      subtitleTranslateAnim.setValue(10)
      ctaFadeAnim.setValue(0)
      ctaTranslateAnim.setValue(10)

      Animated.sequence([
        Animated.parallel([
          Animated.timing(brandFadeAnim, {
            toValue: 1,
            duration: 280,
            useNativeDriver: true,
          }),
          Animated.timing(brandTranslateAnim, {
            toValue: 0,
            duration: 280,
            useNativeDriver: true,
          }),
          Animated.timing(brandScaleAnim, {
            toValue: 1,
            duration: 280,
            useNativeDriver: true,
          }),
        ]),
        Animated.stagger(70, [
          Animated.parallel([
            Animated.timing(titleFadeAnim, {
              toValue: 1,
              duration: 220,
              useNativeDriver: true,
            }),
            Animated.timing(titleTranslateAnim, {
              toValue: 0,
              duration: 220,
              useNativeDriver: true,
            }),
          ]),
          Animated.parallel([
            Animated.timing(subtitleFadeAnim, {
              toValue: 1,
              duration: 220,
              useNativeDriver: true,
            }),
            Animated.timing(subtitleTranslateAnim, {
              toValue: 0,
              duration: 220,
              useNativeDriver: true,
            }),
          ]),
          Animated.parallel([
            Animated.timing(ctaFadeAnim, {
              toValue: 1,
              duration: 220,
              useNativeDriver: true,
            }),
            Animated.timing(ctaTranslateAnim, {
              toValue: 0,
              duration: 220,
              useNativeDriver: true,
            }),
          ]),
        ]),
      ]).start()

      return
    }

    fadeAnim.setValue(0)
    translateAnim.setValue(12)

    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 260,
        useNativeDriver: true,
      }),
      Animated.timing(translateAnim, {
        toValue: 0,
        duration: 260,
        useNativeDriver: true,
      }),
    ]).start()
  }, [
    brandFadeAnim,
    brandScaleAnim,
    brandTranslateAnim,
    ctaFadeAnim,
    ctaTranslateAnim,
    fadeAnim,
    step,
    subtitleFadeAnim,
    subtitleTranslateAnim,
    titleFadeAnim,
    titleTranslateAnim,
    translateAnim,
  ])

  return (
    <View style={styles.screen}>
      <StatusBar barStyle="dark-content" backgroundColor={C.bg} />

      <View style={styles.bgCircleTop} />
      <View style={styles.bgCircleBottom} />

      <View style={styles.container}>
        <View style={styles.centeredBlock}>
          <View style={styles.progressRow}>
            <View style={[styles.progressDot, step === 1 && styles.progressDotActive]} />
            <View style={[styles.progressDot, step === 2 && styles.progressDotActive]} />
          </View>

          {step === 1 ? (
            <View style={styles.motionWrap}>
              <View style={[styles.hero, styles.heroStepOne]}>
                <Text style={styles.eyebrow}>RESTAURATION & EXTRAS</Text>
                <Animated.Text
                  style={[
                    styles.brandName,
                    {
                      opacity: brandFadeAnim,
                      transform: [
                        { translateY: brandTranslateAnim },
                        { scale: brandScaleAnim },
                      ],
                    },
                  ]}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.88}
                >
                  RENFORT
                </Animated.Text>
                <Animated.Text
                  style={[
                    styles.title,
                    {
                      opacity: titleFadeAnim,
                      transform: [{ translateY: titleTranslateAnim }],
                    },
                  ]}
                >
                  Trouvez du personnel rapidement
                </Animated.Text>
                <Animated.Text
                  style={[
                    styles.subtitle,
                    {
                      opacity: subtitleFadeAnim,
                      transform: [{ translateY: subtitleTranslateAnim }],
                    },
                  ]}
                >
                  Des profils disponibles autour de vous, en quelques minutes.
                </Animated.Text>

                <Animated.View
                  style={{
                    width: '100%',
                    opacity: ctaFadeAnim,
                    transform: [{ translateY: ctaTranslateAnim }],
                  }}
                >
                  <Pressable
                    onPress={() => setStep(2)}
                    style={({ pressed }) => [
                      styles.buttonPrimary,
                      styles.buttonPrimaryGlow,
                      pressed && styles.buttonPrimaryPressed,
                    ]}
                  >
                    <Text style={styles.buttonPrimaryText}>Commencer</Text>
                  </Pressable>
                </Animated.View>

                <Text style={styles.signatureText}>Le bon Renfort, au bon moment.</Text>
              </View>
            </View>
          ) : (
            <Animated.View
              style={[
                styles.motionWrap,
                {
                  opacity: fadeAnim,
                  transform: [{ translateY: translateAnim }],
                },
              ]}
            >
              <View style={styles.hero}>
                <Text style={styles.brandMini}>RENFORT</Text>
                <Text style={styles.titleSecondary}>Que souhaitez-vous faire ?</Text>

                <View style={styles.actionsCard}>
                  <Pressable
                    onPress={() => router.push('/patron')}
                    style={({ pressed }) => [
                      styles.choiceCardPrimary,
                      pressed && styles.choiceCardPrimaryPressed,
                    ]}
                  >
                    <Text style={styles.choiceTitlePrimary}>Trouver un Renfort</Text>
                    <Text style={styles.choiceSubtextPrimary}>
                      Publiez une mission et trouvez du personnel rapidement
                    </Text>
                  </Pressable>

                  <Pressable
                    onPress={() => router.push('/serveur')}
                    style={({ pressed }) => [
                      styles.choiceCardSecondary,
                      pressed && styles.choiceCardSecondaryPressed,
                    ]}
                  >
                    <Text style={styles.choiceTitleSecondary}>Chercher une mission</Text>
                    <Text style={styles.choiceSubtextSecondary}>
                      Trouvez des extras pres de vous, rapidement
                    </Text>
                  </Pressable>
                </View>
              </View>
            </Animated.View>
          )}
        </View>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: C.bg,
  },
  bgCircleTop: {
    position: 'absolute',
    top: -95,
    right: -30,
    width: 280,
    height: 280,
    borderRadius: 140,
    backgroundColor: C.bgWarm,
    opacity: 0.9,
  },
  bgCircleBottom: {
    position: 'absolute',
    bottom: 55,
    left: -40,
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: C.bgSoft,
    opacity: 0.95,
  },
  container: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 30,
    paddingBottom: 22,
  },
  centeredBlock: {
    flex: 1,
    justifyContent: 'center',
  },
  motionWrap: {
    width: '100%',
  },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    marginBottom: 30,
  },
  progressDot: {
    width: 7,
    height: 7,
    borderRadius: 999,
    backgroundColor: '#D5C8BA',
  },
  progressDotActive: {
    width: 24,
    height: 8,
    backgroundColor: C.terra,
  },
  hero: {
    alignItems: 'center',
  },
  heroStepOne: {
    marginTop: -52,
  },
  eyebrow: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.4,
    color: C.muted,
    marginBottom: 12,
  },
  brandName: {
    fontSize: BRAND_FONT_SIZE,
    lineHeight: BRAND_LINE_HEIGHT,
    fontWeight: '900',
    letterSpacing: BRAND_LETTER_SPACING,
    color: C.title,
    textAlign: 'center',
    width: '100%',
    maxWidth: 320,
    marginBottom: 28,
  },
  brandMini: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '900',
    letterSpacing: 2.2,
    color: C.muted,
    textAlign: 'center',
    marginBottom: 10,
  },
  title: {
    fontSize: 32,
    lineHeight: 39,
    fontWeight: '800',
    letterSpacing: -0.9,
    color: C.title,
    textAlign: 'center',
    marginBottom: 18,
    maxWidth: 300,
  },
  titleSecondary: {
    fontSize: 31,
    lineHeight: 36,
    fontWeight: '800',
    letterSpacing: -0.9,
    color: C.title,
    textAlign: 'center',
    marginBottom: 18,
  },
  subtitle: {
    maxWidth: 244,
    fontSize: 17,
    lineHeight: 27,
    color: '#564E46',
    fontWeight: '500',
    textAlign: 'center',
    marginBottom: 44,
  },
  actionsCard: {
    width: '100%',
    backgroundColor: '#FFFDFB',
    borderRadius: 30,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 18,
    borderWidth: 1,
    borderColor: C.border,
    shadowColor: C.shadow,
    shadowOpacity: 0.11,
    shadowOffset: { width: 0, height: 10 },
    shadowRadius: 18,
    elevation: 6,
  },
  buttonPrimary: {
    backgroundColor: '#CD7344',
    borderRadius: 22,
    paddingVertical: 22,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: C.terraDark,
    shadowColor: C.terra,
    shadowOpacity: 0.22,
    shadowOffset: { width: 0, height: 14 },
    shadowRadius: 16,
    elevation: 7,
    width: '100%',
    marginBottom: 16,
  },
  buttonPrimaryPressed: {
    opacity: 0.97,
    transform: [{ scale: 0.978 }],
  },
  buttonPrimaryGlow: {
    shadowColor: C.terraGlow,
  },
  buttonPrimaryText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  choiceCardPrimary: {
    backgroundColor: '#CD7344',
    borderRadius: 22,
    paddingHorizontal: 18,
    paddingVertical: 18,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: C.terraDark,
    shadowColor: C.terra,
    shadowOpacity: 0.15,
    shadowOffset: { width: 0, height: 10 },
    shadowRadius: 16,
    elevation: 4,
    minHeight: 112,
    justifyContent: 'center',
  },
  choiceCardPrimaryPressed: {
    opacity: 0.98,
    transform: [{ scale: 0.97 }],
  },
  choiceTitlePrimary: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '900',
    letterSpacing: -0.3,
    marginBottom: 6,
    textAlign: 'center',
  },
  choiceSubtextPrimary: {
    color: 'rgba(255,255,255,0.82)',
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '600',
    textAlign: 'center',
  },
  choiceCardSecondary: {
    backgroundColor: '#E8DED0',
    borderRadius: 22,
    paddingHorizontal: 18,
    paddingVertical: 18,
    borderWidth: 1,
    borderColor: '#D6C6B2',
    shadowColor: C.shadow,
    shadowOpacity: 0.1,
    shadowOffset: { width: 0, height: 7 },
    shadowRadius: 14,
    elevation: 4,
    minHeight: 112,
    justifyContent: 'center',
  },
  choiceCardSecondaryPressed: {
    opacity: 0.98,
    transform: [{ scale: 0.97 }],
  },
  choiceTitleSecondary: {
    color: '#1A1715',
    fontSize: 20,
    fontWeight: '900',
    letterSpacing: -0.3,
    marginBottom: 6,
    textAlign: 'center',
  },
  choiceSubtextSecondary: {
    color: '#5F544B',
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '600',
    textAlign: 'center',
  },
  signatureText: {
    marginTop: 26,
    fontSize: 12,
    lineHeight: 17,
    color: '#8F8174',
    textAlign: 'center',
    fontWeight: '500',
  },
})
