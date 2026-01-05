// App.tsx
// Expo + React Native — Single-file prototype
// UPDATED for: email-only OTP via backend (Firebase Cloud Functions recommended)
// IMPORTANT:
// - Do NOT generate OTP on the client.
// - Do NOT put any Gmail/App passwords in this app.
// - Set API_BASE_URL to your deployed Cloud Functions base URL, e.g.
//   https://us-central1-YOUR_PROJECT_ID.cloudfunctions.net
// Backend endpoints expected:
//   POST {API_BASE_URL}/sendOtp   body: { toEmail: string }
//   POST {API_BASE_URL}/verifyOtp body: { toEmail: string, code: string }

import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Image,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as Location from 'expo-location';
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';

/**
 * EMAIL OTP (SECURE FLOW):
 * - Client calls /sendOtp with { toEmail }
 * - Server generates OTP, stores hash+expiry (Firestore), emails code
 * - Client calls /verifyOtp with { toEmail, code }
 * - Server validates, returns ok:true if correct
 */
const API_BASE_URL = ''; // ex: "https://us-central1-your-project-id.cloudfunctions.net"
const OTP_SENDER_EMAIL = 'jyamin205@gmail.com'; // informational only (sender is your backend)

const PLATFORM_FEE_PCT = 0.02;
const BASE_LABOR_RATE = 65;

const COLORS = {
  bg: '#0E0E0E',
  card: '#161616',
  card2: '#1D1D1D',
  border: 'rgba(255,255,255,0.12)',
  text: '#FFFFFF',
  muted: 'rgba(255,255,255,0.72)',
  primary: '#FF7A18',
  primary2: '#FF9A3D',
  danger: '#FF3B30',
};

import LOGO from './assets/logo.png';

const money = (n: number) => `$${Number(n || 0).toFixed(2)}`;

type Coords = { latitude: number; longitude: number } | null;
type Role = 'customer' | 'pro';

type Privacy = {
  hideEmail: boolean;
  hidePhone: boolean;
  hideLocation: boolean;
};

type PaymentMethod = {
  id: string;
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
};

type User = {
  id: string;
  role: Role;
  email: string;
  phone: string;
  password: string;
  verified: boolean;
  pinHash: string | null; // for Payment Methods lock
  profile: {
    fullName: string;
    trades: string[];
    tradesLocked: boolean;

    score: number; // 0..100
    ratingsCount: number;
    jobsDone: number;

    photoUri: string | null;
    privacy: Privacy;
    lastCoords: Coords;

    cards: PaymentMethod[]; // customer card vault (prototype)
    walletBalance: number; // pro wallet (prototype)
  };
};

type Service = {
  id: string;
  trade: string;
  name: string;
  summary: string;
  typicalMinutes: { low: number; high: number };
  minVisit: number;
  partsAllowance: number;
};

type MatchMode = 'direct' | 'broadcast';

type PartLine = { id: string; name: string; qty: number; unit: number };

type Invoice = {
  laborRatePerHour: number;
  laborHours: number;
  invoiceParts: PartLine[];
  otherParts: PartLine[]; // tab requested by you
  invoiceNotes: string;
  updatedAt: number | null;
};

type JobStatus =
  | 'broadcast_open'
  | 'assigned'
  | 'arrived'
  | 'invoice_ready'
  | 'payment_requested'
  | 'paid'
  | 'completed';

type Job = {
  id: string;
  createdAt: number;
  customerId: string;
  proId: string | null;

  serviceId: string;
  serviceName: string;
  trade: string;

  description: string;
  photos: string[];
  houseCoords: Coords;

  matchMode: MatchMode;
  wantAsap: boolean;
  scheduledAt: number | null;

  status: JobStatus;
  invoice: Invoice;

  lastPaymentTotal: number;
  lastPlatformFee: number;
  lastProPayout: number;

  proofAfterUris: string[];
  customerRating: number | null;
};

type Broadcast = {
  id: string;
  jobId: string;
  trade: string;
  status: 'open' | 'claimed';
  claimedByProId: string | null;
  createdAt: number;
};

type WalletTxn = {
  id: string;
  proId: string;
  jobId: string;
  createdAt: number;
  type: 'payout';
  amount: number;
  note: string;
};

type PortfolioPost = {
  id: string;
  proId: string;
  createdAt: number;
  caption: string;
  photoUris: string[];
  likes: number;
};

// -------------------- Services --------------------
const SERVICES: Service[] = [
  {
    id: 'svc_pl_leak',
    trade: 'Plumbing',
    name: 'Leak repair',
    summary: 'Fix pipe/valve/fixture leaks.',
    typicalMinutes: { low: 30, high: 90 },
    minVisit: 149,
    partsAllowance: 50,
  },
  {
    id: 'svc_pl_clog',
    trade: 'Plumbing',
    name: 'Drain clog clearing',
    summary: 'Clear kitchen/bath drains.',
    typicalMinutes: { low: 30, high: 120 },
    minVisit: 129,
    partsAllowance: 20,
  },
  {
    id: 'svc_el_outlet',
    trade: 'Electrical',
    name: 'Outlet / switch repair',
    summary: 'Fix dead outlet, GFCI, switches.',
    typicalMinutes: { low: 30, high: 120 },
    minVisit: 159,
    partsAllowance: 30,
  },
  {
    id: 'svc_hv_nocool',
    trade: 'HVAC',
    name: 'AC not cooling diagnostic',
    summary: 'Diagnostics for cooling issues.',
    typicalMinutes: { low: 60, high: 180 },
    minVisit: 169,
    partsAllowance: 70,
  },
  {
    id: 'svc_hm_mount',
    trade: 'Handyman',
    name: 'Mounting (TV/shelf/mirror)',
    summary: 'Secure mounting + leveling.',
    typicalMinutes: { low: 60, high: 180 },
    minVisit: 120,
    partsAllowance: 20,
  },
];

const PARTS_LIBRARY: Record<string, PartLine[]> = {
  svc_pl_leak: [
    { id: 'p1', name: 'Shutoff valve (1/2")', qty: 1, unit: 18 },
    { id: 'p2', name: 'PEX coupling (1/2")', qty: 2, unit: 3 },
    { id: 'p3', name: 'PTFE tape', qty: 1, unit: 2 },
    { id: 'p4', name: 'Supply line (12–20")', qty: 1, unit: 9 },
  ],
  svc_pl_clog: [
    { id: 'p1', name: 'Drain trap kit (PVC)', qty: 1, unit: 12 },
    { id: 'p2', name: 'Rubber gasket set', qty: 1, unit: 5 },
    { id: 'p3', name: 'Enzyme drain cleaner (optional)', qty: 1, unit: 10 },
  ],
  svc_el_outlet: [
    { id: 'p1', name: 'Duplex outlet 15A', qty: 1, unit: 3 },
    { id: 'p2', name: 'GFCI outlet 15A', qty: 1, unit: 16 },
    { id: 'p3', name: 'Faceplate', qty: 1, unit: 2 },
    { id: 'p4', name: 'Wire nuts (pack)', qty: 1, unit: 4 },
  ],
  svc_hv_nocool: [
    { id: 'p1', name: 'Capacitor (common range)', qty: 1, unit: 28 },
    { id: 'p2', name: 'Contactor', qty: 1, unit: 18 },
    { id: 'p3', name: 'Air filter', qty: 1, unit: 12 },
  ],
  svc_hm_mount: [
    { id: 'p1', name: 'Toggle bolts/anchors', qty: 1, unit: 10 },
    { id: 'p2', name: 'Lag screws (set)', qty: 1, unit: 8 },
    { id: 'p3', name: 'Wall patch kit (optional)', qty: 1, unit: 12 },
  ],
};

// -------------------- Helpers --------------------
const num = (s: string) => {
  const n = Number(String(s).replace(/[^\d.]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));

const laborRateFromScore = (score0to100: number) => {
  const s = clamp(score0to100 || 0, 0, 100);
  const rate = 55 + s * 0.3; // 55..85
  return Math.round(rate);
};

const sumParts = (parts: PartLine[]) =>
  parts.reduce((s, p) => s + (p.qty || 0) * (p.unit || 0), 0);

const computeTotals = (inv: Invoice) => {
  const partsTotal = sumParts(inv.invoiceParts) + sumParts(inv.otherParts);
  const laborTotal = (inv.laborHours || 0) * (inv.laborRatePerHour || 0);
  const subtotal = partsTotal + laborTotal;
  const platformFee = subtotal * PLATFORM_FEE_PCT;
  const proPayout = subtotal - platformFee;
  return { partsTotal, laborTotal, subtotal, platformFee, proPayout };
};

// Luhn validation (real card numbers only — still prototype storage)
const luhnCheck = (cardNum: string) => {
  const digits = cardNum.replace(/\s+/g, '');
  if (!/^\d{12,19}$/.test(digits)) return false;
  let sum = 0;
  let doubleIt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = Number(digits[i]);
    if (doubleIt) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    doubleIt = !doubleIt;
  }
  return sum % 10 === 0;
};

const cardBrand = (cardNum: string) => {
  const d = cardNum.replace(/\s+/g, '');
  if (/^4/.test(d)) return 'Visa';
  if (/^5[1-5]/.test(d)) return 'Mastercard';
  if (/^3[47]/.test(d)) return 'Amex';
  if (/^6/.test(d)) return 'Discover';
  return 'Card';
};

// simple PIN hash (prototype). For production, use SecureStore + server-side auth.
const hashPin = (pin: string) => {
  let h = 0;
  for (let i = 0; i < pin.length; i++) h = (h * 31 + pin.charCodeAt(i)) >>> 0;
  return `h${h}`;
};

const distMeters = (a: Coords, b: Coords) => {
  if (!a || !b) return null;
  const R = 6371000;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
};

const fmtMiles = (m: number | null) => {
  if (m == null) return '—';
  return `${(m / 1609.344).toFixed(m < 16093 ? 2 : 1)} mi`;
};

const parseSchedule = (dateStr: string, timeStr: string): number | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr.trim());
  const t = /^(\d{2}):(\d{2})$/.exec(timeStr.trim());
  if (!m || !t) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  const hh = Number(t[1]);
  const mm = Number(t[2]);
  const dt = new Date(y, mo, d, hh, mm, 0, 0);
  if (Number.isNaN(dt.getTime())) return null;
  return dt.getTime();
};

