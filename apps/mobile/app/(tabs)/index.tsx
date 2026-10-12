/**
 * Home — play-first dashboard (briefing §11 mobile-first): live workspace
 * numbers from the PC, servers with real online state, quick actions.
 */

import { useCallback, useEffect, useState } from "react";
import { Alert, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { bridge, BridgeStatus, BridgeServer } from "../../src/lib/bridge";
import { useConnection } from "../../src/lib/store";
import { useBiometricGate } from "../../src/lib/biometricGate";
import { colors } from "../../src/theme";
import { Badge, Card, SectionTitle, Stat, StatusDot, VButton } from "../../src/components/ui";

export default function Home() {
  const connection = useConnection((s) => s.connection);
  const gate = useBiometricGate(!!connection);
  const [status, setStatus] = useState<BridgeStatus | null>(null);
  const [servers, setServers] = useState<BridgeServer[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!connection) return;
    try {
      const [status, serverList] = await Promise.all([
        bridge.status(),
        bridge.servers(),
      ]);
      setStatus(status);
      setServers(serverList.servers);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [connection]);

  useEffect(() => {
    void load();
    const interval = setInterval(() => void load(), 5000);
    return () => clearInterval(interval);
  }, [load]);

  if (gate.state === "locked" || gate.state === "checking") {
    return (
      <View style={styles.center}>
        <Card style={{ width: "92%" }}>
          <Text style={styles.title}>VOXEL is locked</Text>
          <Text style={styles.hint}>
            Your PC pairing is stored securely. Unlock with Face / Touch
            to use VOXEL on this device.
          </Text>
          <VButton
            onPress={() => void gate.unlock()}
            disabled={gate.state === "checking"}
          >
            {gate.state === "checking" ? "Checking…" : "Unlock"}
          </VButton>
        </Card>
      </View>
    );
  }

  if (!connection) {
    return (
      <View style={styles.center}>
        <Card style={{ width: "92%" }}>
          <Text style={styles.title}>Connect to your PC</Text>
          <Text style={styles.hint}>
            Open VOXEL on your computer → Settings → Mobile, enable the
            bridge and type the address + token here. The phone then
            controls the SAME real engine: builds, servers, console and AI.
          </Text>
          <VButton onPress={() => router.push("/connect")}>Connect to PC</VButton>
        </Card>
      </View>
    );
  }

  const running = servers.filter((s) => s.running);

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={{ padding: 16, gap: 14 }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          tintColor={colors.violet}
          onRefresh={async () => {
            setRefreshing(true);
            await load();
            setRefreshing(false);
          }}
        />
      }
    >
      {error && (
        <Card style={{ borderColor: "rgba(248,113,113,0.4)" }}>
          <Text style={{ color: colors.red, fontSize: 12 }}>{error}</Text>
        </Card>
      )}

      {status && (
        <Card>
          <Text style={styles.title}>VOXEL · PC</Text>
          <Text style={styles.hint}>v{status.version} · {connection.address}</Text>
          <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
            <Stat value={status.workspace.projects} label="projects" />
            <Stat value={status.workspace.servers} label="servers" />
            <Stat value={status.workspace.shaderPacks} label="shaders" />
            <Stat value={status.workspace.instances} label="instances" />
          </View>
          <View style={{ flexDirection: "row", gap: 6, marginTop: 12 }}>
            <Badge tone={status.ai.ready ? "violet" : "amber"}>
              {status.ai.ready ? `AI · ${status.ai.model}` : "AI not configured"}
            </Badge>
            <Badge tone="green">{status.app}</Badge>
          </View>
        </Card>
      )}

      <View>
        <SectionTitle>Play now</SectionTitle>
        {running.length === 0 ? (
          <Card>
            <Text style={styles.hint}>
              No servers online. Start one from the Servers tab and hop in —
              the status you see here is live from your PC.
            </Text>
          </Card>
        ) : (
          running.map((server) => (
            <Card key={server.slug} style={{ marginBottom: 8 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <StatusDot on />
                <Text style={styles.name}>{server.name}</Text>
                <Badge>{server.software}</Badge>
              </View>
              <Text style={[styles.hint, { marginTop: 6, fontFamily: undefined }]}>
                {server.minecraftVersion} · :{server.port} · {server.ramMb / 1024}G RAM
              </Text>
              <VButton
                tone="secondary"
                onPress={() => router.push(`/console/${server.slug}`)}
              >
                Open console
              </VButton>
            </Card>
          ))
        )}
      </View>

      <VButton tone="secondary" onPress={() => router.push("/(tabs)/create")}>
        ✦ Ask VOXEL AI to create something
      </VButton>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center" },
  title: { color: colors.text, fontSize: 17, fontWeight: "800" },
  hint: { color: colors.muted, fontSize: 12, lineHeight: 17, marginTop: 4 },
  name: { color: colors.text, fontSize: 14.5, fontWeight: "700", flex: 1 },
});
