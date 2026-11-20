import { Alert } from 'react-native';

import { errorMessage } from '@/api/client';

/** An `onError` for a mutation: tells the user what failed and why. */
export function alertError(title: string) {
  return (error: unknown) => Alert.alert(title, errorMessage(error));
}