const toReadableTime = (ms: number | null) => {
  if (!ms) return 'ASAP';
  const d = new Date(ms);
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })}`;
};

// -------------------- UI Primitives --------------------
function Card(props: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <View
      style={{
        marginBottom: 14,
        borderRadius: 20,
        borderWidth: 1,
        borderColor: COLORS.border,
        backgroundColor: COLORS.card,
        overflow: 'hidden',
      }}>
      <LinearGradient
        colors={['rgba(255,122,24,0.35)', 'rgba(255,122,24,0.00)']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={{ height: 3, width: '100%' }}
      />
      <View style={{ padding: 14 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <View style={{ flex: 1, paddingRight: 10 }}>
            <Text
              style={{ fontSize: 16, fontWeight: '900', color: COLORS.text }}>
              {props.title}
            </Text>
            {!!props.subtitle && (
              <Text style={{ marginTop: 4, color: COLORS.muted, fontSize: 12 }}>
                {props.subtitle}
              </Text>
            )}
          </View>
          {props.right}
        </View>
        <View style={{ marginTop: 12 }}>{props.children}</View>
      </View>
    </View>
  );
}

function Btn(props: {
  title: string;
  onPress: () => void;
  variant?: 'default' | 'primary' | 'danger';
  small?: boolean;
  disabled?: boolean;
}) {
  const variant = props.variant || 'default';
  const labelColor =
    variant === 'primary'
      ? '#0B0B0B'
      : variant === 'danger'
      ? COLORS.danger
      : COLORS.text;

  if (variant === 'primary') {
    return (
      <Pressable
        disabled={props.disabled}
        onPress={props.onPress}
        style={{
          marginRight: 10,
          marginTop: 10,
          opacity: props.disabled ? 0.55 : 1,
        }}>
        <LinearGradient
          colors={
            props.disabled
              ? ['rgba(255,255,255,0.08)', 'rgba(255,255,255,0.08)']
              : [COLORS.primary2, COLORS.primary]
          }
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{
            borderRadius: 16,
            paddingVertical: props.small ? 9 : 12,
            paddingHorizontal: props.small ? 12 : 14,
            alignItems: 'center',
            borderWidth: 1,
            borderColor: 'rgba(255,122,24,0.35)',
          }}>
          <Text
            style={{
              fontWeight: '900',
              fontSize: props.small ? 12 : 14,
              color: labelColor,
            }}>
            {props.title}
          </Text>
        </LinearGradient>
      </Pressable>
    );
  }

  const bg =
    variant === 'danger' ? 'rgba(255,59,48,0.12)' : 'rgba(255,255,255,0.06)';
  const border = variant === 'danger' ? 'rgba(255,59,48,0.35)' : COLORS.border;

  return (
    <Pressable
      disabled={props.disabled}
      onPress={props.onPress}
      style={{
        paddingVertical: props.small ? 9 : 12,
        paddingHorizontal: props.small ? 12 : 14,
        borderRadius: 16,
        borderWidth: 1,
        marginRight: 10,
        marginTop: 10,
        borderColor: border,
        backgroundColor: bg,
        alignItems: 'center',
        opacity: props.disabled ? 0.55 : 1,
      }}>
      <Text
        style={{
          fontWeight: '900',
          fontSize: props.small ? 12 : 14,
          color: labelColor,
        }}>
        {props.title}
      </Text>
    </Pressable>
  );
}

function Chip(props: {
  text: string;
  active?: boolean;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      disabled={props.disabled}
      onPress={props.onPress}
      style={{
        paddingVertical: 9,
        paddingHorizontal: 12,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: props.active ? 'rgba(255,122,24,0.9)' : COLORS.border,
        backgroundColor: props.active
          ? 'rgba(255,122,24,0.18)'
          : 'rgba(255,255,255,0.05)',
        marginRight: 10,
        marginBottom: 10,
        opacity: props.disabled ? 0.5 : 1,
      }}>
      <Text style={{ color: COLORS.text, fontWeight: '900' }}>
        {props.text}
      </Text>
    </Pressable>
  );
}

function Inp(props: {
  value: string;
  onChangeText: (t: string) => void;
  placeholder: string;
  secure?: boolean;
  keyboardType?: any;
  multiline?: boolean;
}) {
  return (
    <TextInput
      value={props.value}
      onChangeText={props.onChangeText}
      placeholder={props.placeholder}
      placeholderTextColor="rgba(255,255,255,0.45)"
      secureTextEntry={props.secure}
      keyboardType={props.keyboardType}
      autoCapitalize="none"
      multiline={props.multiline}
      style={{
        borderWidth: 1,
        borderColor: COLORS.border,
        backgroundColor: COLORS.card2,
        borderRadius: 16,
        padding: 12,
        color: COLORS.text,
        marginTop: 8,
        minHeight: props.multiline ? 90 : undefined,
      }}
    />
  );
}

// -------------------- Bottom Tabs --------------------
function BottomTabs(props: {
  tabs: string[];
  active: string;
  onPick: (t: string) => void;
}) {
  const LABELS: Record<string, string> = {
    Home: 'Home',
    Request: 'Request',
    Pros: 'Pros',
    Market: 'Market',
    Jobs: 'Jobs',
    Wallet: 'Wallet',
    Checkout: 'Checkout',
    Profile: 'Me',
  };

  return (
    <View
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        paddingHorizontal: 10,
        paddingTop: 8,
        paddingBottom: 12,
        backgroundColor: 'rgba(14,14,14,0.98)',
        borderTopWidth: 1,
        borderTopColor: COLORS.border,
      }}>
      <View
        style={{
          flexDirection: 'row',
          borderRadius: 18,
          padding: 5,
          borderWidth: 1,
          borderColor: COLORS.border,
          backgroundColor: 'rgba(255,255,255,0.04)',
        }}>
        {props.tabs.map((t) => {
          const on = props.active === t;
          return (
            <Pressable
              key={t}
              onPress={() => props.onPick(t)}
              style={{
                flex: 1,
                paddingVertical: 8,
                borderRadius: 14,
                backgroundColor: on ? 'rgba(255,122,24,0.18)' : 'transparent',
                borderWidth: on ? 1 : 0,
                borderColor: on ? 'rgba(255,122,24,0.35)' : 'transparent',
                alignItems: 'center',
                justifyContent: 'center',
              }}>
              <Text
                numberOfLines={1}
                style={{
                  color: on ? COLORS.primary2 : 'rgba(255,255,255,0.80)',
                  fontWeight: '900',
                  fontSize: 11,
                }}>
                {LABELS[t] ?? t}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

// -------------------- App --------------------
export default function App() {
  // Splash
  const [showSplash, setShowSplash] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setShowSplash(false), 900);
    return () => clearTimeout(t);
  }, []);

  // Session
  const [sessionUserId, setSessionUserId] = useState<string | null>(null);

  // Data
  const [users, setUsers] = useState<User[]>([
    {
      id: 'u_cust_demo',
      role: 'customer',
      email: 'cust@demo.com',
      phone: '+15555550100',
      password: '1234',
      verified: true,
      pinHash: null,
      profile: {
        fullName: 'Demo Customer',
        trades: [],
        tradesLocked: false,
        score: 0,
        ratingsCount: 0,
        jobsDone: 0,
        photoUri: null,
        privacy: { hideEmail: true, hidePhone: true, hideLocation: true },
        lastCoords: null,
        cards: [],
        walletBalance: 0,
      },
    },
    {
      id: 'u_pro_demo',
      role: 'pro',
      email: 'plumber@demo.com',
      phone: '+15555550200',
      password: '1234',
      verified: true,
      pinHash: null,
      profile: {
        fullName: 'Mike Johnson',
        trades: ['Plumbing'],
        tradesLocked: true,
        score: 92,
        ratingsCount: 14,
        jobsDone: 184,
        photoUri: null,
        privacy: { hideEmail: true, hidePhone: true, hideLocation: true },
        lastCoords: null,
        cards: [],
        walletBalance: 240.0,
      },
    },
  ]);

  const [jobs, setJobs] = useState<Job[]>([]);
  const [broadcasts, setBroadcasts] = useState<Broadcast[]>([]);
  const [walletTxns, setWalletTxns] = useState<WalletTxn[]>([]);
  const [portfolioPosts, setPortfolioPosts] = useState<PortfolioPost[]>([
    {
      id: 'pp1',
      proId: 'u_pro_demo',
      createdAt: Date.now() - 86400000 * 2,
      caption: 'Leak repair — clean finish ✅',
      photoUris: [],
      likes: 18,
    },
  ]);

  const me = useMemo(
    () => users.find((u) => u.id === sessionUserId) || null,
    [users, sessionUserId]
  );
  const isPro = me?.role === 'pro';

  const updateMeProfile = (patch: Partial<User['profile']>) => {
    if (!me) return;
    setUsers((prev) =>
      prev.map((u) =>
        u.id === me.id ? { ...u, profile: { ...u.profile, ...patch } } : u
      )
    );
  };

  // Location
  const [hasLoc, setHasLoc] = useState(false);

  const askLocation = async () => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    const ok = status === 'granted';
    setHasLoc(ok);
    if (!ok)
      Alert.alert('Location denied', 'Enable location permission in Settings.');
    return ok;
  };

  const refreshMyLocation = async () => {
    const ok = hasLoc || (await askLocation());
    if (!ok || !me) return null;
    const pos = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Highest,
    });
    const c = {
      latitude: pos.coords.latitude,
      longitude: pos.coords.longitude,
    };
    updateMeProfile({ lastCoords: c });
    return c;
  };

  const linkToDirections = (to: Coords) => {
    if (!to)
      return Alert.alert(
        'Missing location',
        "This job doesn't have a location yet."
      );
    const lat = to.latitude;
    const lon = to.longitude;

    const url =
      Platform.OS === 'ios'
        ? `http://maps.apple.com/?daddr=${lat},${lon}&dirflg=d`
        : `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}&travelmode=driving`;

    Linking.openURL(url).catch(() =>
      Alert.alert('Error', 'Could not open maps.')
    );
  };

  // Photos
  const pickPhoto = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (perm.status !== 'granted') {
      Alert.alert('Photos denied', 'Enable Photos permission in Settings.');
      return null;
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.85,
    });
    if (res.canceled) return null;
    return res.assets?.[0]?.uri || null;
  };

  // -------------------- AUTH (email-only OTP via backend) --------------------
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('login');
  const [signupRole, setSignupRole] = useState<Role>('customer');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [authEmail, setAuthEmail] = useState('');
  const [authPhone, setAuthPhone] = useState('');
  const [authPass, setAuthPass] = useState('');

  const [otpSent, setOtpSent] = useState(false);
  const [otpIn, setOtpIn] = useState('');

  const [signupTrades, setSignupTrades] = useState<string[]>([]);
  const [signupPhotoUri, setSignupPhotoUri] = useState<string | null>(null);

  const sendOtpEmail = async (toEmail: string) => {
    if (!API_BASE_URL) {
      Alert.alert(
        'Email OTP not configured',
        `Set API_BASE_URL to your Cloud Functions URL.\n\nYour backend should send OTP emails from ${OTP_SENDER_EMAIL}.`
      );
      return false;
    }

    try {
      const res = await fetch(`${API_BASE_URL}/sendOtp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toEmail }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return true;
    } catch (e) {
      Alert.alert(
        'OTP failed',
        'Could not send the email OTP. Check your backend / API_BASE_URL.'
      );
      return false;
    }
  };

  const verifyOtp = async (toEmail: string, code: string) => {
    if (!API_BASE_URL) return false;
    try {
      const res = await fetch(`${API_BASE_URL}/verifyOtp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toEmail, code }),
      });
      return res.ok;
    } catch {
      return false;
    }
  };

  const sendSignupCode = async () => {
    const email = authEmail.trim().toLowerCase();
    const phone = authPhone.trim();

    if (!firstName.trim() || !lastName.trim())
      return Alert.alert('Missing name', 'First and last name are required.');
    if (!email || !email.includes('@'))
      return Alert.alert('Invalid', 'Enter a valid email.');
    if (!phone || phone.replace(/[^\d]/g, '').length < 8)
      return Alert.alert('Invalid', 'Enter a valid phone number.');
    if (!authPass) return Alert.alert('Missing', 'Password required.');
    if (users.some((x) => x.email.toLowerCase() === email))
      return Alert.alert('Exists', 'Email already registered.');

    if (signupRole === 'pro') {
      if (!signupPhotoUri)
        return Alert.alert(
          'Photo required',
          'Tradesman must upload a profile photo.'
        );
      if (signupTrades.length < 1)
        return Alert.alert('Trade required', 'Pick at least 1 trade.');
      if (signupTrades.length > 2)
        return Alert.alert('Too many', 'Pick up to 2 trades.');
    }

    const ok = await sendOtpEmail(email);
    if (!ok) return;

    setOtpSent(true);
    Alert.alert('Verification code sent', 'Check your email for your code.');
  };

  const doSignup = async () => {
    const email = authEmail.trim().toLowerCase();
    const phone = authPhone.trim();
    const pass = authPass;

    if (!firstName.trim() || !lastName.trim())
      return Alert.alert('Missing name', 'First and last name are required.');
    if (!email || !email.includes('@'))
      return Alert.alert('Invalid', 'Enter a valid email.');
    if (!phone || phone.replace(/[^\d]/g, '').length < 8)
      return Alert.alert('Invalid', 'Enter a valid phone number.');
    if (!pass) return Alert.alert('Missing', 'Password required.');
    if (!otpSent) return Alert.alert('Verify', 'Tap “Send email code” first.');

    if (signupRole === 'pro') {
      if (!signupPhotoUri)
        return Alert.alert(
          'Photo required',
          'Tradesman must upload a profile photo.'
        );
      if (signupTrades.length < 1)
        return Alert.alert('Trade required', 'Pick at least 1 trade.');
      if (signupTrades.length > 2)
        return Alert.alert('Too many', 'Pick up to 2 trades.');
    }

    const ok = await verifyOtp(email, otpIn.trim());
    if (!ok)
      return Alert.alert('Verify', 'Wrong/expired code. Request a new one.');

    const id = `u_${Date.now()}`;
    const fullName = `${firstName.trim()} ${lastName.trim()}`;

    const profile: User['profile'] = {
      fullName,
      trades: signupRole === 'pro' ? signupTrades : [],
      tradesLocked: signupRole === 'pro',
      score: signupRole === 'pro' ? 85 : 0,
      ratingsCount: signupRole === 'pro' ? 1 : 0,
      jobsDone: 0,
      photoUri: signupRole === 'pro' ? signupPhotoUri : null,
      privacy: { hideEmail: true, hidePhone: true, hideLocation: true },
      lastCoords: null,
      cards: [],
      walletBalance: 0,
    };

    setUsers((p) => [
      {
        id,
        role: signupRole,
        email,
        phone,
        password: pass,
        verified: true,
        pinHash: null,
        profile,
      },
      ...p,
    ]);
    setSessionUserId(id);

    // reset auth
    setAuthMode('login');
    setOtpSent(false);
    setOtpIn('');
    setSignupPhotoUri(null);
    setSignupTrades([]);
    setFirstName('');
    setLastName('');
    setAuthEmail('');
    setAuthPhone('');
    setAuthPass('');
  };

  const doLogin = () => {
    const email = authEmail.trim().toLowerCase();
    const u = users.find(
      (x) => x.email.toLowerCase() === email && x.password === authPass
    );
    if (!u) return Alert.alert('Login failed', 'Wrong email or password.');
    setSessionUserId(u.id);
    setTab('Home');
  };

  const logout = () => {
    setSessionUserId(null);
    setAuthEmail('');
    setAuthPhone('');
    setAuthPass('');
    setAuthMode('login');
    setOtpSent(false);
    setOtpIn('');
    setSignupPhotoUri(null);
    setSignupTrades([]);
    setFirstName('');
    setLastName('');
  };

  // -------------------- NAV / TABS --------------------
  const [tab, setTab] = useState<string>('Home');

  // Checkout tab appears only when needed:
  const checkoutNeeded = useMemo(() => {
    if (!me) return false;

    if (me.role === 'customer') {
      return jobs.some(
        (j) =>
          j.customerId === me.id &&
          (j.status === 'invoice_ready' || j.status === 'payment_requested')
      );
    }

    return jobs.some(
      (j) =>
        j.proId === me.id &&
        (j.status === 'assigned' ||
          j.status === 'arrived' ||
          j.status === 'invoice_ready' ||
          j.status === 'payment_requested')
    );
  }, [jobs, me]);

  const tabsForRole = useMemo(() => {
    if (!me) return [];
    if (me.role === 'customer') {
      const base = ['Home', 'Request', 'Pros'];
      if (checkoutNeeded) base.push('Checkout');
      base.push('Profile');
      return base;
    } else {
      const base = ['Home', 'Market', 'Jobs', 'Wallet'];
      if (checkoutNeeded) base.push('Checkout');
      base.push('Profile');
      return base;
    }
  }, [me, checkoutNeeded]);

  // -------------------- REQUEST FLOW STATE --------------------
  const [selectedServiceId, setSelectedServiceId] = useState<string | null>(
    null
  );

  // request draft
  const [draftNotes, setDraftNotes] = useState('');
  const [draftPhotos, setDraftPhotos] = useState<string[]>([]);
  const [draftWantAsap, setDraftWantAsap] = useState(true);
  const [draftScheduleDate, setDraftScheduleDate] = useState('');
  const [draftScheduleTime, setDraftScheduleTime] = useState('');
  const [draftMatchMode, setDraftMatchMode] = useState<MatchMode>('broadcast');
  const [draftChosenProId, setDraftChosenProId] = useState<string | null>(null);

  const resetDraft = () => {
    setDraftNotes('');
    setDraftPhotos([]);
    setDraftWantAsap(true);
    setDraftScheduleDate('');
    setDraftScheduleTime('');
    setDraftMatchMode('broadcast');
    setDraftChosenProId(null);
  };

  // Featured pros list
  const featuredPros = useMemo(() => {
    if (!me || me.role !== 'customer') return [];
    const myC = me.profile.lastCoords;

    return users
      .filter((u) => u.role === 'pro')
      .map((u) => ({ u, d: distMeters(myC, u.profile.lastCoords) }))
      .sort(
        (a, b) =>
          Number(b.u.profile.score || 0) - Number(a.u.profile.score || 0)
      );
  }, [users, me]);

  // -------------------- JOB CREATION --------------------
  const createJob = async (
    serviceId: string,
    matchMode: MatchMode,
    chosenProId: string | null
  ) => {
    if (!me || me.role !== 'customer') return null;
    const svc = SERVICES.find((s) => s.id === serviceId);
    if (!svc) return null;

    const house = await refreshMyLocation();
    if (!house) return null;

    const scheduledAt = draftWantAsap
      ? null
      : parseSchedule(draftScheduleDate, draftScheduleTime);
    if (!draftWantAsap && !scheduledAt) {
      Alert.alert(
        'Schedule invalid',
        'Use date YYYY-MM-DD and time HH:MM (24h).'
      );
      return null;
    }

    const baseParts = PARTS_LIBRARY[serviceId]
      ? PARTS_LIBRARY[serviceId].map((p) => ({ ...p }))
      : [];
    const defaultRate = BASE_LABOR_RATE;

    const job: Job = {
      id: `j_${Date.now()}`,
      createdAt: Date.now(),
      customerId: me.id,
      proId: matchMode === 'direct' ? chosenProId : null,

      serviceId,
      serviceName: svc.name,
      trade: svc.trade,

      description: draftNotes.trim() || svc.summary,
      photos: draftPhotos,
      houseCoords: house,

      matchMode,
      wantAsap: draftWantAsap,
      scheduledAt,

      status: matchMode === 'direct' ? 'assigned' : 'broadcast_open',
      invoice: {
        laborRatePerHour: defaultRate,
        laborHours: 0,
        invoiceParts: baseParts,
        otherParts: [],
        invoiceNotes: '',
        updatedAt: null,
      },

      lastPaymentTotal: 0,
      lastPlatformFee: 0,
      lastProPayout: 0,

      proofAfterUris: [],
      customerRating: null,
    };

    setJobs((p) => [job, ...p]);

    if (matchMode === 'broadcast') {
      const b: Broadcast = {
        id: `b_${Date.now()}`,
        jobId: job.id,
        trade: svc.trade,
        status: 'open',
        claimedByProId: null,
        createdAt: Date.now(),
      };
      setBroadcasts((p) => [b, ...p]);
    }

    resetDraft();
    setSelectedServiceId(null);
    return job.id;
  };

  // -------------------- PRO MARKET CLAIM --------------------
  const openMarketSorted = useMemo(() => {
    if (!me || me.role !== 'pro') return [];
    const myC = me.profile.lastCoords;
    const myTrades = me.profile.trades || [];

    return broadcasts
      .filter((b) => b.status === 'open')
      .map((b) => {
        const j = jobs.find((x) => x.id === b.jobId);
        if (!j) return null;
        if (myTrades.length && !myTrades.includes(j.trade)) return null;
        const d = distMeters(myC, j.houseCoords);
        return { b, j, d };
      })
      .filter(Boolean)
      .sort((a: any, b: any) => {
        if (a.d == null && b.d == null) return b.b.createdAt - a.b.createdAt;
        if (a.d == null) return 1;
        if (b.d == null) return -1;
        return a.d - b.d;
      });
  }, [broadcasts, jobs, me]);

  const claimBroadcast = (broadcastId: string) => {
    if (!me || me.role !== 'pro') return;
    const b = broadcasts.find((x) => x.id === broadcastId);
    if (!b || b.status !== 'open')
      return Alert.alert('Too late', 'Already claimed.');

    const j = jobs.find((x) => x.id === b.jobId);
    if (!j || j.proId) return Alert.alert('Too late', 'Already assigned.');

    setBroadcasts((p) =>
      p.map((x) =>
        x.id === broadcastId
          ? { ...x, status: 'claimed', claimedByProId: me.id }
          : x
      )
    );
    setJobs((p) =>
      p.map((job) =>
        job.id === j.id ? { ...job, proId: me.id, status: 'assigned' } : job
      )
    );
    Alert.alert('Claimed', 'Job assigned to you. Go to Jobs / Checkout.');
  };

  // -------------------- INVOICE / PAYMENT --------------------
  const setInvoiceForJob = (jobId: string, invoice: Invoice) => {
    setJobs((prev) =>
      prev.map((j) => {
        if (j.id !== jobId) return j;
        const nextStatus =
          j.status === 'payment_requested' ? j.status : 'invoice_ready';
        return { ...j, invoice, status: nextStatus };
      })
    );
  };

  const requestPayment = (jobId: string) => {
    if (!me || me.role !== 'pro') return;
    setJobs((prev) =>
      prev.map((j) => {
        if (j.id !== jobId) return j;
        if (j.proId !== me.id) return j;
        if (
          j.status !== 'invoice_ready' &&
          j.status !== 'arrived' &&
          j.status !== 'assigned'
        )
          return j;

        const adjustedRate = laborRateFromScore(me.profile.score || 0);
        const inv = {
          ...j.invoice,
          laborRatePerHour: adjustedRate,
          updatedAt: Date.now(),
        };
        return { ...j, invoice: inv, status: 'payment_requested' };
      })
    );
    Alert.alert('Payment requested', 'Customer can now pay in Checkout.');
  };

  // Payment methods lock state (runtime-only unlock)
  const [cardsUnlocked, setCardsUnlocked] = useState(false);

  const payJob = (jobId: string, cardId: string) => {
    if (!me || me.role !== 'customer') return;
    const job = jobs.find((j) => j.id === jobId);
    if (!job) return;
    if (job.customerId !== me.id) return;
    if (job.status !== 'payment_requested')
      return Alert.alert(
        'Not ready',
        'Tradesman has not requested payment yet.'
      );

    const inv = job.invoice;
    const totals = computeTotals(inv);

    setJobs((prev) =>
      prev.map((j) =>
        j.id === jobId
          ? {
              ...j,
              status: 'paid',
              lastPaymentTotal: totals.subtotal,
              lastPlatformFee: totals.platformFee,
              lastProPayout: totals.proPayout,
            }
          : j
      )
    );

    if (job.proId) {
      setUsers((prev) =>
        prev.map((u) => {
          if (u.id !== job.proId) return u;
          return {
            ...u,
            profile: {
              ...u.profile,
              walletBalance: (u.profile.walletBalance || 0) + totals.proPayout,
            },
          };
        })
      );

      setWalletTxns((prev) => [
        {
          id: `w_${Date.now()}`,
          proId: job.proId,
          jobId,
          createdAt: Date.now(),
          type: 'payout',
          amount: totals.proPayout,
          note: `Payout for ${job.serviceName} (2% platform fee applied)`,
        },
        ...prev,
      ]);
    }

    Alert.alert(
      'Paid ✅',
      `Charged ${money(totals.subtotal)} to card. Platform fee: ${money(
        totals.platformFee
      )}.`
    );
  };

  // -------------------- Rating --------------------
  const submitRating = (jobId: string, rating0to100: number) => {
    if (!me || me.role !== 'customer') return;
    const j = jobs.find((x) => x.id === jobId);
    if (!j?.proId) return;

    setJobs((prev) =>
      prev.map((job) =>
        job.id === jobId ? { ...job, customerRating: rating0to100 } : job
      )
    );

    setUsers((prev) =>
      prev.map((u) => {
        if (u.id !== j.proId) return u;
        const oldCount = u.profile.ratingsCount || 0;
        const oldScore = u.profile.score || 0;
        const newCount = oldCount + 1;
        const newScore = Math.round(
          (oldScore * oldCount + rating0to100) / newCount
        );
        return {
          ...u,
          profile: { ...u.profile, score: newScore, ratingsCount: newCount },
        };
      })
    );

    Alert.alert(
      'Thanks!',
      'Rating submitted. It affects default hourly rates.'
    );
  };

  // -------------------- PRO PROOF UPLOAD --------------------
  const uploadProof = async (jobId: string) => {
    const uri = await pickPhoto();
    if (!uri) return;
    setJobs((prev) =>
      prev.map((j) =>
        j.id === jobId
          ? { ...j, proofAfterUris: [uri, ...j.proofAfterUris] }
          : j
      )
    );
  };

  // -------------------- Portfolio posting --------------------
  const createPortfolioPost = async () => {
    if (!me || me.role !== 'pro') return;
    const uri = await pickPhoto();
    if (!uri) return;

    Alert.prompt?.('Caption', 'Describe the work.', [
      { text: 'Cancel', style: 'cancel' as any },
      {
        text: 'Post',
        onPress: (caption?: string) => {
          const post: PortfolioPost = {
            id: `pp_${Date.now()}`,
            proId: me.id,
            createdAt: Date.now(),
            caption: caption?.trim() || 'Work completed ✅',
            photoUris: [uri],
            likes: 0,
          };
          setPortfolioPosts((p) => [post, ...p]);
        },
      },
    ]);

    if (!Alert.prompt) {
      const post: PortfolioPost = {
        id: `pp_${Date.now()}`,
        proId: me.id,
        createdAt: Date.now(),
        caption: 'Work completed ✅',
        photoUris: [uri],
        likes: 0,
      };
      setPortfolioPosts((p) => [post, ...p]);
      Alert.alert(
        'Posted',
        'Posted to your profile. (Add caption editing later)'
      );
    }
  };

  // -------------------- PAYMENT METHODS (LOCKED) --------------------
  const [pinMode, setPinMode] = useState<'none' | 'set' | 'enter'>('none');
  const [pinA, setPinA] = useState('');
  const [pinB, setPinB] = useState('');
  const [pinIn, setPinIn] = useState('');

  const startUnlockCards = () => {
    if (!me) return;
    if (!me.pinHash) setPinMode('set');
    else setPinMode('enter');
  };

  const finishSetPin = () => {
    if (!me) return;
    const a = pinA.trim();
    const b = pinB.trim();
    if (!/^\d{4,6}$/.test(a))
      return Alert.alert('PIN invalid', 'Use 4–6 digits.');
    if (a !== b) return Alert.alert('PIN mismatch', 'PINs do not match.');
    setUsers((prev) =>
      prev.map((u) => (u.id === me.id ? { ...u, pinHash: hashPin(a) } : u))
    );
    setPinA('');
    setPinB('');
    setPinMode('none');
    setCardsUnlocked(true);
    Alert.alert('PIN set', 'Payment Methods are now locked by your PIN.');
  };

  const finishEnterPin = () => {
    if (!me) return;
    const entered = pinIn.trim();
    if (!/^\d{4,6}$/.test(entered))
      return Alert.alert('PIN invalid', 'Use 4–6 digits.');
    if (hashPin(entered) !== me.pinHash)
      return Alert.alert('Wrong PIN', 'Try again.');
    setPinIn('');
    setPinMode('none');
    setCardsUnlocked(true);
  };

  const lockCards = () => setCardsUnlocked(false);

  const addCard = (cardNum: string, expMM: string, expYY: string) => {
    if (!me) return;
    const n = cardNum.trim();
    const mm = Math.round(num(expMM));
    const yy = Math.round(num(expYY));
    if (!luhnCheck(n))
      return Alert.alert(
        'Invalid card',
        'Card number failed validation (must be a real-number format).'
      );
    if (mm < 1 || mm > 12)
      return Alert.alert('Invalid exp', 'Month must be 1–12.');
    if (yy < 2024 || yy > 2040)
      return Alert.alert('Invalid exp', 'Year must be YYYY.');
    const last4 = n.replace(/\s+/g, '').slice(-4);
    const pm: PaymentMethod = {
      id: `card_${Date.now()}`,
      brand: cardBrand(n),
      last4,
      expMonth: mm,
      expYear: yy,
    };
    updateMeProfile({ cards: [pm, ...me.profile.cards] });
    Alert.alert('Saved', `${pm.brand} •••• ${pm.last4} saved.`);
  };

  const removeCard = (id: string) => {
    if (!me) return;
    updateMeProfile({ cards: me.profile.cards.filter((c) => c.id !== id) });
  };

  // -------------------- Screen Lists --------------------
  const myCustomerJobs = useMemo(() => {
    if (!me || me.role !== 'customer') return [];
    return jobs.filter((j) => j.customerId === me.id);
  }, [jobs, me]);

  const myProJobs = useMemo(() => {
    if (!me || me.role !== 'pro') return [];
    return jobs.filter((j) => j.proId === me.id);
  }, [jobs, me]);

  const myWalletTxns = useMemo(() => {
    if (!me || me.role !== 'pro') return [];
    return walletTxns.filter((t) => t.proId === me.id);
  }, [walletTxns, me]);

  // -------------------- Splash --------------------
  const bgStyle = {
    flex: 1,
    backgroundColor: COLORS.bg,
    paddingTop: Platform.OS === 'android' ? 30 : 0,
  };

  if (showSplash) {
    return (
      <SafeAreaView
        style={{
          flex: 1,
          backgroundColor: COLORS.primary,
          alignItems: 'center',
          justifyContent: 'center',
        }}>
        <Image
          source={LOGO}
          style={{ width: 180, height: 180 }}
          resizeMode="contain"
        />
      </SafeAreaView>
    );
  }

  // -------------------- Logged out --------------------
  if (!me) {
    return (
      <SafeAreaView style={bgStyle}>
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
          <View style={{ alignItems: 'center', marginBottom: 18 }}>
            <Image
              source={LOGO}
              style={{ width: 120, height: 120 }}
              resizeMode="contain"
            />
            <Text
              style={{
                color: COLORS.text,
                fontSize: 22,
                fontWeight: '900',
                marginTop: 10,
              }}>
              Extra Hand
            </Text>
            <Text
              style={{
                color: COLORS.muted,
                marginTop: 6,
                textAlign: 'center',
              }}>
              Verified tradesmen. Transparent services. Virtual payments. 2%
              platform fee.
            </Text>
          </View>

          {authMode === 'login' ? (
            <Card title="Log in" subtitle="Welcome back">
              <Text style={{ color: COLORS.muted, fontSize: 12 }}>Email</Text>
              <Inp
                value={authEmail}
                onChangeText={setAuthEmail}
                placeholder="you@email.com"
              />

              <Text
                style={{ color: COLORS.muted, fontSize: 12, marginTop: 12 }}>
                Password
              </Text>
              <Inp
                value={authPass}
                onChangeText={setAuthPass}
                placeholder="password"
                secure
              />

              <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                <Btn title="Log in" variant="primary" onPress={doLogin} />
                <Btn title="Sign up" onPress={() => setAuthMode('signup')} />
              </View>
            </Card>
          ) : (
            <Card
              title="Create account"
              subtitle="Verification code is sent by email only">
              <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                <Chip
                  text="Customer"
                  active={signupRole === 'customer'}
                  onPress={() => setSignupRole('customer')}
                />
                <Chip
                  text="Tradesman"
                  active={signupRole === 'pro'}
                  onPress={() => setSignupRole('pro')}
                />
              </View>

              <Text
                style={{ color: COLORS.muted, fontSize: 12, marginTop: 12 }}>
                First name
              </Text>
              <Inp
                value={firstName}
                onChangeText={setFirstName}
                placeholder="First"
              />
              <Text
                style={{ color: COLORS.muted, fontSize: 12, marginTop: 12 }}>
                Last name
              </Text>
              <Inp
                value={lastName}
                onChangeText={setLastName}
                placeholder="Last"
              />

              {signupRole === 'pro' && (
                <View style={{ marginTop: 12 }}>
                  <Text style={{ color: COLORS.muted, fontSize: 12 }}>
                    Tradesman photo (required)
                  </Text>
                  <Btn
                    title={signupPhotoUri ? 'Change photo' : 'Upload photo'}
                    variant="primary"
                    onPress={async () => {
                      const uri = await pickPhoto();
                      if (uri) setSignupPhotoUri(uri);
                    }}
                  />
                  <Text
                    style={{
                      color: COLORS.muted,
                      fontSize: 12,
                      marginTop: 12,
                    }}>
                    Pick 1–2 trades (locked after signup)
                  </Text>
                  <View
                    style={{
                      flexDirection: 'row',
                      flexWrap: 'wrap',
                      marginTop: 8,
                    }}>
                    {Array.from(new Set(SERVICES.map((s) => s.trade))).map(
                      (trade) => {
                        const on = signupTrades.includes(trade);
                        const disabled = !on && signupTrades.length >= 2;
                        return (
                          <Chip
                            key={trade}
                            text={trade}
                            active={on}
                            disabled={disabled}
                            onPress={() => {
                              setSignupTrades((prev) => {
                                if (prev.includes(trade))
                                  return prev.filter((x) => x !== trade);
                                if (prev.length >= 2) return prev;
                                return [...prev, trade];
                              });
                            }}
                          />
                        );
                      }
                    )}
                  </View>
                </View>
              )}

              <Text
                style={{ color: COLORS.muted, fontSize: 12, marginTop: 12 }}>
                Email
              </Text>
              <Inp
                value={authEmail}
                onChangeText={setAuthEmail}
                placeholder="you@email.com"
              />

              <Text
                style={{ color: COLORS.muted, fontSize: 12, marginTop: 12 }}>
                Phone (for job contact later)
              </Text>
              <Inp
                value={authPhone}
                onChangeText={setAuthPhone}
                placeholder="+1 ..."
                keyboardType="phone-pad"
              />

              <Text
                style={{ color: COLORS.muted, fontSize: 12, marginTop: 12 }}>
                Password
              </Text>
              <Inp
                value={authPass}
                onChangeText={setAuthPass}
                placeholder="password"
                secure
              />

              <Btn
                title="Send email code"
                variant="primary"
                onPress={sendSignupCode}
              />

              {otpSent && (
                <>
                  <Text
                    style={{
                      color: COLORS.muted,
                      fontSize: 12,
                      marginTop: 12,
                    }}>
                    Enter code from email
                  </Text>
                  <Inp
                    value={otpIn}
                    onChangeText={setOtpIn}
                    placeholder="123456"
                    keyboardType="number-pad"
                  />
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                    <Btn
                      title="Create account"
                      variant="primary"
                      onPress={() => void doSignup()}
                    />
                    <Btn title="Back" onPress={() => setAuthMode('login')} />
                  </View>
                </>
              )}
            </Card>
          )}
        </ScrollView>
      </SafeAreaView>
    );
  }

  // -------------------- Header --------------------
  const Header = (
    <View style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Image
          source={LOGO}
          style={{ width: 28, height: 28 }}
          resizeMode="contain"
        />
        <Text
          style={{
            marginLeft: 10,
            fontSize: 18,
            fontWeight: '900',
            color: COLORS.text,
          }}>
          Extra Hand
        </Text>
        <View style={{ flex: 1 }} />
        <Btn title="Log out" variant="danger" small onPress={logout} />
      </View>
    </View>
  );

  // -------------------- Main UI --------------------
  return (
    <SafeAreaView style={bgStyle}>
      {Header}

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 140 }}>
          {/* HOME */}
          {tab === 'Home' && (
            <>
              <View style={{ marginBottom: 14 }}>
                <LinearGradient
                  colors={[
                    'rgba(255,122,24,0.30)',
                    'rgba(255,122,24,0.06)',
                    'rgba(0,0,0,0)',
                  ]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={{
                    borderRadius: 24,
                    borderWidth: 1,
                    borderColor: 'rgba(255,255,255,0.10)',
                    overflow: 'hidden',
                  }}>
                  <View style={{ padding: 16 }}>
                    <Text
                      style={{
                        color: COLORS.text,
                        fontWeight: '900',
                        fontSize: 18,
                      }}>
                      Hey{' '}
                      {me.profile.fullName
                        ? me.profile.fullName.split(' ')[0]
                        : 'there'}{' '}
                      👋
                    </Text>

                    <Text
                      style={{
                        marginTop: 6,
                        color: COLORS.muted,
                        fontSize: 12,
                      }}>
                      {isPro
                        ? 'Claim jobs, build invoices, request payment, grow your profile.'
                        : 'Pick a service, schedule, and we match the right tradesman.'}
                    </Text>

                    <View
                      style={{
                        flexDirection: 'row',
                        flexWrap: 'wrap',
                        marginTop: 12,
                      }}>
                      <Btn
                        title="Update location"
                        onPress={refreshMyLocation}
                      />
                      {!isPro ? (
                        <>
                          <Btn
                            title="New request"
                            variant="primary"
                            onPress={() => setTab('Request')}
                          />
                          {checkoutNeeded && (
                            <Btn
                              title="Checkout"
                              variant="primary"
                              onPress={() => setTab('Checkout')}
                            />
                          )}
                        </>
                      ) : (
                        <>
                          <Btn
                            title="Open market"
                            variant="primary"
                            onPress={() => setTab('Market')}
                          />
                          <Btn title="My jobs" onPress={() => setTab('Jobs')} />
                          {checkoutNeeded && (
                            <Btn
                              title="Checkout"
                              variant="primary"
                              onPress={() => setTab('Checkout')}
                            />
                          )}
                        </>
                      )}
                    </View>
                  </View>
                </LinearGradient>
              </View>

              {!isPro ? (
                <Card
                  title="Top tradesmen"
                  subtitle="High rated pros near you"
                  right={
                    <Btn title="Refresh" small onPress={refreshMyLocation} />
                  }>
                  {featuredPros.length === 0 ? (
                    <Text style={{ color: COLORS.muted }}>
                      No tradesmen yet.
                    </Text>
                  ) : (
                    featuredPros.slice(0, 6).map(({ u, d }) => (
                      <View
                        key={u.id}
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          padding: 12,
                          borderRadius: 18,
                          backgroundColor: COLORS.card2,
                          borderWidth: 1,
                          borderColor: COLORS.border,
                          marginBottom: 10,
                        }}>
                        <Image
                          source={
                            u.profile.photoUri
                              ? { uri: u.profile.photoUri }
                              : LOGO
                          }
                          style={{
                            width: 44,
                            height: 44,
                            borderRadius: 999,
                            borderWidth: 1,
                            borderColor: COLORS.border,
                          }}
                        />
                        <View style={{ marginLeft: 12, flex: 1 }}>
                          <Text
                            style={{ color: COLORS.text, fontWeight: '900' }}>
                            {u.profile.fullName || 'Tradesman'}
                          </Text>
                          <Text
                            style={{
                              marginTop: 4,
                              color: COLORS.muted,
                              fontSize: 12,
                            }}>
                            {u.profile.trades?.[0] || 'Trade'} • Score{' '}
                            {u.profile.score} • {fmtMiles(d)}
                          </Text>
                        </View>
                      </View>
                    ))
                  )}
                </Card>
              ) : (
                <Card
                  title="Your reputation"
                  subtitle="Ratings affect your default hourly rate">
                  <Text
                    style={{
                      color: COLORS.text,
                      fontWeight: '900',
                      fontSize: 16,
                    }}>
                    Score {me.profile.score} / 100
                  </Text>
                  <Text style={{ color: COLORS.muted, marginTop: 6 }}>
                    Ratings: {me.profile.ratingsCount} • Jobs done:{' '}
                    {me.profile.jobsDone} • Default hourly: $
                    {laborRateFromScore(me.profile.score)}/hr
                  </Text>
                </Card>
              )}
            </>
          )}

          {/* CUSTOMER: REQUEST */}
          {!isPro && tab === 'Request' && (
            <>
              {!selectedServiceId ? (
                <Card
                  title="Request a service"
                  subtitle="Transparent services list">
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                    <Btn title="Allow location" onPress={askLocation} />
                    <Btn
                      title="Update my location"
                      onPress={refreshMyLocation}
                    />
                  </View>

                  <Text
                    style={{
                      color: COLORS.muted,
                      fontSize: 12,
                      marginTop: 12,
                    }}>
                    Services
                  </Text>
                  {SERVICES.map((s) => {
                    const low =
                      Math.max(
                        s.minVisit,
                        (s.typicalMinutes.low / 60) * BASE_LABOR_RATE
                      ) + s.partsAllowance;
                    const high =
                      Math.max(
                        s.minVisit,
                        (s.typicalMinutes.high / 60) * BASE_LABOR_RATE
                      ) + s.partsAllowance;
                    const closest = Math.round((low + high) / 2);

                    return (
                      <Pressable
                        key={s.id}
                        onPress={() => {
                          setSelectedServiceId(s.id);
                          resetDraft();
                        }}
                        style={{
                          padding: 12,
                          borderRadius: 16,
                          borderWidth: 1,
                          borderColor: COLORS.border,
                          backgroundColor: COLORS.card2,
                          marginTop: 10,
                        }}>
                        <Text style={{ color: COLORS.text, fontWeight: '900' }}>
                          {s.name}
                        </Text>
                        <Text
                          style={{
                            color: COLORS.muted,
                            marginTop: 6,
                            fontSize: 12,
                          }}>
                          {s.trade} • {s.summary}
                        </Text>
                        <Text
                          style={{
                            color: COLORS.muted,
                            marginTop: 6,
                            fontSize: 12,
                          }}>
                          Estimate: Closest {money(closest)} • Range{' '}
                          {money(low)}–{money(high)}
                        </Text>
                      </Pressable>
                    );
                  })}
                </Card>
              ) : (
                <Card
                  title="Request details"
                  subtitle="Choose matching mode + schedule + add notes/photos"
                  right={
                    <Btn
                      title="Back"
                      small
                      onPress={() => {
                        setSelectedServiceId(null);
                        resetDraft();
                      }}
                    />
                  }>
                  <Text style={{ color: COLORS.text, fontWeight: '900' }}>
                    {SERVICES.find((s) => s.id === selectedServiceId)?.name}
                  </Text>

                  <Text
                    style={{
                      color: COLORS.muted,
                      fontSize: 12,
                      marginTop: 12,
                    }}>
                    Match mode
                  </Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                    <Chip
                      text="Let app match (broadcast)"
                      active={draftMatchMode === 'broadcast'}
                      onPress={() => setDraftMatchMode('broadcast')}
                    />
                    <Chip
                      text="Pick a specific pro"
                      active={draftMatchMode === 'direct'}
                      onPress={() => setDraftMatchMode('direct')}
                    />
                  </View>

                  {draftMatchMode === 'direct' && (
                    <>
                      <Text style={{ color: COLORS.muted, fontSize: 12 }}>
                        Choose pro (optional)
                      </Text>
                      <View
                        style={{
                          flexDirection: 'row',
                          flexWrap: 'wrap',
                          marginTop: 6,
                        }}>
                        {featuredPros.slice(0, 6).map(({ u }) => (
                          <Chip
                            key={u.id}
                            text={u.profile.fullName.split(' ')[0]}
                            active={draftChosenProId === u.id}
                            onPress={() =>
                              setDraftChosenProId((prev) =>
                                prev === u.id ? null : u.id
                              )
                            }
                          />
                        ))}
                      </View>
                      {!draftChosenProId && (
                        <Text style={{ color: COLORS.muted }}>
                          Pick someone or go back and choose broadcast.
                        </Text>
                      )}
                    </>
                  )}

                  <Text
                    style={{
                      color: COLORS.muted,
                      fontSize: 12,
                      marginTop: 12,
                    }}>
                    When
                  </Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                    <Chip
                      text="ASAP"
                      active={draftWantAsap}
                      onPress={() => setDraftWantAsap(true)}
                    />
                    <Chip
                      text="Schedule"
                      active={!draftWantAsap}
                      onPress={() => setDraftWantAsap(false)}
                    />
                  </View>

                  {!draftWantAsap && (
                    <>
                      <Text
                        style={{
                          color: COLORS.muted,
                          fontSize: 12,
                          marginTop: 8,
                        }}>
                        Date (YYYY-MM-DD)
                      </Text>
                      <Inp
                        value={draftScheduleDate}
                        onChangeText={setDraftScheduleDate}
                        placeholder="2026-01-20"
                      />
                      <Text
                        style={{
                          color: COLORS.muted,
                          fontSize: 12,
                          marginTop: 8,
                        }}>
                        Time (HH:MM 24h)
                      </Text>
                      <Inp
                        value={draftScheduleTime}
                        onChangeText={setDraftScheduleTime}
                        placeholder="14:30"
                      />
                    </>
                  )}

                  <Text
                    style={{
                      color: COLORS.muted,
                      fontSize: 12,
                      marginTop: 12,
                    }}>
                    Notes
                  </Text>
                  <Inp
                    value={draftNotes}
                    onChangeText={setDraftNotes}
                    placeholder="Describe the problem…"
                    multiline
                  />

                  <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                    <Btn
                      title="Add photo"
                      onPress={async () => {
                        const uri = await pickPhoto();
                        if (uri) setDraftPhotos((p) => [uri, ...p]);
                      }}
                    />
                    <Btn
                      title="Submit request"
                      variant="primary"
                      onPress={async () => {
                        if (!selectedServiceId) return;
                        if (draftMatchMode === 'direct' && !draftChosenProId) {
                          return Alert.alert(
                            'Choose a pro',
                            'Pick a pro or switch to broadcast.'
                          );
                        }
                        const jobId = await createJob(
                          selectedServiceId,
                          draftMatchMode,
                          draftChosenProId
                        );
                        if (!jobId) return;
                        Alert.alert(
                          'Request created',
                          draftMatchMode === 'broadcast'
                            ? 'Sent to market. First come first serve.'
                            : 'Assigned to chosen pro.'
                        );
                        setTab('Home');
                      }}
                    />
                  </View>

                  {draftPhotos.length > 0 && (
                    <View
                      style={{
                        flexDirection: 'row',
                        flexWrap: 'wrap',
                        marginTop: 10,
                      }}>
                      {draftPhotos.map((uri) => (
                        <Image
                          key={uri}
                          source={{ uri }}
                          style={{
                            width: 70,
                            height: 70,
                            borderRadius: 14,
                            marginRight: 10,
                            marginBottom: 10,
                            borderWidth: 1,
                            borderColor: COLORS.border,
                          }}
                        />
                      ))}
                    </View>
                  )}
                </Card>
              )}
            </>
          )}

          {/* CUSTOMER: PROS */}
          {!isPro && tab === 'Pros' && (
            <Card title="Tradesmen" subtitle="Browse top profiles">
              {featuredPros.length === 0 ? (
                <Text style={{ color: COLORS.muted }}>No pros yet.</Text>
              ) : (
                featuredPros.map(({ u, d }) => {
                  const posts = portfolioPosts
                    .filter((p) => p.proId === u.id)
                    .slice(0, 3);
                  return (
                    <View
                      key={u.id}
                      style={{
                        padding: 12,
                        borderRadius: 18,
                        backgroundColor: COLORS.card2,
                        borderWidth: 1,
                        borderColor: COLORS.border,
                        marginBottom: 10,
                      }}>
                      <View
                        style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <Image
                          source={
                            u.profile.photoUri
                              ? { uri: u.profile.photoUri }
                              : LOGO
                          }
                          style={{
                            width: 44,
                            height: 44,
                            borderRadius: 999,
                            borderWidth: 1,
                            borderColor: COLORS.border,
                          }}
                        />
                        <View style={{ marginLeft: 12, flex: 1 }}>
                          <Text
                            style={{ color: COLORS.text, fontWeight: '900' }}>
                            {u.profile.fullName || 'Tradesman'}
                          </Text>
                          <Text
                            style={{
                              marginTop: 4,
                              color: COLORS.muted,
                              fontSize: 12,
                            }}>
                            {u.profile.trades?.[0] || 'Trade'} • Score{' '}
                            {u.profile.score} • {fmtMiles(d)}
                          </Text>
                        </View>
                      </View>

                      <Text
                        style={{
                          color: COLORS.muted,
                          marginTop: 10,
                          fontSize: 12,
                          fontWeight: '900',
                        }}>
                        Recent work
                      </Text>
                      {posts.length === 0 ? (
                        <Text style={{ color: COLORS.muted, marginTop: 6 }}>
                          No posts yet.
                        </Text>
                      ) : (
                        <View
                          style={{
                            flexDirection: 'row',
                            flexWrap: 'wrap',
                            marginTop: 8,
                          }}>
                          {posts.map((p) => (
                            <View
                              key={p.id}
                              style={{
                                width: '100%',
                                padding: 10,
                                borderRadius: 14,
                                borderWidth: 1,
                                borderColor: COLORS.border,
                                backgroundColor: 'rgba(255,255,255,0.04)',
                                marginBottom: 8,
                              }}>
                              <Text
                                style={{
                                  color: COLORS.text,
                                  fontWeight: '900',
                                }}>
                                {p.caption}
                              </Text>
                              <Text
                                style={{
                                  color: COLORS.muted,
                                  marginTop: 4,
                                  fontSize: 12,
                                }}>
                                ❤️ {p.likes} •{' '}
                                {new Date(p.createdAt).toLocaleDateString()}
                              </Text>
                            </View>
                          ))}
                        </View>
                      )}
                    </View>
                  );
                })
              )}
            </Card>
          )}

          {/* PRO: MARKET */}
          {isPro && tab === 'Market' && (
            <Card
              title="Market"
              subtitle="First come first serve jobs"
              right={
                <Btn
                  title="Update location"
                  small
                  onPress={refreshMyLocation}
                />
              }>
              {openMarketSorted.length === 0 ? (
                <Text style={{ color: COLORS.muted }}>No open jobs.</Text>
              ) : (
                openMarketSorted.map(({ b, j, d }: any) => (
                  <View
                    key={b.id}
                    style={{
                      padding: 12,
                      borderRadius: 18,
                      backgroundColor: COLORS.card2,
                      borderWidth: 1,
                      borderColor: 'rgba(255,122,24,0.25)',
                      marginBottom: 10,
                    }}>
                    <Text style={{ color: COLORS.text, fontWeight: '900' }}>
                      {j.trade} • {j.serviceName}
                    </Text>
                    <Text
                      style={{
                        marginTop: 6,
                        color: COLORS.muted,
                        fontSize: 12,
                      }}>
                      {j.description}
                    </Text>
                    <Text
                      style={{
                        marginTop: 6,
                        color: COLORS.muted,
                        fontSize: 12,
                      }}>
                      When: {toReadableTime(j.scheduledAt)} • Distance:{' '}
                      {fmtMiles(d)}
                    </Text>
                    <Text
                      style={{
                        marginTop: 6,
                        color: COLORS.muted,
                        fontSize: 12,
                      }}>
                      Address: hidden until claimed
                    </Text>
                    <Btn
                      title="Claim"
                      variant="primary"
                      onPress={() => claimBroadcast(b.id)}
                    />
                  </View>
                ))
              )}
            </Card>
          )}

          {/* PRO: JOBS */}
          {isPro && tab === 'Jobs' && (
            <Card title="My jobs" subtitle="Directions + proof photos">
              {myProJobs.length === 0 ? (
                <Text style={{ color: COLORS.muted }}>
                  No jobs yet. Claim one in Market.
                </Text>
              ) : (
                myProJobs.map((j) => (
                  <View
                    key={j.id}
                    style={{
                      padding: 12,
                      borderRadius: 18,
                      backgroundColor: COLORS.card2,
                      borderWidth: 1,
                      borderColor: COLORS.border,
                      marginBottom: 10,
                    }}>
                    <Text style={{ color: COLORS.text, fontWeight: '900' }}>
                      {j.trade} • {j.serviceName}
                    </Text>
                    <Text
                      style={{
                        marginTop: 6,
                        color: COLORS.muted,
                        fontSize: 12,
                      }}>
                      Status: {j.status} • When: {toReadableTime(j.scheduledAt)}
                    </Text>

                    <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                      <Btn
                        title="Directions"
                        variant="primary"
                        onPress={() => linkToDirections(j.houseCoords)}
                      />
                      <Btn
                        title="Upload proof"
                        onPress={() => uploadProof(j.id)}
                      />
                      <Btn
                        title="Go to Checkout"
                        variant="primary"
                        onPress={() => {
                          setTab('Checkout');
                        }}
                      />
                    </View>

                    {j.proofAfterUris.length > 0 && (
                      <View
                        style={{
                          flexDirection: 'row',
                          flexWrap: 'wrap',
                          marginTop: 10,
                        }}>
                        {j.proofAfterUris.slice(0, 4).map((uri, idx) => (
                          <Image
                            key={`${uri}_${idx}`}
                            source={{ uri }}
                            style={{
                              width: 70,
                              height: 70,
                              borderRadius: 14,
                              marginRight: 10,
                              marginBottom: 10,
                              borderWidth: 1,
                              borderColor: COLORS.border,
                            }}
                          />
                        ))}
                      </View>
                    )}
                  </View>
                ))
              )}
            </Card>
          )}

          {/* PRO: WALLET */}
          {isPro && tab === 'Wallet' && (
            <Card title="Wallet" subtitle="Payouts from customer payments">
              <Text
                style={{ color: COLORS.text, fontWeight: '900', fontSize: 16 }}>
                Balance: {money(me.profile.walletBalance)}
              </Text>
              <Text style={{ color: COLORS.muted, marginTop: 6, fontSize: 12 }}>
                Platform fee is 2% per transaction. Tips can be cash (off-app).
              </Text>

              <Text
                style={{
                  color: COLORS.text,
                  fontWeight: '900',
                  marginTop: 12,
                }}>
                Payout history
              </Text>
              {myWalletTxns.length === 0 ? (
                <Text style={{ color: COLORS.muted, marginTop: 8 }}>
                  No payouts yet.
                </Text>
              ) : (
                myWalletTxns.map((t) => (
                  <View
                    key={t.id}
                    style={{
                      padding: 12,
                      borderRadius: 16,
                      backgroundColor: 'rgba(255,255,255,0.05)',
                      borderWidth: 1,
                      borderColor: COLORS.border,
                      marginTop: 10,
                    }}>
                    <Text style={{ color: COLORS.text, fontWeight: '900' }}>
                      {money(t.amount)}
                    </Text>
                    <Text
                      style={{
                        color: COLORS.muted,
                        marginTop: 4,
                        fontSize: 12,
                      }}>
                      {new Date(t.createdAt).toLocaleString()} • Job {t.jobId}
                    </Text>
                    <Text
                      style={{
                        color: COLORS.muted,
                        marginTop: 4,
                        fontSize: 12,
                      }}>
                      {t.note}
                    </Text>
                  </View>
                ))
              )}
            </Card>
          )}

          {/* CHECKOUT (CONDITIONAL TAB) */}
          {tab === 'Checkout' && (
            <>
              {!isPro ? (
                <Card
                  title="Checkout"
                  subtitle="Pay only when tradesman requests payment">
                  {myCustomerJobs.filter(
                    (j) =>
                      j.status === 'invoice_ready' ||
                      j.status === 'payment_requested'
                  ).length === 0 ? (
                    <Text style={{ color: COLORS.muted }}>
                      Nothing to checkout right now.
                    </Text>
                  ) : (
                    myCustomerJobs
                      .filter(
                        (j) =>
                          j.status === 'invoice_ready' ||
                          j.status === 'payment_requested'
                      )
                      .map((j) => {
                        const totals = computeTotals(j.invoice);
                        return (
                          <View
                            key={j.id}
                            style={{
                              padding: 12,
                              borderRadius: 18,
                              backgroundColor: COLORS.card2,
                              borderWidth: 1,
                              borderColor: COLORS.border,
                              marginBottom: 10,
                            }}>
                            <Text
                              style={{ color: COLORS.text, fontWeight: '900' }}>
                              {j.trade} • {j.serviceName}
                            </Text>
                            <Text
                              style={{
                                color: COLORS.muted,
                                marginTop: 6,
                                fontSize: 12,
                              }}>
                              When: {toReadableTime(j.scheduledAt)} • Status:{' '}
                              {j.status}
                            </Text>

                            <Text
                              style={{
                                color: COLORS.text,
                                fontWeight: '900',
                                marginTop: 10,
                              }}>
                              Totals
                            </Text>
                            <Text style={{ color: COLORS.muted, marginTop: 6 }}>
                              Parts: {money(totals.partsTotal)} • Labor:{' '}
                              {money(totals.laborTotal)} • Subtotal:{' '}
                              {money(totals.subtotal)}
                            </Text>
                            <Text style={{ color: COLORS.muted, marginTop: 6 }}>
                              Platform fee (2%): {money(totals.platformFee)} •
                              Tips can be cash.
                            </Text>

                            {j.status !== 'payment_requested' ? (
                              <Text
                                style={{ color: COLORS.muted, marginTop: 10 }}>
                                Tradesman must request payment before you can
                                pay.
                              </Text>
                            ) : (
                              <>
                                <Text
                                  style={{
                                    color: COLORS.muted,
                                    fontSize: 12,
                                    marginTop: 12,
                                  }}>
                                  Payment method (LOCKED)
                                </Text>
                                {!cardsUnlocked ? (
                                  <Btn
                                    title="Unlock Payment Methods"
                                    variant="primary"
                                    onPress={startUnlockCards}
                                  />
                                ) : (
                                  <>
                                    <Btn title="Lock" onPress={lockCards} />
                                    {me.profile.cards.length === 0 ? (
                                      <Text
                                        style={{
                                          color: COLORS.muted,
                                          marginTop: 10,
                                        }}>
                                        No cards saved. Add one in Profile →
                                        Payment Methods.
                                      </Text>
                                    ) : (
                                      me.profile.cards.map((c) => (
                                        <View
                                          key={c.id}
                                          style={{
                                            padding: 10,
                                            borderRadius: 14,
                                            borderWidth: 1,
                                            borderColor: COLORS.border,
                                            backgroundColor:
                                              'rgba(255,255,255,0.04)',
                                            marginTop: 10,
                                            flexDirection: 'row',
                                            alignItems: 'center',
                                          }}>
                                          <Text
                                            style={{
                                              color: COLORS.text,
                                              fontWeight: '900',
                                              flex: 1,
                                            }}>
                                            {c.brand} •••• {c.last4} •{' '}
                                            {String(c.expMonth).padStart(
                                              2,
                                              '0'
                                            )}
                                            /{String(c.expYear).slice(-2)}
                                          </Text>
                                          <Btn
                                            title="Pay"
                                            variant="primary"
                                            small
                                            onPress={() => payJob(j.id, c.id)}
                                          />
                                        </View>
                                      ))
                                    )}
                                  </>
                                )}
                              </>
                            )}

                            {j.status === 'paid' && (
                              <Text
                                style={{
                                  color: COLORS.text,
                                  marginTop: 10,
                                  fontWeight: '900',
                                }}>
                                Paid ✅
                              </Text>
                            )}

                            {j.status === 'completed' && (
                              <View
                                style={{
                                  marginTop: 12,
                                  padding: 12,
                                  borderRadius: 16,
                                  borderWidth: 1,
                                  borderColor: 'rgba(255,122,24,0.35)',
                                  backgroundColor: 'rgba(255,122,24,0.10)',
                                }}>
                                <Text
                                  style={{
                                    color: COLORS.text,
                                    fontWeight: '900',
                                  }}>
                                  Rate your tradesman (0–100)
                                </Text>
                                {j.customerRating != null ? (
                                  <Text
                                    style={{
                                      color: COLORS.muted,
                                      marginTop: 8,
                                    }}>
                                    You rated: {j.customerRating}/100
                                  </Text>
                                ) : (
                                  <Btn
                                    title="Rate 90 (demo)"
                                    variant="primary"
                                    onPress={() => submitRating(j.id, 90)}
                                  />
                                )}
                              </View>
                            )}
                          </View>
                        );
                      })
                  )}
                </Card>
              ) : (
                <Card
                  title="Checkout"
                  subtitle="Build invoice + request payment">
                  {myProJobs.filter((j) => j.status !== 'completed').length ===
                  0 ? (
                    <Text style={{ color: COLORS.muted }}>
                      No jobs needing invoice/payment.
                    </Text>
                  ) : (
                    myProJobs
                      .filter((j) => j.status !== 'completed')
                      .map((j) => {
                        const totals = computeTotals(j.invoice);

                        return (
                          <View
                            key={j.id}
                            style={{
                              padding: 12,
                              borderRadius: 18,
                              backgroundColor: COLORS.card2,
                              borderWidth: 1,
                              borderColor: COLORS.border,
                              marginBottom: 10,
                            }}>
                            <Text
                              style={{ color: COLORS.text, fontWeight: '900' }}>
                              {j.trade} • {j.serviceName}
                            </Text>
                            <Text
                              style={{
                                color: COLORS.muted,
                                marginTop: 6,
                                fontSize: 12,
                              }}>
                              Status: {j.status} • When:{' '}
                              {toReadableTime(j.scheduledAt)}
                            </Text>

                            <Text
                              style={{
                                color: COLORS.text,
                                fontWeight: '900',
                                marginTop: 10,
                              }}>
                              Labor
                            </Text>
                            <Text style={{ color: COLORS.muted, fontSize: 12 }}>
                              Hours
                            </Text>
                            <Inp
                              value={String(j.invoice.laborHours ?? 0)}
                              onChangeText={(t) =>
                                setInvoiceForJob(j.id, {
                                  ...j.invoice,
                                  laborHours: num(t),
                                })
                              }
                              placeholder="0"
                              keyboardType="number-pad"
                            />

                            <Text
                              style={{
                                color: COLORS.muted,
                                fontSize: 12,
                                marginTop: 10,
                              }}>
                              Hourly rate (auto-adjusts when requesting payment)
                            </Text>
                            <Inp
                              value={String(
                                j.invoice.laborRatePerHour ?? BASE_LABOR_RATE
                              )}
                              onChangeText={(t) =>
                                setInvoiceForJob(j.id, {
                                  ...j.invoice,
                                  laborRatePerHour: num(t),
                                })
                              }
                              placeholder={String(BASE_LABOR_RATE)}
                              keyboardType="number-pad"
                            />

                            <Text
                              style={{
                                color: COLORS.text,
                                fontWeight: '900',
                                marginTop: 10,
                              }}>
                              Invoice parts
                            </Text>
                            {j.invoice.invoiceParts.map((p) => (
                              <View
                                key={p.id}
                                style={{
                                  padding: 10,
                                  borderRadius: 14,
                                  borderWidth: 1,
                                  borderColor: COLORS.border,
                                  backgroundColor: 'rgba(255,255,255,0.04)',
                                  marginTop: 10,
                                }}>
                                <Text
                                  style={{ color: COLORS.muted, fontSize: 12 }}>
                                  Name
                                </Text>
                                <Inp
                                  value={p.name}
                                  onChangeText={(name) =>
                                    setInvoiceForJob(j.id, {
                                      ...j.invoice,
                                      invoiceParts: j.invoice.invoiceParts.map(
                                        (x) =>
                                          x.id === p.id ? { ...x, name } : x
                                      ),
                                    })
                                  }
                                  placeholder='Ex: 1/2" PEX elbow'
                                />
                                <View style={{ flexDirection: 'row' }}>
                                  <View style={{ flex: 1, marginRight: 10 }}>
                                    <Text
                                      style={{
                                        color: COLORS.muted,
                                        fontSize: 12,
                                        marginTop: 8,
                                      }}>
                                      Qty
                                    </Text>
                                    <Inp
                                      value={String(p.qty)}
                                      onChangeText={(t) =>
                                        setInvoiceForJob(j.id, {
                                          ...j.invoice,
                                          invoiceParts:
                                            j.invoice.invoiceParts.map((x) =>
                                              x.id === p.id
                                                ? {
                                                    ...x,
                                                    qty: Math.max(
                                                      0,
                                                      Math.round(num(t))
                                                    ),
                                                  }
                                                : x
                                            ),
                                        })
                                      }
                                      placeholder="1"
                                      keyboardType="number-pad"
                                    />
                                  </View>
                                  <View style={{ flex: 1 }}>
                                    <Text
                                      style={{
                                        color: COLORS.muted,
                                        fontSize: 12,
                                        marginTop: 8,
                                      }}>
                                      Unit $
                                    </Text>
                                    <Inp
                                      value={String(p.unit)}
                                      onChangeText={(t) =>
                                        setInvoiceForJob(j.id, {
                                          ...j.invoice,
                                          invoiceParts:
                                            j.invoice.invoiceParts.map((x) =>
                                              x.id === p.id
                                                ? { ...x, unit: num(t) }
                                                : x
                                            ),
                                        })
                                      }
                                      placeholder="0"
                                      keyboardType="number-pad"
                                    />
                                  </View>
                                </View>

                                <Btn
                                  title="Remove"
                                  small
                                  variant="danger"
                                  onPress={() =>
                                    setInvoiceForJob(j.id, {
                                      ...j.invoice,
                                      invoiceParts:
                                        j.invoice.invoiceParts.filter(
                                          (x) => x.id !== p.id
                                        ),
                                    })
                                  }
                                />
                              </View>
                            ))}

                            <Btn
                              title="Add invoice part"
                              onPress={() =>
                                setInvoiceForJob(j.id, {
                                  ...j.invoice,
                                  invoiceParts: [
                                    ...j.invoice.invoiceParts,
                                    {
                                      id: `pl_${Date.now()}`,
                                      name: '',
                                      qty: 1,
                                      unit: 0,
                                    },
                                  ],
                                })
                              }
                            />

                            <Text
                              style={{
                                color: COLORS.text,
                                fontWeight: '900',
                                marginTop: 14,
                              }}>
                              Other parts (not listed)
                            </Text>
                            {j.invoice.otherParts.map((p) => (
                              <View
                                key={p.id}
                                style={{
                                  padding: 10,
                                  borderRadius: 14,
                                  borderWidth: 1,
                                  borderColor: COLORS.border,
                                  backgroundColor: 'rgba(255,255,255,0.04)',
                                  marginTop: 10,
                                }}>
                                <Text
                                  style={{ color: COLORS.muted, fontSize: 12 }}>
                                  Name
                                </Text>
                                <Inp
                                  value={p.name}
                                  onChangeText={(name) =>
                                    setInvoiceForJob(j.id, {
                                      ...j.invoice,
                                      otherParts: j.invoice.otherParts.map(
                                        (x) =>
                                          x.id === p.id ? { ...x, name } : x
                                      ),
                                    })
                                  }
                                  placeholder="Ex: Specialty fitting"
                                />
                                <View style={{ flexDirection: 'row' }}>
                                  <View style={{ flex: 1, marginRight: 10 }}>
                                    <Text
                                      style={{
                                        color: COLORS.muted,
                                        fontSize: 12,
                                        marginTop: 8,
                                      }}>
                                      Qty
                                    </Text>
                                    <Inp
                                      value={String(p.qty)}
                                      onChangeText={(t) =>
                                        setInvoiceForJob(j.id, {
                                          ...j.invoice,
                                          otherParts: j.invoice.otherParts.map(
                                            (x) =>
                                              x.id === p.id
                                                ? {
                                                    ...x,
                                                    qty: Math.max(
                                                      0,
                                                      Math.round(num(t))
                                                    ),
                                                  }
                                                : x
                                          ),
                                        })
                                      }
                                      placeholder="1"
                                      keyboardType="number-pad"
                                    />
                                  </View>
                                  <View style={{ flex: 1 }}>
                                    <Text
                                      style={{
                                        color: COLORS.muted,
                                        fontSize: 12,
                                        marginTop: 8,
                                      }}>
                                      Unit $
                                    </Text>
                                    <Inp
                                      value={String(p.unit)}
                                      onChangeText={(t) =>
                                        setInvoiceForJob(j.id, {
                                          ...j.invoice,
                                          otherParts: j.invoice.otherParts.map(
                                            (x) =>
                                              x.id === p.id
                                                ? { ...x, unit: num(t) }
                                                : x
                                          ),
                                        })
                                      }
                                      placeholder="0"
                                      keyboardType="number-pad"
                                    />
                                  </View>
                                </View>

                                <Btn
                                  title="Remove"
                                  small
                                  variant="danger"
                                  onPress={() =>
                                    setInvoiceForJob(j.id, {
                                      ...j.invoice,
                                      otherParts: j.invoice.otherParts.filter(
                                        (x) => x.id !== p.id
                                      ),
                                    })
                                  }
                                />
                              </View>
                            ))}

                            <Btn
                              title="Add other part"
                              onPress={() =>
                                setInvoiceForJob(j.id, {
                                  ...j.invoice,
                                  otherParts: [
                                    ...j.invoice.otherParts,
                                    {
                                      id: `opl_${Date.now()}`,
                                      name: '',
                                      qty: 1,
                                      unit: 0,
                                    },
                                  ],
                                })
                              }
                            />

                            <Text
                              style={{
                                color: COLORS.text,
                                fontWeight: '900',
                                marginTop: 14,
                              }}>
                              Notes
                            </Text>
                            <Inp
                              value={j.invoice.invoiceNotes}
                              onChangeText={(t) =>
                                setInvoiceForJob(j.id, {
                                  ...j.invoice,
                                  invoiceNotes: t,
                                })
                              }
                              placeholder="Optional invoice notes…"
                              multiline
                            />

                            <View
                              style={{
                                padding: 12,
                                borderRadius: 16,
                                borderWidth: 1,
                                borderColor: 'rgba(255,122,24,0.35)',
                                backgroundColor: 'rgba(255,122,24,0.10)',
                                marginTop: 12,
                              }}>
                              <Text
                                style={{
                                  color: COLORS.text,
                                  fontWeight: '900',
                                }}>
                                Customer pays: {money(totals.subtotal)} • Fee:{' '}
                                {money(totals.platformFee)} • You get:{' '}
                                {money(totals.proPayout)}
                              </Text>
                            </View>

                            <View
                              style={{
                                flexDirection: 'row',
                                flexWrap: 'wrap',
                              }}>
                              <Btn
                                title="Directions"
                                variant="primary"
                                onPress={() => linkToDirections(j.houseCoords)}
                              />
                              <Btn
                                title="Request payment"
                                variant="primary"
                                onPress={() => requestPayment(j.id)}
                              />
                              <Btn
                                title="Upload proof"
                                onPress={() => uploadProof(j.id)}
                              />
                            </View>
                          </View>
                        );
                      })
                  )}

                  {/* PIN modal-ish blocks */}
                  {pinMode !== 'none' && (
                    <Card title="Payment Methods Lock" subtitle="PIN required">
                      {pinMode === 'set' ? (
                        <>
                          <Text style={{ color: COLORS.muted, fontSize: 12 }}>
                            Set PIN (4–6 digits)
                          </Text>
                          <Inp
                            value={pinA}
                            onChangeText={setPinA}
                            placeholder="PIN"
                            keyboardType="number-pad"
                            secure
                          />
                          <Text
                            style={{
                              color: COLORS.muted,
                              fontSize: 12,
                              marginTop: 10,
                            }}>
                            Confirm PIN
                          </Text>
                          <Inp
                            value={pinB}
                            onChangeText={setPinB}
                            placeholder="PIN"
                            keyboardType="number-pad"
                            secure
                          />
                          <View
                            style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                            <Btn
                              title="Set PIN"
                              variant="primary"
                              onPress={finishSetPin}
                            />
                            <Btn
                              title="Cancel"
                              onPress={() => {
                                setPinMode('none');
                                setPinA('');
                                setPinB('');
                              }}
                            />
                          </View>
                        </>
                      ) : (
                        <>
                          <Text style={{ color: COLORS.muted, fontSize: 12 }}>
                            Enter PIN
                          </Text>
                          <Inp
                            value={pinIn}
                            onChangeText={setPinIn}
                            placeholder="PIN"
                            keyboardType="number-pad"
                            secure
                          />
                          <View
                            style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                            <Btn
                              title="Unlock"
                              variant="primary"
                              onPress={finishEnterPin}
                            />
                            <Btn
                              title="Cancel"
                              onPress={() => {
                                setPinMode('none');
                                setPinIn('');
                              }}
                            />
                          </View>
                        </>
                      )}
                    </Card>
                  )}
                </Card>
              )}
            </>
          )}

          {/* PROFILE */}
          {tab === 'Profile' && (
            <>
              <Card
                title="Profile"
                subtitle={
                  me.role === 'pro'
                    ? 'Your work profile + settings'
                    : 'Your account + payment methods (locked)'
                }>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Image
                    source={
                      me.profile.photoUri ? { uri: me.profile.photoUri } : LOGO
                    }
                    style={{
                      width: 56,
                      height: 56,
                      borderRadius: 999,
                      borderWidth: 1,
                      borderColor: COLORS.border,
                    }}
                  />
                  <View style={{ marginLeft: 12, flex: 1 }}>
                    <Text
                      style={{
                        color: COLORS.text,
                        fontWeight: '900',
                        fontSize: 16,
                      }}>
                      {me.profile.fullName}
                    </Text>
                    <Text style={{ color: COLORS.muted, marginTop: 4 }}>
                      Email: {me.email} • Phone:{' '}
                      {me.profile.privacy.hidePhone ? 'Hidden' : me.phone}
                    </Text>
                  </View>
                </View>

                <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                  <Btn title="Update location" onPress={refreshMyLocation} />
                  <Btn
                    title="Change photo"
                    variant="primary"
                    onPress={async () => {
                      const uri = await pickPhoto();
                      if (uri) updateMeProfile({ photoUri: uri });
                    }}
                  />
                </View>

                {me.role === 'pro' && (
                  <>
                    <Text
                      style={{
                        color: COLORS.text,
                        fontWeight: '900',
                        marginTop: 12,
                      }}>
                      Your work feed
                    </Text>
                    <Btn
                      title="Post work (photo)"
                      variant="primary"
                      onPress={createPortfolioPost}
                    />
                    {portfolioPosts.filter((p) => p.proId === me.id).length ===
                    0 ? (
                      <Text style={{ color: COLORS.muted, marginTop: 8 }}>
                        No posts yet.
                      </Text>
                    ) : (
                      portfolioPosts
                        .filter((p) => p.proId === me.id)
                        .slice(0, 6)
                        .map((p) => (
                          <View
                            key={p.id}
                            style={{
                              padding: 12,
                              borderRadius: 16,
                              borderWidth: 1,
                              borderColor: COLORS.border,
                              backgroundColor: 'rgba(255,255,255,0.04)',
                              marginTop: 10,
                            }}>
                            <Text
                              style={{ color: COLORS.text, fontWeight: '900' }}>
                              {p.caption}
                            </Text>
                            <Text
                              style={{
                                color: COLORS.muted,
                                marginTop: 4,
                                fontSize: 12,
                              }}>
                              ❤️ {p.likes} •{' '}
                              {new Date(p.createdAt).toLocaleString()}
                            </Text>
                          </View>
                        ))
                    )}
                  </>
                )}

                {me.role === 'customer' && (
                  <>
                    <Text
                      style={{
                        color: COLORS.text,
                        fontWeight: '900',
                        marginTop: 14,
                      }}>
                      Payment Methods (LOCKED)
                    </Text>
                    {!cardsUnlocked ? (
                      <Btn
                        title={me.pinHash ? 'Unlock' : 'Set PIN & Unlock'}
                        variant="primary"
                        onPress={startUnlockCards}
                      />
                    ) : (
                      <>
                        <Btn title="Lock" onPress={lockCards} />
                        <PaymentMethodsPanel
                          me={me}
                          addCard={addCard}
                          removeCard={removeCard}
                        />
                      </>
                    )}
                  </>
                )}
              </Card>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      <BottomTabs tabs={tabsForRole} active={tab} onPick={setTab} />
    </SafeAreaView>
  );
}

