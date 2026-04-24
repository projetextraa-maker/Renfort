import { StripeProvider } from '@stripe/stripe-react-native'
import type { ReactNode } from 'react'

type StripeAppProviderProps = {
  children: ReactNode
  publishableKey: string
}

export default function StripeAppProvider({
  children,
  publishableKey,
}: StripeAppProviderProps) {
  return <StripeProvider publishableKey={publishableKey}>{children as any}</StripeProvider>
}
