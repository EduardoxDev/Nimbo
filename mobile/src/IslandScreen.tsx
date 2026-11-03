import { useEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing, Image, Linking, Pressable, ScrollView, Text, TextInput, View, useWindowDimensions } from "react-native";
import * as Clipboard from "expo-clipboard";
import * as DocumentPicker from "expo-document-picker";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import type { Pairing } from "./pairing";
import { useNimbo, type FileItem, type Status } from "./useNimbo";
import { useIphoneIsland } from "./useIphoneIsland";
import { t } from "./i18n";
import { isInstalledWebApp, subscribeWebPush, webPushAvailable } from "./webPush";
import { Button, Card, clock, colors, Icon, Mascot, Ring, styles } from "./ui";

type Page = "home" | "music" | "focus" | "tasks" | "water" | "notices" | "pc";
const PAGES: { id: Page; color: string }[] = [
  { id: "home", color: colors.blue },
  { id: "music", color: colors.music },
  { id: "focus", color: colors.focus },
  { id: "tasks", color: colors.tasks },
  { id: "water", color: colors.water },
  { id: "notices", color: colors.notices },
  { id: "pc", color: colors.pc },
];

function tap() {
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}

/** The PC island, on the iPhone: a pill that opens into the same pages. */
export function IslandScreen({ pairing, onUnpair }: { pairing: Pairing; onUnpair: () => void }) {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const nimbo = useNimbo(pairing);
  const island = useIphoneIsland(pairing, nimbo.status, nimbo.registerActivityToken);
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState<Page>("home");
  const [toast, setToast] = useState("");
  const grow = useRef(new Animated.Value(0)).current;
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 10_000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    Animated.timing(grow, { toValue: open ? 1 : 0, duration: 420, easing: Easing.bezier(0.32, 0.72, 0, 1), useNativeDriver: false }).start();
  }, [open]);

  const say = (text: string) => {
    setToast(text);
    setTimeout(() => setToast(""), 1600);
  };
  const run = async (action: string, value = "") => {
    tap();
    const ok = await nimbo.send(action, value);
    if (!ok) say(t.failed);
  };

  const status = nimbo.status;
  const pillWidth = Math.min(width * 0.92, 380);
  const openWidth = Math.min(width * 0.96, 430);
  const openHeight = Math.min(height * 0.78, 660);
  const islandStyle = {
    width: grow.interpolate({ inputRange: [0, 1], outputRange: [pillWidth, openWidth] }),
    height: grow.interpolate({ inputRange: [0, 1], outputRange: [46, openHeight] }),
    borderRadius: grow.interpolate({ inputRange: [0, 1], outputRange: [23, 40] }),
  };

  const focus = status?.focus;
  const music = status?.music;
  const pillText = !nimbo.pcOnline && !status ? t.offline : status?.island?.text ?? music?.title ?? "Nimbo";
  const time = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const date = now.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" });

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {/* Lock-screen look behind the island. */}
      <View style={{ position: "absolute", top: insets.top + 130, width: "100%", alignItems: "center", opacity: open ? 0.25 : 1 }}>
        <Text style={{ color: colors.text, fontSize: 84, fontWeight: "700", letterSpacing: -2 }}>{time}</Text>
        <Text style={[styles.muted, { fontSize: 17 }]}>{date.charAt(0).toUpperCase() + date.slice(1)}</Text>
        <Text style={[styles.muted, { marginTop: 26 }]}>
          {nimbo.pcOnline ? `${t.online} · ${nimbo.link === "lan" ? t.viaLan : t.viaRelay}` : t.offline}
        </Text>
        <Text style={[styles.muted, { marginTop: 6 }]}>{t.tap}</Text>
      </View>

      {open && <Pressable style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0 }} onPress={() => setOpen(false)} />}

      <View style={{ position: "absolute", top: insets.top + 6, width: "100%", alignItems: "center" }}>
        <Animated.View style={[{ overflow: "hidden", backgroundColor: colors.island }, islandStyle]}>
          <Pressable
            onPress={() => {
              tap();
              setOpen(!open);
            }}
            style={{ height: 46, flexDirection: "row", alignItems: "center", gap: 9, paddingLeft: 8, paddingRight: 14 }}
          >
            <Mascot svg={status?.mascot} size={30} />
            <Text numberOfLines={1} style={{ flex: 1, color: status?.island?.color ?? colors.text, fontSize: 14, fontWeight: "600" }}>
              {pillText}
            </Text>
            {focus && focus.status !== "idle" ? (
              <Text style={{ color: focus.phase === "focus" ? colors.focus : colors.tasks, fontWeight: "700", fontVariant: ["tabular-nums"] }}>{clock(focus.remainingMs)}</Text>
            ) : music ? (
              <Icon name={music.playing ? "music" : "pause"} size={16} color={colors.music} />
            ) : (
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: nimbo.pcOnline ? colors.tasks : "#8e8e93" }} />
            )}
          </Pressable>

          {open && (
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 14, paddingBottom: 10 }}>
                {PAGES.map((item) => (
                  <Pressable
                    key={item.id}
                    accessibilityLabel={t[item.id]}
                    onPress={() => {
                      tap();
                      setPage(item.id);
                    }}
                    style={{ width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center", backgroundColor: page === item.id ? item.color : "transparent" }}
                  >
                    <Icon name={item.id} color={page === item.id ? "#000" : colors.muted} />
                  </Pressable>
                ))}
              </View>
              <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 14, paddingBottom: 18 }} keyboardShouldPersistTaps="handled">
                <PageView
                  page={page}
                  status={status}
                  cover={nimbo.cover}
                  inbox={nimbo.inbox}
                  files={nimbo.files}
                  fileUrl={nimbo.fileUrl}
                  onSendFile={async () => {
                    const picked = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: false });
                    if (picked.canceled || !picked.assets?.[0]) return;
                    const asset = picked.assets[0];
                    const result = await nimbo.sendFile({ uri: asset.uri, name: asset.name, mimeType: asset.mimeType, size: asset.size });
                    say(result === "ok" ? t.fileSent : result === "too_big" ? t.fileTooBig : result === "no_relay" ? t.filesNeedRelay : t.failed);
                  }}
                  run={run}
                  go={setPage}
                  say={say}
                  island={island}
                  onUnpair={onUnpair}
                  onNotifications={async () => {
                    if (!pairing.relay) return say(t.pushNeedsRelay);
                    try {
                      const subscription = await subscribeWebPush(pairing.relay);
                      say(nimbo.registerWebPush(subscription) ? t.pushOn : t.failed);
                    } catch (error) {
                      say(String(error).includes("denied") ? t.pushDenied : String(error).includes("no_vapid") ? t.pushNoServerKey : t.failed);
                    }
                  }}
                />
              </ScrollView>
            </View>
          )}
        </Animated.View>
      </View>

      {toast ? (
        <View style={{ position: "absolute", bottom: insets.bottom + 24, alignSelf: "center", paddingHorizontal: 16, paddingVertical: 10, backgroundColor: "#000", borderRadius: 999 }}>
          <Text style={{ color: colors.text }}>{toast}</Text>
        </View>
      ) : null}
    </View>
  );
}

