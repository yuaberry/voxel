/**
 * Create — AI chat on the phone; the PC does the work (briefing §56).
 * Messages stream through the PC's configured provider — the key never
 * leaves the desktop.
 */

import { useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { bridge, type AskContent } from "../../src/lib/bridge";
import { useConnection } from "../../src/lib/store";
import { colors } from "../../src/theme";
import { Card, VButton } from "../../src/components/ui";

interface PendingImage {
  media_type: string;
  base64: string;
}

interface Turn {
  role: "user" | "assistant";
  content: string;
  /** user turns may carry attached image(s) — shown as a chip */
  images?: number;
}

export default function Create() {
  const connection = useConnection((s) => s.connection);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
  const inputRef = useRef<TextInput>(null);

  const attachImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      base64: true,
      quality: 0.8,
      allowsMultipleSelection: true,
    });
    if (result.canceled) return;
    const next: PendingImage[] = result.assets
      .filter((asset) => asset.base64)
      .map((asset) => ({
        media_type: asset.mimeType ?? "image/png",
        base64: asset.base64 as string,
      }));
    setPendingImages((prev) => [...prev, ...next].slice(0, 3));
    inputRef.current?.focus();
  };

  const send = async () => {
    const prompt = draft.trim();
    if (!prompt || busy) return;
    const images = pendingImages;
    setDraft("");
    setPendingImages([]);
    const userContent: AskContent =
      images.length > 0
        ? [{ type: "text", text: prompt }, ...images.map((image) => ({ type: "image" as const, ...image }))]
        : prompt;
    const history = [
      ...turns.map((t) => ({ role: t.role as string, content: t.content })),
      { role: "user", content: "" },
    ];
    setTurns([
      ...turns,
      { role: "user", content: prompt, images: images.length },
      { role: "assistant", content: "" },
    ]);
    setBusy(true);
    try {
      const answer = await bridge.ask([
        ...turns.map((t) => ({ role: t.role, content: t.content })),
        { role: "user", content: userContent },
      ]);
      void history;
      setTurns((prev) => {
        const next = [...prev];
        next[next.length - 1] = { role: "assistant", content: answer.text };
        return next;
      });
    } catch (e) {
      setTurns((prev) => {
        const next = [...prev];
        next[next.length - 1] = {
          ...next[next.length - 1],
          content: `⚠ ${e instanceof Error ? e.message : String(e)}`,
        };
        return next;
      });
    } finally {
      setBusy(false);
    }
  };

  if (!connection) {
    return (
      <View style={styles.center}>
        <Text style={styles.hint}>Connect to a PC first to use the AI.</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView contentContainerStyle={{ padding: 16, gap: 10 }}>
        {turns.length === 0 && (
          <Card>
            <Text style={styles.title}>Create with VOXEL AI</Text>
            <Text style={styles.hint}>
              Describe what you want — a mod, a datapack, a shader tweak, a
              server style. The request streams to your PC's configured AI
              and the answer appears here while the Nexus tools on the
              desktop can apply it to real project files.
            </Text>
          </Card>
        )}
        {turns.map((turn, index) => (
          <Card
            key={index}
            style={{
              alignSelf: turn.role === "user" ? "flex-end" : "flex-start",
              maxWidth: "88%",
              backgroundColor: turn.role === "user" ? colors.violetSoft : colors.surface,
            }}
          >
            <Text style={turn.role === "user" ? styles.userText : styles.aiText}>
              {turn.content || (busy ? "…" : "")}
            </Text>
          </Card>
        ))}
      </ScrollView>
      <View style={styles.inputRow}>
        {pendingImages.length > 0 && (
          <Pressable
            onPress={() => setPendingImages([])}
            style={styles.imageChip}
          >
            <Text style={styles.imageChipText}>
              📎 {pendingImages.length} image{pendingImages.length === 1 ? "" : "s"} attached — tap to clear
            </Text>
          </Pressable>
        )}
        <TextInput
          ref={inputRef}
          style={styles.input}
          placeholder="e.g. create a prison rank system…"
          placeholderTextColor={colors.faint}
          value={draft}
          onChangeText={setDraft}
          editable={!busy}
          multiline
        />
        <Pressable
          onPress={() => void attachImage()}
          disabled={busy || pendingImages.length >= 3}
          style={({ pressed }) => [
            styles.clipButton,
            pressed && { opacity: 0.7 },
            (busy || pendingImages.length >= 3) && { opacity: 0.35 },
          ]}
        >
          <Text style={{ fontSize: 17, color: colors.violet }}>📎</Text>
        </Pressable>
        <VButton onPress={() => void send()} disabled={busy}>
          {busy ? "…" : "Send"}
        </VButton>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center", padding: 24 },
  title: { color: colors.text, fontSize: 16, fontWeight: "800" },
  hint: { color: colors.muted, fontSize: 12.5, lineHeight: 18 },
  userText: { color: colors.text, fontSize: 13.5, lineHeight: 19 },
  aiText: { color: colors.text, fontSize: 13.5, lineHeight: 19 },
  inputRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    padding: 12,
    borderTopColor: colors.border,
    borderTopWidth: 1,
    alignItems: "flex-end",
  },
  imageChip: {
    backgroundColor: colors.violetSoft,
    borderColor: "rgba(145,85,255,0.4)",
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    width: "100%",
  },
  imageChipText: { color: "#b79cff", fontSize: 11.5 },
  clipButton: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
  },
  input: {
    flex: 1,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
    color: colors.text,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13.5,
    maxHeight: 110,
  },
});
