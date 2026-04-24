import { Stack, useRouter, useSegments } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { useEffect } from 'react'
import { NativeModules, Platform } from 'react-native'
import StripeAppProvider from '../components/StripeAppProvider'
import { ensureAccountProfileForUser } from '../lib/auth-profile-sync'
import { getHomeRouteForRole, getLoginRouteForRole, getRequiredRoleForSegments, resolveAccountRole } from '../lib/auth-role'
import { enregistrerNotifications, shouldRetryPushRegistration } from '../lib/notifications'
import { supabase } from '../lib/supabase'

export default function RootLayout() {
  const router = useRouter()
  const segments = useSegments()
  const stripePublishableKey = process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? ''
  const stripeNativeModuleAvailable = Platform.OS !== 'web' && Boolean((NativeModules as any)?.StripeSdk)

  useEffect(() => {
    if (!__DEV__) return

    const devSettings = NativeModules.DevSettings as {
      setProfilingEnabled?: (enabled: boolean) => void
      setIsShakeToShowDevMenuEnabled?: (enabled: boolean) => void
    } | null

    const disableDebugOverlays = () => {
      devSettings?.setProfilingEnabled?.(false)
      devSettings?.setIsShakeToShowDevMenuEnabled?.(false)
    }

    disableDebugOverlays()

    const timeoutIds = [
      setTimeout(disableDebugOverlays, 0),
      setTimeout(disableDebugOverlays, 250),
      setTimeout(disableDebugOverlays, 1000),
    ]
    const intervalId = setInterval(disableDebugOverlays, 2000)

    return () => {
      timeoutIds.forEach(clearTimeout)
      clearInterval(intervalId)
    }
  }, [])

  useEffect(() => {
    if (!__DEV__) return
    console.log('stripe runtime key loaded', {
      loaded: Boolean(stripePublishableKey),
      prefix: stripePublishableKey ? stripePublishableKey.slice(0, 7) : null,
      nativeModuleAvailable: stripeNativeModuleAvailable,
    })
  }, [stripeNativeModuleAvailable, stripePublishableKey])

  useEffect(() => {
    let cancelled = false

    const registerPush = async () => {
      const shouldTry = await shouldRetryPushRegistration()
      const result = await enregistrerNotifications()

      if (cancelled) return

      if (!result.ok && shouldTry) {
        console.info('[notifications] enregistrement push reporte, nouvel essai au prochain lancement')
      }
    }

    registerPush()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    const guardRoute = async () => {
      const requiredRole = getRequiredRoleForSegments(segments)
      if (!requiredRole) return

      const {
        data: { session },
      } = await supabase.auth.getSession()

      if (cancelled) return

      if (!session?.user) {
        router.replace(getLoginRouteForRole(requiredRole))
        return
      }

      const profileSync = await ensureAccountProfileForUser(session.user)
      if (!profileSync.ok && profileSync.reason !== 'missing_role') {
        console.error('root layout profile sync error', profileSync)
      }

      const actualRole = await resolveAccountRole(
        session.user.id,
        session.user.user_metadata?.account_role
      )

      if (cancelled) return

      if (!actualRole) {
        await supabase.auth.signOut()
        if (!cancelled) router.replace('/')
        return
      }

      if (actualRole !== requiredRole) {
        router.replace(getHomeRouteForRole(actualRole))
      }
    }

    guardRoute()

    return () => {
      cancelled = true
    }
  }, [router, segments])

  const appContent = (
    <>
      <Stack screenOptions={{ headerShown: false }} />
      <StatusBar style="auto" />
    </>
  )

  if (!stripePublishableKey || !stripeNativeModuleAvailable) {
    return appContent
  }

  return <StripeAppProvider publishableKey={stripePublishableKey}>{appContent}</StripeAppProvider>
}
