import { useEffect, useState } from "react";
import { Platform, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import * as Linking from "expo-linking";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { loadPairing, parsePairing, savePairing, type Pairing } from "./pairing";
import { PairScreen } from "./PairScreen";
import { IslandScreen } from "./IslandScreen";
import { colors } from "./ui";

export default function App() {
  const [pairing, setPairing] = useState<Pairing | null | undefined>(undefined);
  const url = Linking.useURL();

  useEffect(() => {
    // A pairing link opened right now wins over what was stored before.
    void loadPairing().then((stored) => setPairing((current) => (current === undefined ? stored : current)));
  }, []);

  // Scanning the QR code with the iPhone camera opens nimbo://pair?… straight into the app.
  useEffect(() => {
    // On the web the QR link opens this page directly: https://<relay>/pair#…
    const href = Platform.OS === "web" && typeof window !== "undefined" ? window.location.href : url;
    const linked = href ? parsePairing(href) : null;
    if (linked) {
      setPairing(linked);
      void savePairing(linked);
      // Keep the code out of the address bar and the home-screen shortcut.
      if (Platform.OS === "web") window.history.replaceState(null, "", "/");
    }
  }, [url]);

  const pair = (next: Pairing | null) => {
    setPairing(next);
    void savePairing(next);
  };

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        {pairing === undefined ? null : pairing ? <IslandScreen pairing={pairing} onUnpair={() => pair(null)} /> : <PairScreen onPaired={pair} />}
      </View>
    </SafeAreaProvider>
  );
}
