import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Device from 'expo-device'
import * as Notifications from 'expo-notifications'
import { Platform } from 'react-native'

const PUSH_PROJECT_ID = 'dd6f7424-fe6b-49a6-9f8b-ea12c1cb7ae3'
const PUSH_PENDING_KEY = 'push_registration_pending'
const PUSH_LAST_ERROR_KEY = 'push_registration_last_error'
const MAX_TOKEN_RETRIES = 3
const RETRY_DELAYS_MS = [400, 1000]

type PushRegistrationResult =
  | { ok: true; token: string }
  | {
      ok: false
      reason:
        | 'simulator'
        | 'permission_denied'
        | 'temporarily_unavailable'
        | 'unavailable'
        | 'unknown'
    }

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
})

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error ?? '')
}

function isTransientPushError(error: unknown): boolean {
  const message = getErrorMessage(error).toLowerCase()
  return (
    message.includes('503') ||
    message.includes('temporarily unavailable') ||
    message.includes('high load') ||
    message.includes('timeout') ||
    message.includes('network') ||
    message.includes('fetch failed') ||
    message.includes('connection')
  )
}

async function markPushRegistrationPending(reason: string) {
  await AsyncStorage.multiSet([
    [PUSH_PENDING_KEY, 'true'],
    [PUSH_LAST_ERROR_KEY, reason],
  ])
}

async function clearPushRegistrationPending() {
  await AsyncStorage.multiRemove([PUSH_PENDING_KEY, PUSH_LAST_ERROR_KEY])
}

async function configureAndroidNotificationChannel() {
  if (Platform.OS !== 'android') return

  try {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'default',
      importance: Notifications.AndroidImportance.MAX,
    })
  } catch (error) {
    console.warn('[notifications] impossible de configurer le canal Android', getErrorMessage(error))
  }
}

async function fetchExpoPushTokenWithRetry(): Promise<PushRegistrationResult> {
  for (let attempt = 1; attempt <= MAX_TOKEN_RETRIES; attempt += 1) {
    try {
      const token = await Notifications.getExpoPushTokenAsync({
        projectId: PUSH_PROJECT_ID,
      })

      return { ok: true, token: token.data }
    } catch (error) {
      const transient = isTransientPushError(error)
      const lastAttempt = attempt === MAX_TOKEN_RETRIES

      if (!transient || lastAttempt) {
        const reason = transient ? 'temporarily_unavailable' : 'unavailable'
        console.warn(
          `[notifications] echec recuperation token Expo (${reason})`,
          getErrorMessage(error)
        )
        return { ok: false, reason }
      }

      console.warn(
        `[notifications] token Expo indisponible, nouvelle tentative ${attempt}/${MAX_TOKEN_RETRIES}`,
        getErrorMessage(error)
      )
      await delay(RETRY_DELAYS_MS[attempt - 1] ?? 1200)
    }
  }

  return { ok: false, reason: 'unknown' }
}

export async function enregistrerNotifications(): Promise<PushRegistrationResult> {
  try {
    if (!Device.isDevice) {
      await markPushRegistrationPending('simulator')
      console.info('[notifications] notifications push ignorees sur simulateur')
      return { ok: false, reason: 'simulator' }
    }

    await configureAndroidNotificationChannel()

    const { status: existingStatus } = await Notifications.getPermissionsAsync()
    let finalStatus = existingStatus

    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync()
      finalStatus = status
    }

    if (finalStatus !== 'granted') {
      await markPushRegistrationPending('permission_denied')
      console.info('[notifications] permission push refusee ou non accordee')
      return { ok: false, reason: 'permission_denied' }
    }

    const tokenResult = await fetchExpoPushTokenWithRetry()
    if (!tokenResult.ok) {
      await markPushRegistrationPending(tokenResult.reason)
      return tokenResult
    }

    await clearPushRegistrationPending()
    return tokenResult
  } catch (error) {
    const message = getErrorMessage(error)
    await markPushRegistrationPending(message)
    console.warn('[notifications] enregistrement push non bloquant en echec', message)
    return { ok: false, reason: isTransientPushError(error) ? 'temporarily_unavailable' : 'unknown' }
  }
}

export async function shouldRetryPushRegistration(): Promise<boolean> {
  const pending = await AsyncStorage.getItem(PUSH_PENDING_KEY)
  return pending === 'true'
}

export async function envoyerNotificationLocale(titre: string, message: string) {
  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: titre,
        body: message,
        sound: true,
      },
      trigger: null,
    })
  } catch (error) {
    console.warn('[notifications] notification locale ignoree', getErrorMessage(error))
  }
}
