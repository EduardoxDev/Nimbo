import { useState } from "react";
import { Platform, Text, TextInput, View } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { parsePairing, type Pairing } from "./pairing";
import { t } from "./i18n";
import { Button, colors, Mascot, styles } from "./ui";

/** First screen: scan the QR code from the PC's Settings → Celular. */
export function PairScreen({ onPaired }: { onPaired: (pairing: Pairing) => void }) {
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const accept = (value: string) => {
    const pairing = parsePairing(value);
    if (!pairing) {
      setError(t.pairBad);
      return;
    }
    if (done) return;
    setDone(true);
    onPaired(pairing);
  };

  return (
    <View style={{ flex: 1, paddingTop: insets.top + 24, paddingHorizontal: 20, backgroundColor: colors.background }}>
      <View style={{ alignItems: "center", gap: 12, marginBottom: 20 }}>
        <Mascot size={72} />
        <Text style={[styles.big, { fontSize: 26 }]}>{t.pairTitle}</Text>
        <Text style={[styles.muted, { textAlign: "center", fontSize: 15 }]}>{t.pairHint}</Text>
      </View>
      <View style={{ aspectRatio: 1, overflow: "hidden", borderRadius: 28, backgroundColor: "#000", alignItems: "center", justifyContent: "center" }}>
        {Platform.OS !== "web" && permission?.granted ? (
          <CameraView
            style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0 }}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
            onBarcodeScanned={({ data }) => accept(data)}
          />
        ) : (
          <View style={{ padding: 24, gap: 14, alignItems: "center" }}>
            <Text style={[styles.muted, { textAlign: "center" }]}>{t.cameraAsk}</Text>
            {Platform.OS !== "web" && <Button label={t.cameraAllow} accent={colors.blue} onPress={() => void requestPermission()} style={{ flex: 0, paddingHorizontal: 24 }} />}
          </View>
        )}
      </View>
      <Text style={[styles.label, { marginTop: 22 }]}>{t.pairPaste}</Text>
      <View style={styles.row}>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder="nimbo://pair?…"
          placeholderTextColor={colors.muted}
          autoCapitalize="none"
          autoCorrect={false}
          style={[styles.input, { flex: 1 }]}
        />
        <Button label={t.pairButton} accent={colors.blue} onPress={() => accept(text)} style={{ flex: 0, paddingHorizontal: 18 }} />
      </View>
      {error ? <Text style={[styles.muted, { marginTop: 10, color: "#ff8a80" }]}>{error}</Text> : null}
    </View>
  );
}
