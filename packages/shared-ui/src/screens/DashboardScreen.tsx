import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Image, StyleSheet, View, Text } from 'react-native';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { SpatialNavigationRoot, DefaultFocus } from 'react-tv-space-navigation';
import RemoteControlManager from '../app/remote-control/RemoteControlManager';
import { SupportedKeys } from '../app/remote-control/SupportedKeys';
import { RootStackParamList } from '../navigation/types';
import { demoVideo } from '../dashboard/demoVideo';
import { scaledPixels } from '../hooks/useScale';
import { colors, safeZones } from '../theme';
import FocusablePressable from '../components/FocusablePressable';
import { dashboardConfig } from '../dashboard/config';
import { describeWeather, fetchWeather, Weather } from '../dashboard/weather';
import { api, HubState, Kitchen, Score } from '../dashboard/api';
import { readOverlayStatus, OverlayStatus } from '../dashboard/overlayStatus';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const SHORT_MONTHS = MONTHS.map((m) => m.slice(0, 3));

const pad = (n: number) => String(n).padStart(2, '0');

// The household runs on the server's clock (the dev server can shift it for demos), so the TV clock
// follows it: offset = server time - device time, rounded to whole minutes.
function serverClockOffset(server: { date: string; time: string } | undefined): number {
  if (!server) return 0;
  const serverMs = new Date(`${server.date}T${server.time}:00`).getTime();
  if (!Number.isFinite(serverMs)) return 0;
  const deviceMinute = Math.floor(Date.now() / 60000) * 60000;
  return Math.round((serverMs - deviceMinute) / 60000) * 60000;
}

function useNow(offsetMs: number) {
  const [now, setNow] = useState(new Date(Date.now() + offsetMs));
  useEffect(() => {
    setNow(new Date(Date.now() + offsetMs));
    const id = setInterval(() => setNow(new Date(Date.now() + offsetMs)), 1000);
    return () => clearInterval(id);
  }, [offsetMs]);
  return now;
}

const RETRY_MS = 15 * 1000;

// Loads data now and again every intervalMs; after a failure it retries sooner.
// The last good data is kept, and the error is exposed next to it.
function usePolling<T>(load: () => Promise<T>, intervalMs: number) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;
    const run = () => {
      loadRef.current()
        .then((d) => {
          if (cancelled) return;
          setData(d);
          setError(null);
          timer = setTimeout(run, intervalMs);
        })
        .catch((e: Error) => {
          if (cancelled) return;
          setError(e.message);
          timer = setTimeout(run, RETRY_MS);
        });
    };
    run();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [intervalMs]);
  return { data, error, setData };
}

function Card({ title, style, children }: { title: string; style?: object; children: React.ReactNode }) {
  return (
    <View style={[styles.card, style]}>
      <Text style={styles.cardTitle}>{title}</Text>
      {children}
    </View>
  );
}

function PanelStatus({ error }: { error: string | null }) {
  return error ? <Text style={styles.errorText}>{error}</Text> : <Text style={styles.mutedText}>Loading…</Text>;
}

function ClockPanel({ now }: { now: Date }) {
  return (
    <View>
      <Text style={styles.clock}>
        {pad(now.getHours())}:{pad(now.getMinutes())}
      </Text>
      <Text style={styles.date}>
        {WEEKDAYS[now.getDay()]}, {MONTHS[now.getMonth()]} {now.getDate()}
      </Text>
    </View>
  );
}

function BriefingPanel({ comment, error }: { comment: string | null; error: string | null }) {
  const opacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!comment) return;
    opacity.setValue(0);
    Animated.timing(opacity, { toValue: 1, duration: 800, useNativeDriver: true }).start();
  }, [comment, opacity]);

  return (
    <View style={styles.briefing}>
      <Text style={styles.briefingLabel}>✦ Today's take</Text>
      {comment ? (
        <Animated.Text style={[styles.briefingText, { opacity }]} numberOfLines={3}>
          {comment}
        </Animated.Text>
      ) : (
        <PanelStatus error={error} />
      )}
    </View>
  );
}