function PageView({
  page,
  status,
  cover,
  inbox,
  files,
  fileUrl,
  onSendFile,
  run,
  go,
  say,
  island,
  onUnpair,
  onNotifications,
}: {
  page: Page;
  status: Status | null;
  cover: string | null;
  inbox: { id: number; text: string }[];
  files: FileItem[];
  fileUrl: (id: string) => string | null;
  onSendFile: () => void;
  run: (action: string, value?: string) => Promise<void>;
  go: (page: Page) => void;
  say: (text: string) => void;
  island: ReturnType<typeof useIphoneIsland>;
  onUnpair: () => void;
  onNotifications: () => void;
}) {
  const [draft, setDraft] = useState("");
  const [newTask, setNewTask] = useState("");
  const focus = status?.focus ?? { status: "idle" as const, phase: "focus", remainingMs: 0, totalMs: 1 };
  const water = status?.water ?? { drankMl: 0, goalMl: 2000 };
  const tasks = status?.tasks ?? [];
  const music = status?.music;
  const openCount = useMemo(() => tasks.filter((task) => !task.completed).length, [tasks]);

  if (page === "home") {
    const hour = new Date().getHours();
    const greeting = t.hello[hour < 5 ? 0 : hour < 12 ? 1 : hour < 18 ? 2 : 3];
    return (
      <>
        <Card style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
          <Mascot svg={status?.mascot} size={64} />
          <View>
            <Text style={styles.big}>{greeting}</Text>
            <Text style={styles.muted}>{status?.pc ?? ""}</Text>
          </View>
        </Card>
        {status?.approval ? (
          <Card style={{ borderWidth: 1, borderColor: colors.ai }}>
            <Text style={[styles.label, { color: colors.ai }]}>{t.approvalTitle(status.approval.agent)}</Text>
            <Text style={{ color: colors.text, fontSize: 16, marginBottom: 12 }}>{status.approval.question}</Text>
            <View style={styles.row}>
              <Button label={t.deny} onPress={async () => { await run("deny", status.approval!.id); say(t.denied); }} />
              <Button label={t.approve} accent={colors.ai} onPress={async () => { await run("approve", status.approval!.id); say(t.approved); }} />
            </View>
          </Card>
        ) : null}
        <View style={styles.row}>
          {[
            { id: "tasks" as Page, value: String(openCount), label: t.pending, color: colors.tasks },
            { id: "water" as Page, value: `${Math.round((water.drankMl / Math.max(1, water.goalMl)) * 100)}%`, label: t.ofGoal, color: colors.water },
            { id: "focus" as Page, value: focus.status === "idle" ? "—" : clock(focus.remainingMs), label: t.focus, color: colors.focus },
          ].map((chip) => (
            <Pressable key={chip.id} onPress={() => go(chip.id)} style={{ flex: 1, padding: 12, borderRadius: 18, backgroundColor: colors.card }}>
              <Text style={{ color: chip.color, fontSize: 18, fontWeight: "700" }}>{chip.value}</Text>
              <Text style={styles.muted}>{chip.label}</Text>
            </Pressable>
          ))}
        </View>
        {status?.handoff && /^https?:\/\//.test(status.handoff.url) ? (
          <Card style={{ marginTop: 10 }}>
            <Text style={styles.label}>{t.continueHere}</Text>
            <Text numberOfLines={2} style={{ color: colors.text, fontWeight: "700", marginBottom: 2 }}>{status.handoff.title}</Text>
            {status.handoff.subtitle ? <Text style={[styles.muted, { marginBottom: 10 }]}>{status.handoff.subtitle}</Text> : null}
            <View style={styles.row}>
              <Button label={t.openLink} accent={colors.blue} onPress={() => void Linking.openURL(status.handoff!.url)} />
            </View>
          </Card>
        ) : null}
        {status?.now ? (
          <Card style={{ marginTop: 10 }}>
            <Text style={styles.label}>{t.onPcNow}</Text>
            <Text style={{ color: colors.text, fontWeight: "700" }}>{status.now.app}</Text>
            {status.now.title ? <Text numberOfLines={2} style={styles.muted}>{status.now.title}</Text> : null}
            {status.now.url && /^https?:\/\//.test(status.now.url) ? (
              <View style={[styles.row, { marginTop: 10 }]}>
                <Button label={t.openLink} accent={colors.blue} onPress={() => void Linking.openURL(status.now!.url!)} />
              </View>
            ) : null}
          </Card>
        ) : null}
        {status?.clipboard ? (
          <Card style={{ marginTop: 10 }}>
            <Text style={styles.label}>{t.copiedOnPc}</Text>
            <Text selectable numberOfLines={4} style={{ color: colors.text, marginBottom: 10 }}>{status.clipboard.text}</Text>
            <View style={styles.row}>
              {/^https?:\/\/\S+$/.test(status.clipboard.text.trim()) ? (
                <Button label={t.openLink} accent={colors.blue} onPress={() => void Linking.openURL(status.clipboard!.text.trim())} />
              ) : null}
              <Button label={t.copy} onPress={async () => { await Clipboard.setStringAsync(status.clipboard!.text); say(t.copied); }} />
            </View>
          </Card>
        ) : null}
        {(status?.readLater ?? []).length > 0 ? (
          <Card style={{ marginTop: 10 }}>
            <Text style={styles.label}>{t.readLater}</Text>
            {(status?.readLater ?? []).slice(0, 5).map((item) => (
              <View key={item.id} style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 6 }}>
                <Pressable style={{ flex: 1 }} onPress={() => void Linking.openURL(item.url)}>
                  <Text numberOfLines={1} style={{ color: colors.blue }}>{item.url.replace(/^https?:\/\/(www\.)?/, "")}</Text>
                </Pressable>
                <Pressable hitSlop={10} onPress={() => void run("read_later_done", item.id)}>
                  <Text style={styles.muted}>{t.readDone}</Text>
                </Pressable>
              </View>
            ))}
          </Card>
        ) : null}
        {music && (
          <Pressable onPress={() => go("music")}>
            <Card style={{ marginTop: 10, flexDirection: "row", alignItems: "center", gap: 12 }}>
              {cover ? <Image source={{ uri: cover }} style={{ width: 44, height: 44, borderRadius: 10 }} /> : <Icon name="music" color={colors.music} />}
              <View style={{ flex: 1 }}>
                <Text numberOfLines={1} style={{ color: colors.text, fontWeight: "700" }}>{music.title}</Text>
                <Text numberOfLines={1} style={styles.muted}>{music.artist ?? ""}</Text>
              </View>
            </Card>
          </Pressable>
        )}
        {(status?.notices ?? []).map((notice) => (
          <Card key={notice}>
            <Text style={{ color: colors.text }}>{notice}</Text>
          </Card>
        ))}
      </>
    );
  }

  if (page === "music") {
    if (!music) return <Card><Text style={styles.big}>{t.nothing}</Text></Card>;
    const position = music.positionMs ?? 0;
    const duration = music.durationMs ?? 0;
    return (
      <>
        <View style={{ aspectRatio: 1, marginBottom: 14, overflow: "hidden", borderRadius: 24, backgroundColor: "#1a0d14" }}>
          {cover ? <Image source={{ uri: cover }} style={{ width: "100%", height: "100%" }} /> : null}
        </View>
        <Text numberOfLines={1} style={styles.big}>{music.title}</Text>
        <Text numberOfLines={1} style={styles.muted}>{music.artist ?? ""}</Text>
        {duration > 0 && (
          <>
            <View style={{ height: 5, marginTop: 12, marginBottom: 6, overflow: "hidden", borderRadius: 3, backgroundColor: "rgba(255,255,255,0.12)" }}>
              <View style={{ width: `${Math.min(100, (position / duration) * 100)}%`, height: "100%", backgroundColor: colors.music }} />
            </View>
            <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
              <Text style={styles.muted}>{clock(position)}</Text>
              <Text style={styles.muted}>{clock(duration)}</Text>
            </View>
          </>
        )}
        <View style={{ flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 26, marginTop: 12 }}>
          <Pressable onPress={() => void run("previous")} hitSlop={12}><Icon name="prev" size={28} /></Pressable>
          <Pressable onPress={() => void run("play_pause")} style={{ width: 68, height: 68, borderRadius: 34, alignItems: "center", justifyContent: "center", backgroundColor: "#fff" }}>
            <Icon name={music.playing ? "pause" : "play"} size={28} color="#000" />
          </Pressable>
          <Pressable onPress={() => void run("next")} hitSlop={12}><Icon name="next" size={28} /></Pressable>
        </View>
      </>
    );
  }

  if (page === "focus") {
    const left = focus.status === "idle" ? focus.totalMs : focus.remainingMs;
    const progress = focus.totalMs ? 1 - left / focus.totalMs : 0;
    return (
      <>
        <View style={{ alignItems: "center", marginVertical: 8 }}>
          <Ring size={220} progress={progress} color={focus.phase === "focus" ? colors.focus : colors.tasks} />
          <View style={{ position: "absolute", top: 0, bottom: 0, alignItems: "center", justifyContent: "center" }}>
            <Text style={{ color: colors.text, fontSize: 46, fontWeight: "700", fontVariant: ["tabular-nums"] }}>{clock(left)}</Text>
            <Text style={styles.muted}>{focus.status === "idle" ? t.focusIdle : focus.phase === "focus" ? t.focusLabel : t.breakLabel}</Text>
          </View>
        </View>
        <View style={[styles.row, { marginTop: 14 }]}>
          {focus.status === "running" ? (
            <Button label={t.pause} accent={colors.focus} onPress={() => void run("focus_pause")} />
          ) : (
            <Button label={t.start} accent={colors.focus} onPress={() => void run("focus_start")} />
          )}
          <Button label={t.skip} onPress={() => void run("focus_skip")} />
        </View>
      </>
    );
  }

  if (page === "tasks") {
    return (
      <Card>
        {tasks.length === 0 ? <Text style={styles.muted}>{t.noTasks}</Text> : null}
        {tasks.map((task) => (
          <Pressable key={task.id} onPress={() => void run("task_toggle", task.id)} style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.line }}>
            <View style={{ width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: task.completed ? colors.tasks : "rgba(255,255,255,0.35)", backgroundColor: task.completed ? colors.tasks : "transparent" }}>
              {task.completed ? <Icon name="check" size={14} color="#000" /> : null}
            </View>
            <Text style={{ flex: 1, color: task.completed ? colors.muted : colors.text, textDecorationLine: task.completed ? "line-through" : "none" }}>{task.title}</Text>
          </Pressable>
        ))}
        <View style={[styles.row, { marginTop: 12 }]}>
          <TextInput value={newTask} onChangeText={setNewTask} placeholder={t.newTask} placeholderTextColor={colors.muted} style={[styles.input, { flex: 1 }]} returnKeyType="done"
            onSubmitEditing={() => { if (newTask.trim()) { void run("task_add", newTask.trim()); setNewTask(""); } }} />
          <Button label={t.add} accent={colors.tasks} style={{ flex: 0, paddingHorizontal: 16 }} onPress={() => { if (newTask.trim()) { void run("task_add", newTask.trim()); setNewTask(""); } }} />
        </View>
      </Card>
    );
  }

  if (page === "water") {
    const percent = Math.min(100, (water.drankMl / Math.max(1, water.goalMl)) * 100);
    return (
      <Card style={{ alignItems: "center" }}>
        <View style={{ width: 120, height: 160, marginVertical: 8, overflow: "hidden", borderWidth: 3, borderTopWidth: 0, borderColor: "rgba(255,255,255,0.35)", borderBottomLeftRadius: 26, borderBottomRightRadius: 26, justifyContent: "flex-end" }}>
          <View style={{ height: `${percent}%`, backgroundColor: colors.water }} />
        </View>
        <Text style={styles.big}>{water.drankMl} ml</Text>
        <Text style={styles.muted}>{t.drankOf} {water.goalMl} ml</Text>
        <View style={[styles.row, { marginTop: 14, alignSelf: "stretch" }]}>
          <Button label={t.addGlass} accent={colors.water} onPress={() => void run("water_add")} />
        </View>
      </Card>
    );
  }

  if (page === "notices") {
    return (
      <>
        <Card>
          {(status?.notices ?? []).length === 0 ? <Text style={styles.muted}>{t.noNotices}</Text> : (status?.notices ?? []).map((notice) => <Text key={notice} style={{ color: colors.text, paddingVertical: 8 }}>{notice}</Text>)}
        </Card>
        <Card>
          <Text style={styles.label}>{t.sendTitle}</Text>
          <TextInput value={draft} onChangeText={setDraft} placeholder={t.sendPlaceholder} placeholderTextColor={colors.muted} multiline style={[styles.input, { minHeight: 84, paddingTop: 12, textAlignVertical: "top" }]} />
          <View style={[styles.row, { marginTop: 8 }]}>
            {/^https?:\/\/\S+$/.test(draft.trim()) ? (
              <Button label={t.saveForLater} onPress={async () => { await run("read_later_add", draft.trim()); setDraft(""); say(t.savedForLater); }} />
            ) : null}
            <Button label={t.send} accent={colors.blue} onPress={async () => { if (!draft.trim()) return; await run("send_text", draft); setDraft(""); say(t.sent); }} />
          </View>
        </Card>
        <Card>
          <Text style={styles.label}>{t.filesTitle}</Text>
          {files.filter((file) => file.from === "pc").length === 0 ? <Text style={[styles.muted, { marginBottom: 10 }]}>{t.filesEmpty}</Text> : null}
          {files
            .filter((file) => file.from === "pc")
            .map((file) => (
              <Pressable
                key={file.id}
                onPress={() => {
                  const url = fileUrl(file.id);
                  if (url) void Linking.openURL(url);
                }}
                style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8 }}
              >
                <Text style={{ fontSize: 18 }}>📎</Text>
                <View style={{ flex: 1 }}>
                  <Text numberOfLines={1} style={{ color: colors.text, fontWeight: "600" }}>{file.name}</Text>
                  <Text style={styles.muted}>{file.size >= 1048576 ? `${(file.size / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(file.size / 1024))} KB`}</Text>
                </View>
              </Pressable>
            ))}
          <View style={[styles.row, { marginTop: 6 }]}>
            <Button label={t.sendFile} accent={colors.blue} onPress={onSendFile} />
          </View>
        </Card>
        <Card>
          <Text style={styles.label}>{t.fromPc}</Text>
          {inbox.length === 0 ? <Text style={styles.muted}>{t.empty}</Text> : inbox.map((item) => <Text key={item.id} selectable style={{ color: colors.text, paddingVertical: 8 }}>{item.text}</Text>)}
        </Card>
      </>
    );
  }

  return (
    <>
      <Card>
        <Text style={styles.label}>{t.remote}</Text>
        <View style={{ flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 26, marginBottom: 14 }}>
          <Pressable onPress={() => void run("previous")} hitSlop={12}><Icon name="prev" size={26} /></Pressable>
          <Pressable onPress={() => void run("play_pause")} style={{ width: 60, height: 60, borderRadius: 30, alignItems: "center", justifyContent: "center", backgroundColor: "#fff" }}>
            <Icon name={music?.playing ? "pause" : "play"} size={24} color="#000" />
          </Pressable>
          <Pressable onPress={() => void run("next")} hitSlop={12}><Icon name="next" size={26} /></Pressable>
        </View>
        <View style={styles.row}>
          <Button label={t.lock} danger onPress={() => void run("lock")} />
          <Button label={t.cancelShutdown} onPress={() => void run("shutdown_cancel")} />
        </View>
        <View style={[styles.row, { marginTop: 8 }]}>
          <Button label={t.ring} accent={colors.pc} onPress={async () => { await run("ring"); say(t.rang); }} />
        </View>
      </Card>
      {webPushAvailable() || isInstalledWebApp() ? (
        <Card>
          <Text style={styles.label}>{t.pushTitle}</Text>
          <Text style={[styles.muted, { marginBottom: 10 }]}>{isInstalledWebApp() ? t.pushHint : t.pushInstall}</Text>
          {isInstalledWebApp() && (
            <View style={styles.row}>
              <Button label={t.pushButton} accent={colors.pc} onPress={onNotifications} />
            </View>
          )}
        </Card>
      ) : null}
      <Card>
        <Text style={styles.label}>{t.islandTitle}</Text>
        <Text style={[styles.muted, { marginBottom: 10 }]}>{island.supported ? t.islandHint : t.islandUnsupported}</Text>
        {island.supported && (
          <View style={styles.row}>
            {island.running ? <Button label={t.islandOff} onPress={() => void island.stop()} /> : <Button label={t.islandOn} accent={colors.pc} onPress={() => void island.start()} />}
          </View>
        )}
        <Text style={[styles.muted, { marginTop: 10 }]}>{t.widgetsHint}</Text>
      </Card>
      <Button label={t.unpair} onPress={onUnpair} style={{ marginTop: 4 }} />
    </>
  );
}
