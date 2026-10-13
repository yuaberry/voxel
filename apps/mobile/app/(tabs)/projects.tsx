/**
 * Projects — real rows from the PC's SQLite, with live build status and a
 * Build action that runs the SAME Gradle command the desktop button uses.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { bridge, BridgeProject } from "../../src/lib/bridge";
import { useConnection } from "../../src/lib/store";
import { notifyBuildFinished } from "../../src/lib/notify";
import { colors } from "../../src/theme";
import { Badge, Card, StatusDot, VButton } from "../../src/components/ui";

export default function Projects() {
  const connection = useConnection((s) => s.connection);
  const watchers = useRef<ReturnType<typeof setInterval>[]>([]);
  const [projects, setProjects] = useState<BridgeProject[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [building, setBuilding] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!connection) return;
    try {
      const list = await bridge.projects();
      setProjects(list.projects);
    } catch (e) {
      Alert.alert("Could not load projects", e instanceof Error ? e.message : String(e));
    }
  }, [connection]);

  useEffect(() => {
    void load();
    return () => {
      for (const t of watchers.current) clearInterval(t);
      watchers.current = [];
    };
  }, [load]);

  // Watch a build started from THIS phone until its status changes, then
  // ping. Timeout-bounded and cleaned on unmount — never a zombie poller.
  const watchBuild = (slug: string, name: string, previousStatus: string | null) => {
    const startedAt = Date.now();
    const timer = setInterval(async () => {
      try {
        const list = await bridge.projects();
        setProjects(list.projects);
        const current = list.projects.find((p) => p.slug === slug)?.lastBuildStatus ?? null;
        if (current !== previousStatus && (current === "success" || current === "failed")) {
          clearInterval(timer);
          void notifyBuildFinished(name, current === "success");
        }
        if (Date.now() - startedAt > 15 * 60 * 1000) {
          clearInterval(timer);
        }
      } catch {
        clearInterval(timer);
      }
    }, 5000);
    watchers.current.push(timer);
  };

  const build = async (slug: string, name: string) => {
    setBuilding(slug);
    try {
      const previousStatus = projects.find((p) => p.slug === slug)?.lastBuildStatus ?? null;
      await bridge.build(slug);
      Alert.alert(
        "Build started",
        `"${name}" is compiling on the PC — you'll get a notification when it finishes.`,
      );
      watchBuild(slug, name, previousStatus);
    } catch (e) {
      Alert.alert("Build failed to start", e instanceof Error ? e.message : String(e));
    } finally {
      setBuilding(null);
      void load();
    }
  };

  if (!connection) {
    return (
      <View style={styles.center}>
        <Text style={styles.hint}>Connect to a PC first.</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={{ padding: 16, gap: 10 }}
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
      {projects.map((project) => (
        <Card key={project.slug}>
          <Text style={styles.name}>{project.name}</Text>
          <View style={{ flexDirection: "row", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
            <Badge tone="violet">{project.loader ?? "mod"}</Badge>
            <Badge>MC {project.minecraftVersion}</Badge>
            <Badge
              tone={
                project.lastBuildStatus === "success"
                  ? "green"
                  : project.lastBuildStatus === "failed"
                    ? "red"
                    : "amber"
              }
            >
              {project.lastBuildStatus ? `build: ${project.lastBuildStatus}` : "never built"}
            </Badge>
          </View>
          {project.description && (
            <Text style={styles.hint} numberOfLines={2}>
              {project.description}
            </Text>
          )}
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 10 }}>
            <StatusDot on={project.lastBuildStatus === "success"} />
            <VButton
              tone="secondary"
              disabled={building === project.slug}
              onPress={() => void build(project.slug, project.name)}
            >
              {building === project.slug ? "Starting…" : "Build on PC"}
            </VButton>
          </View>
        </Card>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center", padding: 24 },
  name: { color: colors.text, fontSize: 15, fontWeight: "700" },
  hint: { color: colors.muted, fontSize: 12, lineHeight: 17, marginTop: 6 },
});