function WeatherPanel({ weather, error, locationName }: { weather: Weather | null; error: string | null; locationName: string }) {
  const title = `Weather · ${locationName}`;
  if (!weather) {
    return (
      <Card title={title} style={styles.weatherCard}>
        <PanelStatus error={error} />
      </Card>
    );
  }
  const current = describeWeather(weather.currentCode);
  const [today] = weather.daily;
  return (
    <Card title={title} style={styles.weatherCard}>
      <View style={styles.weatherNow}>
        <Text style={styles.weatherIcon}>{current.icon}</Text>
        <View>
          <Text style={styles.weatherTemp}>{Math.round(weather.currentTemp)}°</Text>
          <Text style={styles.weatherLabel}>{current.label}</Text>
        </View>
      </View>
      <Text style={styles.weatherToday}>
        High {Math.round(today.max)}° · Low {Math.round(today.min)}°
      </Text>
      <Text style={styles.weatherToday}>Rain {today.rainChance}%</Text>
    </Card>
  );
}

function QrPanel() {
  const { data, error } = usePolling(api.qr, 60 * 60 * 1000);
  return (
    <Card title="Add a photo" style={styles.qrCard}>
      {data ? <Image source={{ uri: data.dataUrl }} style={styles.qrImage} /> : <PanelStatus error={error} />}
      <Text style={styles.qrHint}>Notices · receipts</Text>
    </Card>
  );
}

const MAX_SCHEDULE_ROWS = 6;

function SchedulePanel({ state, error }: { state: HubState | null; error: string | null }) {
  const hidden = state ? Math.max(0, state.schedule.length - MAX_SCHEDULE_ROWS) : 0;
  return (
    <Card title="Today" style={styles.listCard}>
      {!state ? (
        <PanelStatus error={error} />
      ) : (
        <>
          {state.schedule.slice(0, MAX_SCHEDULE_ROWS).map((item) => (
            <View key={item.id} style={styles.row}>
              <Text style={[styles.rowTime, item.past && styles.pastText, item.soon && styles.soonText]}>
                {item.time ?? 'All day'}
              </Text>
              <View style={styles.rowTitleBlock}>
                <Text style={[styles.rowTitle, styles.rowTitleInBlock, item.past && styles.pastText]} numberOfLines={1}>
                  {item.title}
                </Text>
                {item.leaveAt && !item.past && (
                  <Text style={[styles.rowNote, item.departedAt ? styles.leftText : null]} numberOfLines={1}>
                    {item.departedAt ? `Left at ${item.departedAt}` : `Leave by ${item.leaveAt}`}
                  </Text>
                )}
              </View>
              <Text style={styles.rowWho}>{item.who}</Text>
            </View>
          ))}
          {hidden > 0 && <Text style={styles.mutedText}>+{hidden} more</Text>}
          {state.upcoming.length > 0 && hidden === 0 && (
            <>
              <Text style={[styles.cardTitle, styles.subTitle]}>Coming up</Text>
              {state.upcoming.slice(0, 2).map((item) => {
                const [, m, d] = item.date.split('-').map(Number);
                return (
                  <View key={item.id} style={styles.row}>
                    <Text style={styles.rowDate}>
                      {SHORT_MONTHS[m - 1]} {d}
                    </Text>
                    <Text style={styles.rowTitle} numberOfLines={1}>
                      {item.title}
                    </Text>
                    <Text style={styles.rowWho}>{item.who}</Text>
                  </View>
                );
              })}
            </>
          )}
        </>
      )}
    </Card>
  );
}

