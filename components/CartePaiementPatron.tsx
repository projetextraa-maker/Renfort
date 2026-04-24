import { Platform } from 'react-native'
import type { ReactElement } from 'react'

export default function CartePaiementPatron(): ReactElement {
  if (Platform.OS === 'web') {
    const WebComponent = require('./CartePaiementPatron.web').default as () => ReactElement
    return <WebComponent />
  }

  const NativeComponent = require('./CartePaiementPatron.native').default as () => ReactElement
  return <NativeComponent />
}