// Separate component to avoid hooks issues if expanded later
function PaymentMethodsPanel(props: {
  me: User;
  addCard: (cardNum: string, expMM: string, expYY: string) => void;
  removeCard: (id: string) => void;
}) {
  const [cardNum, setCardNum] = useState('');
  const [expMM, setExpMM] = useState('');
  const [expYY, setExpYY] = useState('');

  return (
    <View style={{ marginTop: 10 }}>
      <Text style={{ color: COLORS.muted, fontSize: 12 }}>
        Add a real card (format validated)
      </Text>
      <Inp
        value={cardNum}
        onChangeText={setCardNum}
        placeholder="Card number"
        keyboardType="number-pad"
      />
      <View style={{ flexDirection: 'row' }}>
        <View style={{ flex: 1, marginRight: 10 }}>
          <Inp
            value={expMM}
            onChangeText={setExpMM}
            placeholder="MM"
            keyboardType="number-pad"
          />
        </View>
        <View style={{ flex: 1 }}>
          <Inp
            value={expYY}
            onChangeText={setExpYY}
            placeholder="YYYY"
            keyboardType="number-pad"
          />
        </View>
      </View>

      <Btn
        title="Save card"
        variant="primary"
        onPress={() => {
          props.addCard(cardNum, expMM, expYY);
          setCardNum('');
          setExpMM('');
          setExpYY('');
        }}
      />

      <Text style={{ color: COLORS.text, fontWeight: '900', marginTop: 12 }}>
        Saved cards
      </Text>
      {props.me.profile.cards.length === 0 ? (
        <Text style={{ color: COLORS.muted, marginTop: 8 }}>
          No cards saved yet.
        </Text>
      ) : (
        props.me.profile.cards.map((c) => (
          <View
            key={c.id}
            style={{
              padding: 12,
              borderRadius: 16,
              backgroundColor: 'rgba(255,255,255,0.05)',
              borderWidth: 1,
              borderColor: COLORS.border,
              marginTop: 10,
              flexDirection: 'row',
              alignItems: 'center',
            }}>
            <Text style={{ color: COLORS.text, fontWeight: '900', flex: 1 }}>
              {c.brand} •••• {c.last4} • {String(c.expMonth).padStart(2, '0')}/
              {String(c.expYear).slice(-2)}
            </Text>
            <Btn
              title="Remove"
              small
              variant="danger"
              onPress={() => props.removeCard(c.id)}
            />
          </View>
        ))
      )}

      <Text style={{ color: COLORS.muted, marginTop: 12, fontSize: 12 }}>
        ⚠️ This is still a prototype vault. To charge real cards, add Stripe
        (recommended) with a backend PaymentIntent.
      </Text>
    </View>
  );
}
