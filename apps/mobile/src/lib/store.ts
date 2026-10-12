/**
 * Connection store — where the phone is paired to a PC running VOXEL.
 *
 * The pairing token is a live secret: it lives in the OS keychain/keystore
 * via expo-secure-store (never plain storage). Optional biometric unlock
 * gates the app when the device supports it (see useBiometricGate).
 */

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import * as SecureStore from "expo-secure-store";

interface Connection {
  address: string; // host:port of the PC bridge
  token: string;
}

interface ConnectionState {
  connection: Connection | null;
  connect: (address: string, token: string) => void;
  disconnect: () => void;
}

/** zustand storage adapter backed by the OS secure store (keychain/keystore). */
const secureStorage = {
  getItem: async (name: string): Promise<string | null> => {
    try {
      return await SecureStore.getItemAsync(name);
    } catch {
      return null;
    }
  },
  setItem: async (name: string, value: string): Promise<void> => {
    try {
      await SecureStore.setItemAsync(name, value);
    } catch {
      // secure store unavailable (rare emulator images) — session dies with
      // the app rather than falling back to insecure persistence
    }
  },
  removeItem: async (name: string): Promise<void> => {
    try {
      await SecureStore.deleteItemAsync(name);
    } catch {
      // nothing to remove
    }
  },
};

export const useConnection = create<ConnectionState>()(
  persist(
    (set) => ({
      connection: null,
      connect: (address, token) => set({ connection: { address, token } }),
      disconnect: () => set({ connection: null }),
    }),
    {
      name: "voxel-connection",
      storage: createJSONStorage(() => secureStorage),
    },
  ),
);
