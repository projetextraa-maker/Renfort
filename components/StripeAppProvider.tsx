import { Platform } from 'react-native'
import type { ReactElement, ReactNode } from 'react'

type StripeAppProviderProps = {
  children: ReactNode
  publishableKey: string
}

export default function StripeAppProvider(props: StripeAppProviderProps) {
  if (Platform.OS === 'web') {
    const WebStripeAppProvider = require('./StripeAppProvider.web').default as (
      innerProps: StripeAppProviderProps
    ) => ReactElement
    return <WebStripeAppProvider {...props} />
  }

  const NativeStripeAppProvider = require('./StripeAppProvider.native').default as (
    innerProps: StripeAppProviderProps
  ) => ReactElement
  return <NativeStripeAppProvider {...props} />
}