function Scoreboard({ board }: { board: Score[] }) {
  if (board.length === 0) return <Text style={styles.scoreEmpty}>No points yet this week</Text>;
  return (
    <View style={styles.scoreRow}>
      {board.slice(0, 4).map((s, i) => (
        <View key={s.who} style={styles.scoreItem}>
          <Text style={[styles.scoreName, i === 0 && styles.scoreLeader]}>{i === 0 ? '★ ' : ''}{s.who}</Text>
          <Text style={[styles.scoreValue, i === 0 && styles.scoreLeader]}>{s.score}</Text>
        </View>
      ))}
    </View>
  );
}

function TodoPanel({ state, error }: { state: HubState | null; error: string | null }) {
  const todos = state
    ? [...state.todos]
        .sort((a, b) => Number(a.done) - Number(b.done) || (b.doneAt ?? '').localeCompare(a.doneAt ?? ''))
        .slice(0, 6)
    : [];
  return (
    <Card title="To-do" style={styles.listCard}>
      {!state ? (
        <PanelStatus error={error} />
      ) : (
        <>
          {todos.map((item) => (
            <View key={item.id} style={styles.row}>
              <Text style={[styles.check, item.done && styles.checkDone]}>{item.done ? '✓' : '○'}</Text>
              <Text style={[styles.rowTitle, item.done && styles.pastText]} numberOfLines={1}>
                {item.title}
              </Text>
              <Text style={styles.rowWho}>{item.done && item.doneBy ? item.doneBy : item.who}</Text>
            </View>
          ))}
          <Text style={[styles.cardTitle, styles.subTitle]}>This week's chore scoreboard</Text>
          <Scoreboard board={state.scoreboard} />
        </>
      )}
    </Card>
  );
}

function freshnessLabel(daysLeft: number) {
  if (daysLeft <= 0) return 'use today';
  if (daysLeft === 1) return '1 day';
  return `${daysLeft} days`;
}

