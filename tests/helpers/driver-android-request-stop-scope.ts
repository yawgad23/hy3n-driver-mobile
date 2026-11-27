import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
export const REQUEST_STOP_BASELINE = 'd2d376e9842f93e19e2ca55adcf1aac15fe0cbd2';
// Exact reviewed request-stop/server-read additions only; no pattern exclusions.
const replacements: Record<string, Array<[string, string]>> = {
  "app/(tabs)/home.tsx": [
    [
      "\n  const handleVerifyPickupCode = async () => {\n    if (!activeTrip || !user?.uid || !pickupCode.trim() || tripActionInFlightRef.current) return;\n    if (Platform.OS === 'ios' || Platform.OS === 'android') stopAllDriverRequestAudio(String(activeTrip.id));\n",
      "\n  const handleVerifyPickupCode = async () => {\n    if (!activeTrip || !user?.uid || !pickupCode.trim() || tripActionInFlightRef.current) return;\n"
    ],
    [
      "      Alert.alert('Arrive first', 'Mark that you have arrived at the pickup point before starting the trip.');\n      return;\n    }\n    if (Platform.OS === 'ios' || Platform.OS === 'android') stopAllDriverRequestAudio(String(activeTrip.id));\n",
      "      Alert.alert('Arrive first', 'Mark that you have arrived at the pickup point before starting the trip.');\n      return;\n    }\n"
    ],
    [
      "    if (Platform.OS === 'ios' || Platform.OS === 'android') stopAllDriverRequestAudio(String(ride.id));\n",
      ""
    ],
    [
      "          // Preserve web's existing per-offer retirement/retry behavior.\n",
      "          // Preserve Android's existing per-offer retirement/retry behavior.\n"
    ],
    [
      "            // Clear only this native request's consumed latch after fresh proof,\n",
      "            // Keep iOS hook/native ownership. Clear only this played-ride latch\n"
    ],
    [
      "            && (Platform.OS !== 'android' || AppState.currentState === 'active')\n",
      ""
    ],
    [
      "        if (Platform.OS === 'ios' || Platform.OS === 'android') {\n",
      "        if (Platform.OS === 'ios') {\n"
    ],
    [
      "    acceptedOfferAudioSuppressionRef.current = rideId;\n    // Stop on tap, not after the accepted server response. iPhone native\n    // playback status can lag the audible request song by a short interval.\n    if (Platform.OS === 'ios' || Platform.OS === 'android') stopAllDriverRequestAudio(rideId);\n",
      "    acceptedOfferAudioSuppressionRef.current = rideId;\n    // Stop on tap, not after the accepted server response. iPhone native\n    // playback status can lag the audible request song by a short interval.\n"
    ],
    [
      "          if (confirmFailedAccept) {\n            // Android must positively observe a fresh, still-unassigned offer.\n            // Missing, terminal or another driver's assignment is not permission.\n            failedAcceptConfirmedUnassigned = Platform.OS !== 'android' || Boolean(serverRide\n              && String(serverRide.id) === rideId\n              && ['searching', 'pending'].includes(String(serverRide.status || '').toLowerCase())\n              && !(serverRide.driver_id || serverRide.driverId || serverRide.driver?.id));\n          }\n",
      "          if (confirmFailedAccept) failedAcceptConfirmedUnassigned = true;\n"
    ],
    [
      "        // A cached pre-Accept document is not proof the server rejected Accept.\n        // Ambiguous/offline reads must keep the consumed request silent.\n        const serverRide = await firestoreDB.getFromServer(COLLECTIONS.RIDES, rideId);\n",
      "        const serverRide = await firestoreDB.get(COLLECTIONS.RIDES, rideId);\n"
    ],
    [
      "      if (Platform.OS === 'ios' || Platform.OS === 'android') stopAllDriverRequestAudio(rideId);\n",
      ""
    ],
    [
      "        if (Platform.OS === 'ios' || Platform.OS === 'android') stopAllDriverRequestAudio(String(current.id));\n",
      ""
    ],
    [
      "  }, [activeTrip?.id, activeTrip?.status, incomingRide?.id, incomingRide?.driver_offer_expires_at, incomingTripAlertStatus.isLoaded, isOnline, playIncomingTripAlert, prefs.soundAlerts, requestAudioForeground, stopIncomingTripAlert, (Platform.OS === 'android' || Platform.OS === 'ios') && tripActionPending, (Platform.OS === 'ios' || Platform.OS === 'android') && user?.uid]);\n",
      "  }, [activeTrip?.id, activeTrip?.status, incomingRide?.id, incomingRide?.driver_offer_expires_at, incomingTripAlertStatus.isLoaded, isOnline, playIncomingTripAlert, prefs.soundAlerts, requestAudioForeground, stopIncomingTripAlert, (Platform.OS === 'android' || Platform.OS === 'ios') && tripActionPending]);\n"
    ],
    [
      "    // Stop request owners across retained Home instances, not navigation audio.\n    if ((Platform.OS === 'ios' || Platform.OS === 'android') && (activeTrip?.id || !user?.uid)) {\n      stopAllDriverRequestAudio(activeTrip?.id ? String(activeTrip.id) : undefined);\n    }\n",
      ""
    ],
    [
      "import { createDriverRequestAudio, stopAllDriverRequestAudio } from '@/lib/driver-request-audio';\n",
      "import { createDriverRequestAudio } from '@/lib/driver-request-audio';\n"
    ]
  ],
  "lib/firebase.ts": [
    [
      "  /** Never use cached/local-pending data as proof that an Accept did not commit. */\n  async getFromServer(collectionName: string, id: string) {\n    const docRef = doc(db, collectionName, id);\n    const docSnap = await getDocFromServer(docRef);\n    if (docSnap.metadata.fromCache || docSnap.metadata.hasPendingWrites) {\n      throw new Error('Server trip state is not confirmed.');\n    }\n    return docToObj(docSnap);\n  },\n\n",
      ""
    ],
    [
      "  getDocFromServer,\n",
      ""
    ]
  ]
};
export function withoutAndroidRequestStopAdditions(file: string, source: string): string {
  assert.ok(replacements[file], `no normalization allowed for ${file}`);
  let normalized = source;
  for (const [addition, original] of replacements[file]) {
    assert.equal(normalized.split(addition).length - 1, 1, `exact reviewed addition must occur once: ${addition}`);
    normalized = normalized.replace(addition, original);
  }
  return normalized;
}
export const REVIEWED_REQUEST_AUDIO_SHA256 = '4cf67a12361bd6362c32c4df1f3472163d82303b98ad1be8a995aa390c082567';
export function assertReviewedRequestAudio(source: Buffer) {
  assert.equal(createHash('sha256').update(source).digest('hex'), REVIEWED_REQUEST_AUDIO_SHA256,
    'controller must remain the exact reviewed implementation; behavior tests cover the new safeguards');
}
