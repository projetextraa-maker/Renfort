import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { enregistrerNotifications, shouldRetryPushRegistration } from '../lib/notifications';

export default function RootLayout() {
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
  }, []);

  return (
    <>
      <Stack screenOptions={{ headerShown: false }} />
      <StatusBar style="auto" />
    </>
  );
}
