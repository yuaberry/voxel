/**
 * Biometric gate (briefing §59) — optional, device-honest:
 * when the phone is paired and the OS has biometrics enrolled, the app
 * requires a Face/Touch unlock before exposing the paired session.
 * Without biometrics, no gate is faked.
 */

import { useCallback, useEffect, useState } from "react";
import * as LocalAuthentication from "expo-local-authentication";

export type GateState = "checking" | "unlocked" | "locked" | "unsupported";

export function useBiometricGate(enabled: boolean): {
  state: GateState;
  unlock: () => Promise<void>;
  hasBiometrics: boolean;
} {
  const [state, setState] = useState<GateState>("checking");
  const [hasBiometrics, setHasBiometrics] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setState("unlocked");
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const hasHardware = await LocalAuthentication.hasHardwareAsync();
        const enrolled = await LocalAuthentication.isEnrolledAsync();
        if (!hasHardware || !enrolled) {
          if (!cancelled) {
            setHasBiometrics(false);
            setState("unsupported"); // honest: no biometrics, no fake gate
          }
          return;
        }
        if (!cancelled) {
          setHasBiometrics(true);
          setState("locked");
        }
      } catch {
        if (!cancelled) setState("unsupported");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  const unlock = useCallback(async () => {
    try {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: "Unlock VOXEL",
        fallbackLabel: "Use passcode",
      });
      if (result.success) {
        setState("unlocked");
      }
      // failure keeps the gate locked — the user can retry
    } catch {
      setState("unsupported");
    }
  }, []);

  return { state, unlock, hasBiometrics };
}