function KitchenPanel() {
  const { data, error, setData } = usePolling(api.kitchen, 60 * 1000);
  const [cookError, setCookError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const onCooked = useCallback(() => {
    if (!data?.idea || inFlight.current) return;
    inFlight.current = true;
    api
      .cooked(data.idea.uses)
      .then((k: Kitchen) => {
        setData(k);
        setCookError(null);
      })
      .catch((e: Error) => setCookError(e.message))
      .finally(() => {
        inFlight.current = false;
      });
  }, [data, setData]);

  return (
    <Card title="Probably at home" style={styles.listCard}>
      {!data ? (
        <PanelStatus error={error} />
      ) : (
        <>
          {data.items.slice(0, 4).map((item) => (
            <View key={item.id} style={[styles.row, styles.compactRow, { opacity: 0.4 + item.likelihood * 0.6 }]}>
              <Text style={styles.rowTitle} numberOfLines={1}>
                {item.name}
              </Text>
              <Text style={[styles.rowWho, item.daysLeft <= 1 && styles.urgentText]}>
                {freshnessLabel(item.daysLeft)}
              </Text>
            </View>
          ))}
          {data.idea && (
            <View style={styles.idea}>
              <Text style={styles.ideaLabel}>Tonight</Text>
              <Text style={styles.ideaTitle} numberOfLines={1}>
                {data.idea.title}
              </Text>
              <Text style={styles.ideaNote} numberOfLines={2}>
                {data.idea.note}
              </Text>
              <DefaultFocus>
                <FocusablePressable text="We cooked this" onSelect={onCooked} style={styles.cookButton} />
              </DefaultFocus>
              {cookError && <Text style={styles.errorText}>{cookError}</Text>}
            </View>
          )}
        </>
      )}
    </Card>
  );
}

function OverlayWarning() {
  const [status, setStatus] = useState<OverlayStatus | null>(readOverlayStatus());
  useEffect(() => {
    const id = setInterval(() => setStatus(readOverlayStatus()), 10 * 1000);
    return () => clearInterval(id);
  }, []);
  if (!status || status.ok) return null;
  return <Text style={[styles.errorText, styles.overlayWarning]}>Breaking news: {status.message}</Text>;
}

function useWeather(location: { latitude: number; longitude: number; timezone?: string }) {
  const load = useCallback(() => fetchWeather(location), [location.latitude, location.longitude, location.timezone]);
  const { data, error } = usePolling(load, dashboardConfig.weatherRefreshMs);
  return { weather: data, error };
}

export default function DashboardScreen() {
  const isFocused = useIsFocused();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const hub = usePolling(api.state, 30 * 1000);
  // Computed once per response (not per render), so a minute boundary cannot skew it.
  const clockOffset = useMemo(() => serverClockOffset(hub.data?.now), [hub.data]);
  const now = useNow(clockOffset);
  const location = hub.data?.location ?? dashboardConfig.location;
  const { weather, error: weatherError } = useWeather(location);
  // The server asks Amazon Nova again only when the day's situation changed.
  const briefing = usePolling(api.briefing, 60 * 1000);

  // Play/pause on the remote opens a programme (a CC-licensed film), so the breaking-news ticker
  // can be filmed over "what the family is watching" without showing third-party apps.
  useEffect(() => {
    if (!isFocused) return;
    const listener = RemoteControlManager.addKeydownListener((key: SupportedKeys) => {
      if (key === SupportedKeys.PlayPause) navigation.navigate('Player', demoVideo);
    });
    return () => RemoteControlManager.removeKeydownListener(listener);
  }, [isFocused, navigation]);

  return (
    <SpatialNavigationRoot isActive={isFocused}>
      <View style={styles.container}>
        <View style={styles.topRow}>
          <View style={styles.leftColumn}>
            <ClockPanel now={now} />
            <BriefingPanel comment={briefing.data?.comment ?? null} error={briefing.error} />
          </View>
          <WeatherPanel weather={weather} error={weatherError} locationName={location.name} />
          <QrPanel />
        </View>
        <View style={styles.bottomRow}>
          <SchedulePanel state={hub.data} error={hub.error} />
          <TodoPanel state={hub.data} error={hub.error} />
          <KitchenPanel />
        </View>
        <OverlayWarning />
      </View>
    </SpatialNavigationRoot>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    paddingHorizontal: scaledPixels(safeZones.titleSafe.horizontal),
    paddingVertical: scaledPixels(safeZones.titleSafe.vertical),
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: scaledPixels(32),
    marginBottom: scaledPixels(32),
  },
  leftColumn: {
    flex: 1,
  },
  bottomRow: {
    flex: 1,
    flexDirection: 'row',
    gap: scaledPixels(32),
  },
  clock: {
    color: colors.text,
    fontSize: scaledPixels(170),
    fontWeight: '200',
    lineHeight: scaledPixels(186),
  },
  date: {
    color: colors.textSecondary,
    fontSize: scaledPixels(44),
  },
  briefing: {
    marginTop: scaledPixels(24),
    paddingLeft: scaledPixels(24),
    borderLeftWidth: scaledPixels(4),
    borderLeftColor: colors.secondary,
  },
  briefingLabel: {
    color: colors.secondary,
    fontSize: scaledPixels(24),
    fontWeight: '600',
    letterSpacing: scaledPixels(1),
    marginBottom: scaledPixels(6),
  },
  briefingText: {
    color: colors.text,
    fontSize: scaledPixels(32),
    lineHeight: scaledPixels(44),
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: scaledPixels(24),
    paddingHorizontal: scaledPixels(32),
    paddingVertical: scaledPixels(24),
  },
  cardTitle: {
    color: colors.textTertiary,
    fontSize: scaledPixels(26),
    fontWeight: '600',
    letterSpacing: scaledPixels(1),
    marginBottom: scaledPixels(8),
  },
  subTitle: {
    marginTop: scaledPixels(18),
  },
  weatherCard: {
    width: scaledPixels(440),
  },
  weatherNow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: scaledPixels(20),
  },
  weatherIcon: {
    fontSize: scaledPixels(80),
  },
  weatherTemp: {
    color: colors.text,
    fontSize: scaledPixels(76),
    fontWeight: '300',
  },
  weatherLabel: {
    color: colors.textSecondary,
    fontSize: scaledPixels(30),
  },
  weatherToday: {
    color: colors.textSecondary,
    fontSize: scaledPixels(28),
    marginTop: scaledPixels(10),
  },
  qrCard: {
    width: scaledPixels(280),
    alignItems: 'center',
  },
  qrImage: {
    width: scaledPixels(210),
    height: scaledPixels(210),
    borderRadius: scaledPixels(8),
  },
  qrHint: {
    color: colors.textTertiary,
    fontSize: scaledPixels(22),
    marginTop: scaledPixels(10),
  },
  listCard: {
    flex: 1,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: scaledPixels(9),
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
    gap: scaledPixels(16),
  },
  compactRow: {
    paddingVertical: scaledPixels(6),
  },
  rowTime: {
    color: colors.info,
    fontSize: scaledPixels(30),
    fontWeight: '600',
    width: scaledPixels(100),
  },
  rowDate: {
    color: colors.textSecondary,
    fontSize: scaledPixels(28),
    fontWeight: '600',
    width: scaledPixels(100),
  },
  rowTitleBlock: {
    flex: 1,
  },
  rowTitle: {
    flex: 1,
    color: colors.text,
    fontSize: scaledPixels(30),
  },
  rowTitleInBlock: {
    flex: 0,
  },
  rowNote: {
    color: colors.warning,
    fontSize: scaledPixels(22),
  },
  leftText: {
    color: colors.success,
  },
  scoreRow: {
    flexDirection: 'row',
    gap: scaledPixels(28),
    marginTop: scaledPixels(4),
  },
  scoreItem: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: scaledPixels(8),
  },
  scoreName: {
    color: colors.textSecondary,
    fontSize: scaledPixels(26),
  },
  scoreValue: {
    color: colors.text,
    fontSize: scaledPixels(34),
    fontWeight: '700',
  },
  scoreLeader: {
    color: colors.warning,
  },
  scoreEmpty: {
    color: colors.textTertiary,
    fontSize: scaledPixels(24),
  },
  rowWho: {
    color: colors.textTertiary,
    fontSize: scaledPixels(26),
  },
  pastText: {
    color: colors.textTertiary,
  },
  soonText: {
    color: colors.warning,
  },
  urgentText: {
    color: colors.warning,
    fontWeight: '600',
  },
  check: {
    color: colors.textTertiary,
    fontSize: scaledPixels(30),
    width: scaledPixels(36),
  },
  checkDone: {
    color: colors.success,
  },
  idea: {
    marginTop: scaledPixels(16),
  },
  ideaLabel: {
    color: colors.secondary,
    fontSize: scaledPixels(24),
    fontWeight: '600',
  },
  ideaTitle: {
    color: colors.text,
    fontSize: scaledPixels(32),
    fontWeight: '600',
    marginTop: scaledPixels(2),
  },
  ideaNote: {
    color: colors.textSecondary,
    fontSize: scaledPixels(24),
    marginTop: scaledPixels(4),
  },
  cookButton: {
    marginTop: scaledPixels(12),
    paddingVertical: scaledPixels(10),
    minHeight: scaledPixels(50),
  },
  overlayWarning: {
    position: 'absolute',
    left: scaledPixels(safeZones.titleSafe.horizontal),
    bottom: scaledPixels(12),
    fontSize: scaledPixels(22),
  },
  mutedText: {
    color: colors.textTertiary,
    fontSize: scaledPixels(26),
  },
  errorText: {
    color: colors.error,
    fontSize: scaledPixels(26),
  },
});
