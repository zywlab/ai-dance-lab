import { useEffect, useMemo, useRef, useState } from "react";
import { StatusBar } from "expo-status-bar";
import Constants from "expo-constants";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystemLegacy from "expo-file-system/legacy";
import * as ImagePicker from "expo-image-picker";
import * as VideoThumbnails from "expo-video-thumbnails";
import { VideoView, useVideoPlayer } from "expo-video";
import { CameraView, useCameraPermissions } from "expo-camera";
import Slider from "@react-native-community/slider";
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  Modal,
  PanResponder,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { buildMockEvaluationPayload, EvaluationScenario, PoseFrame } from "./src/mockMotion";
import { detectPeopleBoxesFromImage, estimatePoseFrameFromImage } from "./src/pose/livePoseEstimator";

const resolveApiBaseUrl = () => {
  const explicit = process.env.EXPO_PUBLIC_API_BASE_URL?.trim();
  if (explicit) return explicit;

  const hostUri =
    Constants.expoConfig?.hostUri ??
    (Constants as { manifest2?: { extra?: { expoGo?: { debuggerHost?: string } } } }).manifest2?.extra?.expoGo
      ?.debuggerHost;
  const host = hostUri?.split(":")[0];
  if (host) return `http://${host}:8000`;

  return "http://127.0.0.1:8000";
};

const API_BASE_URL = resolveApiBaseUrl();

type DanceStyle = "hiphop" | "kpop" | "jazz" | "jazz_funk" | "heels";
type CaptureMode = "mock" | "live";
type CoachLanguage = "zh" | "en";
type FollowInputMode = "upload" | "camera";
type InputMode = "upload" | "camera";

type CropRoi = { x: number; y: number; w: number; h: number };
type CropEdgeMode = "left" | "right" | "top" | "bottom";
type PersonCandidate = { id: string; box: CropRoi; score: number };
type PickerRole = "reference" | "practice";
type UploadPickerTarget = "reference" | "practice";

type BeatAnalysis = {
  bpm: number;
  beats: number[];
  groups: number[][];
  confidence: number;
  source?: string;
};

type MusicAlignPayload = {
  offsetMs: number;
  overlapRefStartMs: number;
  overlapPracticeStartMs: number;
  confidence?: number;
  source?: string;
};

type MovementResult = {
  overallScore: number;
  style?: { code: string; label: string; focus: string[] };
  terminology?: {
    language: "zh" | "en";
    active: string[];
    bilingual: Array<{ zh: string; en: string }>;
  };
  timingAnalysis?: {
    summary: { lateCount: number; earlyCount: number; stableCount: number };
    markers: Array<{
      beatIndex: number;
      beatTime: number;
      deltaSec: number | null;
      status: "late" | "early" | "on_time" | "unknown";
      severity: "high" | "medium" | "low";
      color: string;
    }>;
  };
  phaseAnalysis?: {
    summary: { unstableCount: number; stableCount: number };
    beats: Array<{
      beatIndex: number;
      beatTime: number;
      phases: {
        preHit: { delta: number | null; status: string; color: string };
        hit: { delta: number | null; status: string; color: string };
        release: { delta: number | null; status: string; color: string };
      };
    }>;
  };
  homePractice?: {
    mode: string;
    strategy: string;
    topPriorities: Array<{
      area: string;
      category: string;
      current: number;
      target: number;
      severity: string;
      cue: string;
      doneWhen: string;
    }>;
    criticalBeats: Array<{ beatIndex: number; status: string; deltaSec: number | null }>;
    dailyLoop: string[];
  };
  categories: Record<string, number>;
  jointBreakdown: Record<string, number>;
  issues: Array<{
    area: string;
    severity: string;
    problem: string;
    fix: string;
    muscleFocus: string[];
    physics: string;
  }>;
  professional?: {
    coachingMode: string;
    tone: string;
    corePrinciples: string[];
    correctionPlan: Array<{
      order: number;
      focusArea: string;
      severity: string;
      objective: string;
      intervention: string;
      muscleCue: string;
      biomechCue: string;
      dosage: string;
    }>;
    drillDeck: Array<{ name: string; stage: string; target: string }>;
    sessionPlan: {
      warmup: string;
      technical: string;
      phraseWork: string;
      performance: string;
      cooldown: string;
    };
    progressionReadiness: string;
    weakLinks: Array<{ name: string; score: number }>;
  };
  coachingSummary: string;
};

type TrainingDrill = {
  id: string;
  title: string;
  cue: string;
  startMs: number;
  endMs: number;
  sets: number;
  workSec: number;
  restSec: number;
};

type CourseTemplate = {
  style: string;
  language: "zh" | "en";
  template: {
    title: string;
    durationMin: number;
    goals: string[];
    legalNote: string;
    resources: Array<{
      title: string;
      platform: string;
      type: string;
      url: string;
    }>;
  };
};

type CuratedVideo = {
  videoId?: string;
  title: string;
  channelTitle: string;
  url: string;
  likes: number | null;
  views: number | null;
  comments: number | null;
  favoriteProxy: number | null;
  score: number | null;
};

type CuratedVideoPayload = {
  style: string;
  language: "zh" | "en";
  mode: string;
  note: string;
  disclaimer: string;
  videos: CuratedVideo[];
};

type RealtimeInsights = {
  timeline: Array<{
    window: { start: number; end: number };
    overallScore: number;
    weakCategory: { name: string; score: number } | null;
    categories: Record<string, number>;
  }>;
  overallTrend: number[];
  cues: Array<{
    atWindow: { start: number; end: number };
    focus: string;
    score: number;
  }>;
  beatComparison?: {
    summary: { lateCount: number; earlyCount: number; stableCount: number };
    markers: Array<{
      beatIndex: number;
      beatTime: number;
      deltaSec: number | null;
      status: string;
      severity: string;
      color: string;
    }>;
  };
  phaseComparison?: {
    summary: { unstableCount: number; stableCount: number };
    beats: Array<{
      beatIndex: number;
      beatTime: number;
      phases: {
        preHit: { delta: number | null; status: string; color: string };
        hit: { delta: number | null; status: string; color: string };
        release: { delta: number | null; status: string; color: string };
      };
    }>;
  };
};

function clampSpeed(value: number): number {
  return Math.max(0.5, Math.min(1.0, Number(value.toFixed(1))));
}

function buildFileType(mimeType?: string | null, name?: string): string {
  if (mimeType) return mimeType;
  if (!name) return "video/mp4";
  if (name.endsWith(".mov")) return "video/quicktime";
  if (name.endsWith(".mp3")) return "audio/mpeg";
  if (name.endsWith(".wav")) return "audio/wav";
  return "video/mp4";
}

function getVideoFileExtension(nameOrUri?: string | null): string {
  const raw = (nameOrUri || "").toLowerCase();
  if (raw.endsWith(".mov")) return "mov";
  if (raw.endsWith(".m4v")) return "m4v";
  if (raw.endsWith(".webm")) return "webm";
  if (raw.endsWith(".avi")) return "avi";
  if (raw.endsWith(".mkv")) return "mkv";
  return "mp4";
}

function formatTimeLabel(seconds: number): string {
  const safe = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function parseMusicRate(text: string): number {
  const value = Number(text);
  if (!Number.isFinite(value)) return 1;
  return Math.max(0.25, Math.min(4, Number(value.toFixed(2))));
}

function clampRoi(roi: CropRoi): CropRoi {
  const minW = 0.18;
  const minH = 0.18;
  const w = Math.max(minW, Math.min(1, roi.w));
  const h = Math.max(minH, Math.min(1, roi.h));
  const x = Math.max(0, Math.min(1 - w, roi.x));
  const y = Math.max(0, Math.min(1 - h, roi.y));
  return { x, y, w, h };
}

function roiFromCandidate(box: CropRoi): CropRoi {
  const padding = 0.08;
  return clampRoi({
    x: box.x - padding,
    y: box.y - padding,
    w: box.w + padding * 2,
    h: box.h + padding * 2,
  });
}

function withCropInsetIfFull(roi: CropRoi, inset = 0.02): CropRoi {
  const nearFull = roi.w >= 0.995 && roi.h >= 0.995;
  if (!nearFull) return clampRoi(roi);
  return clampRoi({ x: inset, y: inset, w: 1 - inset * 2, h: 1 - inset * 2 });
}

function moveRoiByCanvasDrag(start: CropRoi, dxNorm: number, dyNorm: number): CropRoi {
  return clampRoi({
    x: start.x + dxNorm,
    y: start.y + dyNorm,
    w: start.w,
    h: start.h,
  });
}

function scaleRoiByPinch(start: CropRoi, scale: number, anchorX: number, anchorY: number): CropRoi {
  const safeScale = Math.max(0.4, Math.min(3, scale));
  const targetW = Math.max(0.18, Math.min(1, start.w * safeScale));
  const targetH = Math.max(0.18, Math.min(1, start.h * safeScale));
  const ratioW = targetW / Math.max(0.0001, start.w);
  const ratioH = targetH / Math.max(0.0001, start.h);

  return clampRoi({
    x: anchorX - (anchorX - start.x) * ratioW,
    y: anchorY - (anchorY - start.y) * ratioH,
    w: targetW,
    h: targetH,
  });
}

function extractPinchInfo(evt: { nativeEvent: { touches?: Array<{ locationX?: number; locationY?: number; pageX?: number; pageY?: number }> } }) {
  const touches = evt.nativeEvent.touches || [];
  if (touches.length < 2) return null;
  const t1 = touches[0];
  const t2 = touches[1];
  const x1 = t1.locationX ?? t1.pageX ?? 0;
  const y1 = t1.locationY ?? t1.pageY ?? 0;
  const x2 = t2.locationX ?? t2.pageX ?? 0;
  const y2 = t2.locationY ?? t2.pageY ?? 0;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const distance = Math.sqrt(dx * dx + dy * dy);
  return {
    distance,
    centerX: (x1 + x2) / 2,
    centerY: (y1 + y2) / 2,
  };
}

function resizeRoiByEdge(start: CropRoi, edge: CropEdgeMode, dxNorm: number, dyNorm: number): CropRoi {
  switch (edge) {
    case "left":
      return clampRoi({ x: start.x + dxNorm, y: start.y, w: start.w - dxNorm, h: start.h });
    case "right":
      return clampRoi({ x: start.x, y: start.y, w: start.w + dxNorm, h: start.h });
    case "top":
      return clampRoi({ x: start.x, y: start.y + dyNorm, w: start.w, h: start.h - dyNorm });
    default:
      return clampRoi({ x: start.x, y: start.y, w: start.w, h: start.h + dyNorm });
  }
}

const STYLE_OPTIONS: DanceStyle[] = ["hiphop", "kpop", "jazz", "jazz_funk", "heels"];
const DEFAULT_CROP_ROI: CropRoi = { x: 0, y: 0, w: 1, h: 1 };

function buildPeopleSampleTimes(durationSec: number): number[] {
  const base = [0, 250, 700, 1200, 2000, 3200, 4800, 6800, 9200];
  const maxMs = Math.max(1000, Math.round(durationSec * 1000) - 120);
  const inRange = base.filter((t) => t <= maxMs);
  if (!inRange.length) return [0, 250, 700];
  return Array.from(new Set(inRange));
}

function styleLabel(style: DanceStyle, lang: CoachLanguage): string {
  const map: Record<DanceStyle, { zh: string; en: string }> = {
    hiphop: { zh: "嘻哈", en: "Hip-hop" },
    kpop: { zh: "K-pop", en: "K-pop" },
    jazz: { zh: "爵士", en: "Jazz" },
    jazz_funk: { zh: "爵士放克", en: "Jazz Funk" },
    heels: { zh: "高跟", en: "Heels" },
  };
  return map[style][lang];
}

function parseDosage(dosage?: string): { sets: number; workSec: number; restSec: number } {
  if (!dosage) return { sets: 2, workSec: 40, restSec: 20 };
  const setsMatch = dosage.match(/(\d+)\s*sets?/i);
  const workMatch = dosage.match(/(\d+)s\s*work/i);
  const restMatch = dosage.match(/(\d+)s\s*rest/i);
  return {
    sets: setsMatch ? Number(setsMatch[1]) : 2,
    workSec: workMatch ? Number(workMatch[1]) : 40,
    restSec: restMatch ? Number(restMatch[1]) : 20,
  };
}

function segmentRangeMs(beatData: BeatAnalysis | null, segmentIndex: number, bpmFallback: number): { startMs: number; endMs: number } {
  const beatSeconds = beatData?.beats || [];
  const groups = beatData?.groups || [];
  const group = groups[segmentIndex] || groups[0] || [0, 1, 2, 3, 4, 5, 6, 7];
  const firstIdx = group[0] || 0;
  const lastIdx = group[group.length - 1] || firstIdx;
  const beatDur = 60 / Math.max(1, bpmFallback);
  const startSec = typeof beatSeconds[firstIdx] === "number" ? beatSeconds[firstIdx] : firstIdx * beatDur;
  const nextBeat = beatSeconds[lastIdx + 1];
  const endSec = typeof nextBeat === "number" ? nextBeat : startSec + group.length * beatDur;
  return {
    startMs: Math.max(0, Math.round(startSec * 1000)),
    endMs: Math.max(1000, Math.round(endSec * 1000)),
  };
}

function computeRobustBeatOffsetMs(reference: BeatAnalysis | null, practice: BeatAnalysis | null): number | null {
  const ref = reference?.beats || [];
  const prac = practice?.beats || [];
  if (ref.length < 2 || prac.length < 2) return null;

  const sampleProgress = [0, 0.25, 0.5, 0.75, 1];
  const samples = sampleProgress
    .map((p) => {
      const refIdx = Math.max(0, Math.min(ref.length - 1, Math.round((ref.length - 1) * p)));
      const pracIdx = Math.max(0, Math.min(prac.length - 1, Math.round((prac.length - 1) * p)));
      return (prac[pracIdx] - ref[refIdx]) * 1000;
    })
    .filter((v) => Number.isFinite(v));

  if (!samples.length) return null;
  samples.sort((a, b) => a - b);
  return Math.round(samples[Math.floor(samples.length / 2)]);
}

function computeOverlapAlignmentByBeats(
  reference: BeatAnalysis | null,
  practice: BeatAnalysis | null,
): { offsetMs: number; overlapRefStartMs: number; overlapPracticeStartMs: number; matchCount: number } | null {
  const ref = reference?.beats || [];
  const prac = practice?.beats || [];
  if (ref.length < 4 || prac.length < 4) return null;

  const toleranceSec = 0.12;
  let best: { score: number; offsetSec: number; matches: number } | null = null;

  const refSampleStep = Math.max(1, Math.floor(ref.length / 24));
  const pracSampleStep = Math.max(1, Math.floor(prac.length / 24));

  for (let i = 0; i < ref.length; i += refSampleStep) {
    for (let j = 0; j < prac.length; j += pracSampleStep) {
      const offsetSec = prac[j] - ref[i];
      let matches = 0;
      let totalError = 0;
      let p = 0;

      for (let r = 0; r < ref.length; r += 1) {
        const target = ref[r] + offsetSec;
        while (p + 1 < prac.length && Math.abs(prac[p + 1] - target) <= Math.abs(prac[p] - target)) p += 1;
        const err = Math.abs(prac[p] - target);
        if (err <= toleranceSec) {
          matches += 1;
          totalError += err;
        }
      }

      const score = matches * 10 - totalError;
      if (!best || score > best.score) {
        best = { score, offsetSec, matches };
      }
    }
  }

  if (!best || best.matches < 4) return null;

  const offsetMs = Math.round(best.offsetSec * 1000);
  const overlapRefStartMs = Math.max(0, Math.round(-offsetMs));
  const overlapPracticeStartMs = Math.max(0, Math.round(offsetMs));

  return {
    offsetMs,
    overlapRefStartMs,
    overlapPracticeStartMs,
    matchCount: best.matches,
  };
}

function computeFineOffsetMs(
  reference: BeatAnalysis | null,
  practice: BeatAnalysis | null,
  coarseOffsetMs: number,
): number | null {
  const ref = reference?.beats || [];
  const prac = practice?.beats || [];
  if (ref.length < 4 || prac.length < 4) return null;

  const scoreAtOffset = (offsetMs: number): number => {
    const offsetSec = offsetMs / 1000;
    let p = 0;
    let matched = 0;
    let totalErr = 0;
    for (let r = 0; r < ref.length; r += 1) {
      const target = ref[r] + offsetSec;
      while (p + 1 < prac.length && Math.abs(prac[p + 1] - target) <= Math.abs(prac[p] - target)) p += 1;
      const err = Math.abs(prac[p] - target);
      if (err <= 0.09) {
        matched += 1;
        totalErr += err;
      }
    }
    if (!matched) return -Infinity;
    return matched * 1000 - totalErr * 10000;
  };

  let bestOffset = coarseOffsetMs;
  let bestScore = scoreAtOffset(coarseOffsetMs);

  for (let delta = -320; delta <= 320; delta += 2) {
    const candidate = coarseOffsetMs + delta;
    const score = scoreAtOffset(candidate);
    if (score > bestScore) {
      bestScore = score;
      bestOffset = candidate;
    }
  }

  return Number.isFinite(bestScore) ? bestOffset : null;
}

function computeDynamicOffsetMsAtReferenceTime(
  reference: BeatAnalysis | null,
  practice: BeatAnalysis | null,
  referenceTimeSec: number,
): number | null {
  const ref = reference?.beats || [];
  const prac = practice?.beats || [];
  if (ref.length < 2 || prac.length < 2) return null;

  const refStart = ref[0];
  const refEnd = ref[ref.length - 1];
  const refSpan = Math.max(0.001, refEnd - refStart);
  const p = Math.max(0, Math.min(1, (referenceTimeSec - refStart) / refSpan));

  const pracFloat = p * (prac.length - 1);
  const pracIdxA = Math.floor(pracFloat);
  const pracIdxB = Math.min(prac.length - 1, pracIdxA + 1);
  const pracAlpha = pracFloat - pracIdxA;
  const expectedPracticeTime = prac[pracIdxA] + (prac[pracIdxB] - prac[pracIdxA]) * pracAlpha;

  return Math.round((expectedPracticeTime - referenceTimeSec) * 1000);
}

function recommendAbSettings(result: MovementResult | null): {
  windowBeats: number;
  repeats: number;
  reasonZh: string;
  reasonEn: string;
} {
  if (!result) {
    return {
      windowBeats: 1,
      repeats: 3,
      reasonZh: "默认中等强度复练。",
      reasonEn: "Default medium-intensity loop.",
    };
  }

  const timingMarkers = result.timingAnalysis?.markers || [];
  const severeTiming = timingMarkers.filter((m) => m.status === "late" || m.status === "early").length;
  const unstablePhases = result.phaseAnalysis?.summary?.unstableCount || 0;
  const highIssues = (result.issues || []).filter((i) => i.severity === "high").length;

  if (highIssues >= 2 || severeTiming >= 4 || unstablePhases >= 4) {
    return {
      windowBeats: 2,
      repeats: 6,
      reasonZh: "错误密度较高，建议扩大窗口并增加循环次数。",
      reasonEn: "High error density detected. Use wider window and more repeats.",
    };
  }

  if (highIssues === 1 || severeTiming >= 2 || unstablePhases >= 2) {
    return {
      windowBeats: 1,
      repeats: 4,
      reasonZh: "存在明显节奏/相位偏差，建议中窗口强化。",
      reasonEn: "Noticeable timing/phase drift. Use medium window reinforcement.",
    };
  }

  return {
    windowBeats: 0.5,
    repeats: 4,
    reasonZh: "整体稳定，建议小窗口精修卡点。",
    reasonEn: "Overall stable. Use short window for precision polish.",
  };
}

export default function App() {
  const cameraRef = useRef<CameraView | null>(null);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [videoUri, setVideoUri] = useState<string | null>(null);
  const [videoName, setVideoName] = useState<string | null>(null);
  const [practiceVideoUri, setPracticeVideoUri] = useState<string | null>(null);
  const [practiceVideoName, setPracticeVideoName] = useState<string | null>(null);
  const [speed, setSpeed] = useState(1.0);
  const [isLoadingBeat, setIsLoadingBeat] = useState(false);
  const [beatData, setBeatData] = useState<BeatAnalysis | null>(null);
  const [practiceBeatData, setPracticeBeatData] = useState<BeatAnalysis | null>(null);
  const [currentBeatIndex, setCurrentBeatIndex] = useState(0);
  const [segmentMode, setSegmentMode] = useState(true);
  const [selectedSegment, setSelectedSegment] = useState(0);
  const [scenario, setScenario] = useState<EvaluationScenario>("balanced");
  const [captureMode, setCaptureMode] = useState<CaptureMode>("live");
  const [referenceInputMode, setReferenceInputMode] = useState<InputMode>("upload");
  const [followInputMode, setFollowInputMode] = useState<FollowInputMode>("upload");
  const [style, setStyle] = useState<DanceStyle>("hiphop");
  const [coachLanguage, setCoachLanguage] = useState<CoachLanguage>("zh");
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [movementResult, setMovementResult] = useState<MovementResult | null>(null);
  const [feedbackVisible, setFeedbackVisible] = useState(false);
  const [showResourcePanel, setShowResourcePanel] = useState(false);
  const [capturedLiveFrames, setCapturedLiveFrames] = useState<PoseFrame[] | null>(null);
  const [realtimeInsights, setRealtimeInsights] = useState<RealtimeInsights | null>(null);
  const [lastLiveFrames, setLastLiveFrames] = useState(0);
  const [captureProgress, setCaptureProgress] = useState(0);
  const [liveHint, setLiveHint] = useState<string>("");
  const [lastPickerError, setLastPickerError] = useState<string | null>(null);
  const [trainingPlan, setTrainingPlan] = useState<TrainingDrill[]>([]);
  const [trainingActive, setTrainingActive] = useState(false);
  const [trainingDrillIndex, setTrainingDrillIndex] = useState(0);
  const [trainingSetIndex, setTrainingSetIndex] = useState(1);
  const [trainingPhase, setTrainingPhase] = useState<"work" | "rest" | "done">("done");
  const [phaseSecondsLeft, setPhaseSecondsLeft] = useState(0);
  const [courseTemplate, setCourseTemplate] = useState<CourseTemplate | null>(null);
  const [curatedVideos, setCuratedVideos] = useState<CuratedVideoPayload | null>(null);
  const [savedTemplateVideos, setSavedTemplateVideos] = useState<CuratedVideo[]>([]);
  const [sessionDemoVideo, setSessionDemoVideo] = useState<CuratedVideo | null>(null);
  const [keyIssuesOnly, setKeyIssuesOnly] = useState(true);
  const [abWindowBeats, setAbWindowBeats] = useState(1);
  const [abLoopRepeats, setAbLoopRepeats] = useState(3);
  const [compareOffsetMs, setCompareOffsetMs] = useState(0);
  const [practiceMusicRateInput, setPracticeMusicRateInput] = useState("1.00");
  const [manualLinkedScrub, setManualLinkedScrub] = useState(false);
  const [useOverlapAnchor, setUseOverlapAnchor] = useState(false);
  const [overlapRefStartMs, setOverlapRefStartMs] = useState(0);
  const [overlapPracticeStartMs, setOverlapPracticeStartMs] = useState(0);
  const [abLoop, setAbLoop] = useState<{ active: boolean; startMs: number; endMs: number; repeatsLeft: number }>({
    active: false,
    startMs: 0,
    endMs: 0,
    repeatsLeft: 0,
  });
  const [referencePositionSec, setReferencePositionSec] = useState(0);
  const [referenceDurationSec, setReferenceDurationSec] = useState(0);
  const [referencePlaying, setReferencePlaying] = useState(false);
  const [referenceVolume, setReferenceVolume] = useState(1);
  const [showReferenceVolume, setShowReferenceVolume] = useState(false);
  const [referenceScrubbing, setReferenceScrubbing] = useState(false);
  const [referencePreviewUri, setReferencePreviewUri] = useState<string | null>(null);
  const [practicePositionSec, setPracticePositionSec] = useState(0);
  const [practiceDurationSec, setPracticeDurationSec] = useState(0);
  const [practicePlaying, setPracticePlaying] = useState(false);
  const [practiceVolume, setPracticeVolume] = useState(1);
  const [showPracticeVolume, setShowPracticeVolume] = useState(false);
  const [practiceScrubbing, setPracticeScrubbing] = useState(false);
  const [practicePreviewUri, setPracticePreviewUri] = useState<string | null>(null);
  const [referenceCrop, setReferenceCrop] = useState<CropRoi>(DEFAULT_CROP_ROI);
  const [practiceCrop, setPracticeCrop] = useState<CropRoi>(DEFAULT_CROP_ROI);
  const [referenceCropDraft, setReferenceCropDraft] = useState<CropRoi>(DEFAULT_CROP_ROI);
  const [practiceCropDraft, setPracticeCropDraft] = useState<CropRoi>(DEFAULT_CROP_ROI);
  const [editingCropTarget, setEditingCropTarget] = useState<"reference" | "practice" | null>(null);
  const [referenceViewport, setReferenceViewport] = useState<{ width: number; height: number }>({ width: 0, height: 0 });
  const [practiceViewport, setPracticeViewport] = useState<{ width: number; height: number }>({ width: 0, height: 0 });
  const [referencePeople, setReferencePeople] = useState<PersonCandidate[]>([]);
  const [practicePeople, setPracticePeople] = useState<PersonCandidate[]>([]);
  const [selectedReferencePersonId, setSelectedReferencePersonId] = useState<string | null>(null);
  const [selectedPracticePersonId, setSelectedPracticePersonId] = useState<string | null>(null);
  const [personPickerVisible, setPersonPickerVisible] = useState(false);
  const [personPickerRole, setPersonPickerRole] = useState<PickerRole>("reference");
  const [personPickerCandidates, setPersonPickerCandidates] = useState<PersonCandidate[]>([]);
  const [personPickerSelectedId, setPersonPickerSelectedId] = useState<string | null>(null);
  const [uploadSourcePickerVisible, setUploadSourcePickerVisible] = useState(false);
  const [uploadSourcePickerTarget, setUploadSourcePickerTarget] = useState<UploadPickerTarget>("reference");
  const referenceCropStartRef = useRef<CropRoi>(DEFAULT_CROP_ROI);
  const practiceCropStartRef = useRef<CropRoi>(DEFAULT_CROP_ROI);
  const referenceCropDraftRef = useRef<CropRoi>(DEFAULT_CROP_ROI);
  const practiceCropDraftRef = useRef<CropRoi>(DEFAULT_CROP_ROI);
  const referencePinchStartDistanceRef = useRef(0);
  const practicePinchStartDistanceRef = useRef(0);
  const referencePreviewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const practicePreviewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const personPickerResolverRef = useRef<((value: string | null) => void) | null>(null);

  const referencePlayer = useVideoPlayer(videoUri ? { uri: videoUri } : null, (player) => {
    player.timeUpdateEventInterval = 0.03;
    player.loop = false;
  });

  const practicePlayer = useVideoPlayer(practiceVideoUri ? { uri: practiceVideoUri } : null, (player) => {
    player.timeUpdateEventInterval = 0.03;
    player.loop = false;
  });

  useEffect(() => {
    if (!videoUri) {
      setReferencePositionSec(0);
      setReferenceDurationSec(0);
      setReferencePlaying(false);
      setReferenceScrubbing(false);
      setReferencePreviewUri(null);
      setShowReferenceVolume(false);
      return;
    }
    referencePlayer.pause();
    referencePlayer.currentTime = 0;
    setReferencePlaying(false);
    setReferenceScrubbing(false);
    setReferencePreviewUri(null);
  }, [videoUri, referencePlayer]);

  useEffect(() => {
    if (!practiceVideoUri) {
      setPracticePositionSec(0);
      setPracticeDurationSec(0);
      setPracticePlaying(false);
      setPracticeScrubbing(false);
      setPracticePreviewUri(null);
      setShowPracticeVolume(false);
      return;
    }
    practicePlayer.pause();
    practicePlayer.currentTime = 0;
    setPracticePlaying(false);
    setPracticeScrubbing(false);
    setPracticePreviewUri(null);
  }, [practiceVideoUri, practicePlayer]);

  useEffect(() => {
    const timer = setInterval(() => {
      setReferencePositionSec(referencePlayer.currentTime || 0);
      setReferenceDurationSec(referencePlayer.duration || 0);
      setReferencePlaying(!!referencePlayer.playing);
      setPracticePositionSec(practicePlayer.currentTime || 0);
      setPracticeDurationSec(practicePlayer.duration || 0);
      setPracticePlaying(!!practicePlayer.playing);
    }, 120);

    return () => clearInterval(timer);
  }, [referencePlayer, practicePlayer]);

  const segments = useMemo(() => {
    if (beatData?.groups?.length) return beatData.groups;
    return [];
  }, [beatData]);

  const beatBpm = beatData?.bpm && beatData.bpm > 1 ? beatData.bpm : 100;
  const currentDrill = trainingPlan[trainingDrillIndex] || null;
  const practiceMusicRate = useMemo(() => parseMusicRate(practiceMusicRateInput), [practiceMusicRateInput]);
  const liveCaptureReady = (capturedLiveFrames?.length || 0) >= 6;
  const canGenerateFeedback =
    !!videoUri &&
    ((followInputMode === "upload" && !!practiceVideoUri) ||
      (followInputMode === "camera" && captureMode === "mock") ||
      (followInputMode === "camera" && captureMode === "live" && liveCaptureReady));

  const getReferenceFromPracticeMs = (practiceMs: number): number => {
    if (useOverlapAnchor) {
      const deltaPractice = practiceMs - overlapPracticeStartMs;
      return Math.max(0, Math.round(overlapRefStartMs + deltaPractice * Math.max(0.25, practiceMusicRate)));
    }
    return Math.max(0, Math.round((practiceMs - compareOffsetMs) * practiceMusicRate));
  };

  const getPracticeAlignedMs = (referenceMs: number): number => {
    if (useOverlapAnchor) {
      const deltaRef = referenceMs - overlapRefStartMs;
      return Math.max(0, Math.round(overlapPracticeStartMs + deltaRef / Math.max(0.25, practiceMusicRate)));
    }
    const dynamicOffset = computeDynamicOffsetMsAtReferenceTime(beatData, practiceBeatData, referenceMs / 1000) ?? 0;
    const scaledReferenceMs = referenceMs / Math.max(0.25, practiceMusicRate);
    return Math.max(0, Math.round(scaledReferenceMs + compareOffsetMs + dynamicOffset));
  };
  const visibleIssues = useMemo(() => {
    if (!movementResult?.issues?.length) return [];
    const list = keyIssuesOnly
      ? movementResult.issues.filter((issue) => issue.severity === "high" || issue.severity === "medium")
      : movementResult.issues;
    return list.slice(0, keyIssuesOnly ? 4 : 6);
  }, [movementResult, keyIssuesOnly]);
  const recommendedAb = useMemo(() => recommendAbSettings(movementResult), [movementResult]);

  const currentEightIndex = useMemo(() => Math.floor(currentBeatIndex / 8), [currentBeatIndex]);

  const currentEightCoachNotes = useMemo(() => {
    if (!movementResult) return [] as string[];

    const beatStart = currentEightIndex * 8 + 1;
    const beatEnd = beatStart + 7;

    const timing = movementResult.timingAnalysis?.markers || [];
    const segmentTiming = timing.filter((m) => m.beatIndex >= beatStart && m.beatIndex <= beatEnd);
    const late = segmentTiming.filter((m) => m.status === "late").length;
    const early = segmentTiming.filter((m) => m.status === "early").length;

    const phaseBeats = movementResult.phaseAnalysis?.beats || [];
    const unstableHits = phaseBeats
      .filter((b) => b.beatIndex >= beatStart && b.beatIndex <= beatEnd)
      .filter((b) => b.phases.hit.status !== "on_time" && b.phases.hit.status !== "stable").length;

    const notes: string[] = [];
    if (late || early) {
      notes.push(
        coachLanguage === "en"
          ? `This 8-count timing: ${late} late, ${early} early. Lock down count 1 and count 5 accents.`
          : `当前八拍节奏：慢拍 ${late} 个，快拍 ${early} 个。先卡稳第1拍和第5拍重音。`,
      );
    }

    if (unstableHits) {
      notes.push(
        coachLanguage === "en"
          ? `Hit phase unstable on ${unstableHits} beats. Keep prep shorter and freeze impact for one frame.`
          : `命中相位有 ${unstableHits} 拍不稳。缩短预备动作，击中点至少定住一帧。`,
      );
    }

    const issueTips = visibleIssues.slice(0, 2).map((issue) =>
      coachLanguage === "en"
        ? `${issue.area}: ${issue.fix}`
        : `${issue.area}：${issue.fix}`,
    );

    return [...notes, ...issueTips].slice(0, 4);
  }, [movementResult, currentEightIndex, coachLanguage, visibleIssues]);

  const referenceVideoFrameStyle = useMemo(() => {
    if (referenceViewport.width <= 0 || referenceViewport.height <= 0) return styles.video;
    const w = referenceViewport.width / Math.max(0.12, referenceCrop.w);
    const h = referenceViewport.height / Math.max(0.12, referenceCrop.h);
    return {
      position: "absolute" as const,
      width: w,
      height: h,
      left: -referenceCrop.x * w,
      top: -referenceCrop.y * h,
    };
  }, [referenceViewport, referenceCrop]);

  const practiceVideoFrameStyle = useMemo(() => {
    if (practiceViewport.width <= 0 || practiceViewport.height <= 0) return styles.video;
    const w = practiceViewport.width / Math.max(0.12, practiceCrop.w);
    const h = practiceViewport.height / Math.max(0.12, practiceCrop.h);
    return {
      position: "absolute" as const,
      width: w,
      height: h,
      left: -practiceCrop.x * w,
      top: -practiceCrop.y * h,
    };
  }, [practiceViewport, practiceCrop]);

  useEffect(() => {
    referenceCropDraftRef.current = referenceCropDraft;
  }, [referenceCropDraft]);

  useEffect(() => {
    practiceCropDraftRef.current = practiceCropDraft;
  }, [practiceCropDraft]);

  const referenceCropRectStyle = useMemo(
    () => ({
      left: referenceCropDraft.x * referenceViewport.width,
      top: referenceCropDraft.y * referenceViewport.height,
      width: referenceCropDraft.w * referenceViewport.width,
      height: referenceCropDraft.h * referenceViewport.height,
    }),
    [referenceCropDraft, referenceViewport],
  );

  const practiceCropRectStyle = useMemo(
    () => ({
      left: practiceCropDraft.x * practiceViewport.width,
      top: practiceCropDraft.y * practiceViewport.height,
      width: practiceCropDraft.w * practiceViewport.width,
      height: practiceCropDraft.h * practiceViewport.height,
    }),
    [practiceCropDraft, practiceViewport],
  );

  const detectPeopleCandidatesFromVideo = async (target: "reference" | "practice", uri: string): Promise<PersonCandidate[]> => {
    const durationSec = target === "reference" ? referenceDurationSec : practiceDurationSec;
    const sampleTimes = buildPeopleSampleTimes(durationSec);
    const cached = target === "reference" ? referencePeople : practicePeople;
    let best: PersonCandidate[] = [];

    for (const time of sampleTimes) {
      try {
        const thumb = await VideoThumbnails.getThumbnailAsync(uri, { time });
        const people = await detectPeopleBoxesFromImage(thumb.uri);
        const candidates = people.map((p, idx) => ({ id: `${target}-${time}-${idx}`, box: p, score: p.score }));
        if (candidates.length > best.length) best = candidates;
      } catch {
        continue;
      }
    }

    if (target === "reference") {
      if (!best.length && cached.length) {
        setLiveHint(
          coachLanguage === "en"
            ? `Reference detection fallback: keep previous ${cached.length} candidates`
            : `参考视频本次检测失败，保留上次 ${cached.length} 个候选`,
        );
        return cached;
      }

      setReferencePeople(best);
      if (best.length) {
        setSelectedReferencePersonId(best[0].id);
        const next = roiFromCandidate(best[0].box);
        setReferenceCrop(next);
        setReferenceCropDraft(next);
      }
      setLiveHint(
        coachLanguage === "en"
          ? best.length > 0
            ? `Reference people detected: ${best.length}`
            : "Reference detection unstable. Tap Re-detect People."
          : best.length > 0
            ? `参考视频检测到 ${best.length} 人`
            : "参考视频检测不稳定，请点“重新检测人物”",
      );
    } else {
      if (!best.length && cached.length) {
        setLiveHint(
          coachLanguage === "en"
            ? `Practice detection fallback: keep previous ${cached.length} candidates`
            : `跟练视频本次检测失败，保留上次 ${cached.length} 个候选`,
        );
        return cached;
      }

      setPracticePeople(best);
      if (best.length) {
        setSelectedPracticePersonId(best[0].id);
        const next = roiFromCandidate(best[0].box);
        setPracticeCrop(next);
        setPracticeCropDraft(next);
      }
      setLiveHint(
        coachLanguage === "en"
          ? best.length > 0
            ? `Practice people detected: ${best.length}`
            : "Practice detection unstable. Tap Re-detect People."
          : best.length > 0
            ? `跟练视频检测到 ${best.length} 人`
            : "跟练视频检测不稳定，请点“重新检测人物”",
      );
    }
    return best;
  };

  const selectPersonCandidate = (target: "reference" | "practice", candidate: PersonCandidate) => {
    if (target === "reference") {
      setSelectedReferencePersonId(candidate.id);
      const next = roiFromCandidate(candidate.box);
      if (editingCropTarget === "reference") setReferenceCropDraft(next);
      else {
        setReferenceCrop(next);
        setReferenceCropDraft(next);
      }
    } else {
      setSelectedPracticePersonId(candidate.id);
      const next = roiFromCandidate(candidate.box);
      if (editingCropTarget === "practice") setPracticeCropDraft(next);
      else {
        setPracticeCrop(next);
        setPracticeCropDraft(next);
      }
    }
  };

  const referenceCropPanResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onStartShouldSetPanResponderCapture: (evt) => (evt.nativeEvent.touches?.length || 0) >= 2,
        onMoveShouldSetPanResponderCapture: (evt) => (evt.nativeEvent.touches?.length || 0) >= 2,
        onMoveShouldSetPanResponder: (_evt, gesture) => Math.abs(gesture.dx) > 2 || Math.abs(gesture.dy) > 2,
        onPanResponderGrant: (evt) => {
          referenceCropStartRef.current = referenceCropDraftRef.current;
          const pinch = extractPinchInfo(evt);
          referencePinchStartDistanceRef.current = pinch?.distance || 0;
        },
        onPanResponderMove: (evt, gesture) => {
          if (!referenceViewport.width || !referenceViewport.height) return;
          const start = referenceCropStartRef.current;
          const pinch = extractPinchInfo(evt);
          if (pinch && referencePinchStartDistanceRef.current > 0) {
            const next = scaleRoiByPinch(
              start,
              pinch.distance / referencePinchStartDistanceRef.current,
              pinch.centerX / referenceViewport.width,
              pinch.centerY / referenceViewport.height,
            );
            setReferenceCropDraft(next);
            return;
          }

          const next = moveRoiByCanvasDrag(
            start,
            gesture.dx / referenceViewport.width,
            gesture.dy / referenceViewport.height,
          );
          setReferenceCropDraft(next);
        },
      }),
    [referenceViewport],
  );

  const practiceCropPanResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onStartShouldSetPanResponderCapture: (evt) => (evt.nativeEvent.touches?.length || 0) >= 2,
        onMoveShouldSetPanResponderCapture: (evt) => (evt.nativeEvent.touches?.length || 0) >= 2,
        onMoveShouldSetPanResponder: (_evt, gesture) => Math.abs(gesture.dx) > 2 || Math.abs(gesture.dy) > 2,
        onPanResponderGrant: (evt) => {
          practiceCropStartRef.current = practiceCropDraftRef.current;
          const pinch = extractPinchInfo(evt);
          practicePinchStartDistanceRef.current = pinch?.distance || 0;
        },
        onPanResponderMove: (evt, gesture) => {
          if (!practiceViewport.width || !practiceViewport.height) return;
          const start = practiceCropStartRef.current;
          const pinch = extractPinchInfo(evt);
          if (pinch && practicePinchStartDistanceRef.current > 0) {
            const next = scaleRoiByPinch(
              start,
              pinch.distance / practicePinchStartDistanceRef.current,
              pinch.centerX / practiceViewport.width,
              pinch.centerY / practiceViewport.height,
            );
            setPracticeCropDraft(next);
            return;
          }

          const next = moveRoiByCanvasDrag(
            start,
            gesture.dx / practiceViewport.width,
            gesture.dy / practiceViewport.height,
          );
          setPracticeCropDraft(next);
        },
      }),
    [practiceViewport],
  );

  const referenceTopEdgePanResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_evt, gesture) => Math.abs(gesture.dy) > 1,
        onPanResponderGrant: () => {
          referenceCropStartRef.current = referenceCropDraftRef.current;
        },
        onPanResponderMove: (_evt, gesture) => {
          if (!referenceViewport.height) return;
          setReferenceCropDraft(resizeRoiByEdge(referenceCropStartRef.current, "top", 0, gesture.dy / referenceViewport.height));
        },
      }),
    [referenceViewport],
  );

  const referenceBottomEdgePanResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_evt, gesture) => Math.abs(gesture.dy) > 1,
        onPanResponderGrant: () => {
          referenceCropStartRef.current = referenceCropDraftRef.current;
        },
        onPanResponderMove: (_evt, gesture) => {
          if (!referenceViewport.height) return;
          setReferenceCropDraft(resizeRoiByEdge(referenceCropStartRef.current, "bottom", 0, gesture.dy / referenceViewport.height));
        },
      }),
    [referenceViewport],
  );

  const referenceLeftEdgePanResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_evt, gesture) => Math.abs(gesture.dx) > 1,
        onPanResponderGrant: () => {
          referenceCropStartRef.current = referenceCropDraftRef.current;
        },
        onPanResponderMove: (_evt, gesture) => {
          if (!referenceViewport.width) return;
          setReferenceCropDraft(resizeRoiByEdge(referenceCropStartRef.current, "left", gesture.dx / referenceViewport.width, 0));
        },
      }),
    [referenceViewport],
  );

  const referenceRightEdgePanResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_evt, gesture) => Math.abs(gesture.dx) > 1,
        onPanResponderGrant: () => {
          referenceCropStartRef.current = referenceCropDraftRef.current;
        },
        onPanResponderMove: (_evt, gesture) => {
          if (!referenceViewport.width) return;
          setReferenceCropDraft(resizeRoiByEdge(referenceCropStartRef.current, "right", gesture.dx / referenceViewport.width, 0));
        },
      }),
    [referenceViewport],
  );

  const practiceTopEdgePanResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_evt, gesture) => Math.abs(gesture.dy) > 1,
        onPanResponderGrant: () => {
          practiceCropStartRef.current = practiceCropDraftRef.current;
        },
        onPanResponderMove: (_evt, gesture) => {
          if (!practiceViewport.height) return;
          setPracticeCropDraft(resizeRoiByEdge(practiceCropStartRef.current, "top", 0, gesture.dy / practiceViewport.height));
        },
      }),
    [practiceViewport],
  );

  const practiceBottomEdgePanResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_evt, gesture) => Math.abs(gesture.dy) > 1,
        onPanResponderGrant: () => {
          practiceCropStartRef.current = practiceCropDraftRef.current;
        },
        onPanResponderMove: (_evt, gesture) => {
          if (!practiceViewport.height) return;
          setPracticeCropDraft(resizeRoiByEdge(practiceCropStartRef.current, "bottom", 0, gesture.dy / practiceViewport.height));
        },
      }),
    [practiceViewport],
  );

  const practiceLeftEdgePanResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_evt, gesture) => Math.abs(gesture.dx) > 1,
        onPanResponderGrant: () => {
          practiceCropStartRef.current = practiceCropDraftRef.current;
        },
        onPanResponderMove: (_evt, gesture) => {
          if (!practiceViewport.width) return;
          setPracticeCropDraft(resizeRoiByEdge(practiceCropStartRef.current, "left", gesture.dx / practiceViewport.width, 0));
        },
      }),
    [practiceViewport],
  );

  const practiceRightEdgePanResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_evt, gesture) => Math.abs(gesture.dx) > 1,
        onPanResponderGrant: () => {
          practiceCropStartRef.current = practiceCropDraftRef.current;
        },
        onPanResponderMove: (_evt, gesture) => {
          if (!practiceViewport.width) return;
          setPracticeCropDraft(resizeRoiByEdge(practiceCropStartRef.current, "right", gesture.dx / practiceViewport.width, 0));
        },
      }),
    [practiceViewport],
  );

  useEffect(() => {
    let mounted = true;
    fetch(`${API_BASE_URL}/course-templates?style=${style}&language=${coachLanguage}`)
      .then((res) => res.json())
      .then((payload: CourseTemplate) => {
        if (mounted) setCourseTemplate(payload);
      })
      .catch(() => {
        if (mounted) setCourseTemplate(null);
      });

    fetch(`${API_BASE_URL}/curated-videos?style=${style}&language=${coachLanguage}&limit=8`)
      .then((res) => res.json())
      .then((payload: CuratedVideoPayload) => {
        if (mounted) setCuratedVideos(payload);
      })
      .catch(() => {
        if (mounted) setCuratedVideos(null);
      });

    return () => {
      mounted = false;
    };
  }, [style, coachLanguage]);

  useEffect(() => {
    if (!trainingActive || trainingPhase === "done") return;
    if (phaseSecondsLeft <= 0) return;

    const timer = setInterval(() => {
      setPhaseSecondsLeft((prev) => Math.max(0, prev - 1));
    }, 1000);

    return () => clearInterval(timer);
  }, [trainingActive, trainingPhase, phaseSecondsLeft]);

  useEffect(() => {
    if (!trainingActive || !currentDrill) return;
    const refStartSec = currentDrill.startMs / 1000;
    referencePlayer.currentTime = refStartSec;
    referencePlayer.play();

    if (practiceVideoUri) {
      const practiceStartSec = getPracticeAlignedMs(currentDrill.startMs) / 1000;
      practicePlayer.currentTime = practiceStartSec;
      practicePlayer.play();
    }
  }, [trainingActive, currentDrill, practiceVideoUri, compareOffsetMs, practiceMusicRate, beatData, practiceBeatData, referencePlayer, practicePlayer]);

  useEffect(() => {
    referencePlayer.playbackRate = speed;
    practicePlayer.playbackRate = speed;
  }, [speed, referencePlayer, practicePlayer]);

  useEffect(() => {
    referencePlayer.volume = referenceVolume;
  }, [referencePlayer, referenceVolume]);

  useEffect(() => {
    practicePlayer.volume = practiceVolume;
  }, [practicePlayer, practiceVolume]);

  useEffect(() => {
    referencePlayer.loop = !trainingActive;
    practicePlayer.loop = !trainingActive;
  }, [trainingActive, referencePlayer, practicePlayer]);

  useEffect(() => {
    if (!trainingActive || !currentDrill) return;
    if (phaseSecondsLeft > 0) return;

    if (trainingPhase === "work") {
      if (currentDrill.restSec > 0) {
        setTrainingPhase("rest");
        setPhaseSecondsLeft(currentDrill.restSec);
        return;
      }
    }

    if (trainingPhase === "rest" || (trainingPhase === "work" && currentDrill.restSec <= 0)) {
      if (trainingSetIndex < currentDrill.sets) {
        setTrainingSetIndex((prev) => prev + 1);
        setTrainingPhase("work");
        setPhaseSecondsLeft(currentDrill.workSec);
        return;
      }

      if (trainingDrillIndex < trainingPlan.length - 1) {
        const nextIndex = trainingDrillIndex + 1;
        setTrainingDrillIndex(nextIndex);
        setTrainingSetIndex(1);
        setTrainingPhase("work");
        setPhaseSecondsLeft(trainingPlan[nextIndex].workSec);
        return;
      }

      setTrainingPhase("done");
      setTrainingActive(false);
      setLiveHint(coachLanguage === "en" ? "Training session complete" : "训练课次完成");
    }
  }, [
    trainingActive,
    trainingPhase,
    phaseSecondsLeft,
    trainingSetIndex,
    trainingDrillIndex,
    trainingPlan,
    currentDrill,
    coachLanguage,
  ]);

  useEffect(() => {
    if (!referencePlaying || !beatData?.beats?.length) {
      setCurrentBeatIndex(0);
      return;
    }

    const timer = setInterval(() => {
      const t = referencePlayer.currentTime || 0;
      const beats = beatData.beats;
      let idx = 0;
      for (let i = 0; i < beats.length; i += 1) {
        if (beats[i] <= t) idx = i;
        else break;
      }
      setCurrentBeatIndex(idx);
    }, 120);

    return () => clearInterval(timer);
  }, [referencePlaying, beatData, referencePlayer]);

  const eightCount = useMemo(() => (currentBeatIndex % 8) + 1, [currentBeatIndex]);

  useEffect(() => {
    const timer = setInterval(() => {
      const positionMs = Math.round(referencePlayer.currentTime * 1000);

      if (
        practiceVideoUri &&
        followInputMode === "upload" &&
        !editingCropTarget &&
        referencePlayer.playing &&
        practicePlayer.playing &&
        !referenceScrubbing &&
        !practiceScrubbing
      ) {
        const expectedPracticeMs = getPracticeAlignedMs(positionMs);
        const actualPracticeMs = Math.round((practicePlayer.currentTime || 0) * 1000);
        const driftMs = actualPracticeMs - expectedPracticeMs;
        if (Math.abs(driftMs) > 12) {
          practicePlayer.currentTime = expectedPracticeMs / 1000;
        }
      }

      if (abLoop.active && positionMs >= abLoop.endMs) {
        if (abLoop.repeatsLeft > 1) {
          setAbLoop((prev) => ({ ...prev, repeatsLeft: prev.repeatsLeft - 1 }));
          referencePlayer.currentTime = abLoop.startMs / 1000;
          referencePlayer.play();
          if (practiceVideoUri) {
            const practiceStartSec = getPracticeAlignedMs(abLoop.startMs) / 1000;
            practicePlayer.currentTime = practiceStartSec;
            practicePlayer.play();
          }
        } else {
          setAbLoop({ active: false, startMs: 0, endMs: 0, repeatsLeft: 0 });
          setLiveHint(coachLanguage === "en" ? "AB loop complete" : "AB循环完成");
        }
        return;
      }

      if (trainingActive && currentDrill && positionMs >= currentDrill.endMs) {
        referencePlayer.currentTime = currentDrill.startMs / 1000;
        referencePlayer.play();
        if (practiceVideoUri) {
          const practiceStartSec = getPracticeAlignedMs(currentDrill.startMs) / 1000;
          practicePlayer.currentTime = practiceStartSec;
          practicePlayer.play();
        }
      }
    }, 40);

    return () => clearInterval(timer);
  }, [
    abLoop,
    coachLanguage,
    trainingActive,
    currentDrill,
    referencePlayer,
    practicePlayer,
    practiceVideoUri,
    followInputMode,
    editingCropTarget,
    referenceScrubbing,
    practiceScrubbing,
    compareOffsetMs,
    practiceMusicRate,
    beatData,
    practiceBeatData,
  ]);

  const pickVideoFromFiles = async (): Promise<{ uri: string; name: string; mimeType?: string | null } | null> => {
    const result = await DocumentPicker.getDocumentAsync({
      type: "video/*",
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (result.canceled || !result.assets?.length) return null;
    const file = result.assets[0];
    return {
      uri: file.uri,
      name: file.name ?? `video-${Date.now()}.mov`,
      mimeType: file.mimeType,
    };
  };

  const validatePickedVideoAccess = async (uri: string): Promise<boolean> => {
    if (!uri.startsWith("file://")) return true;
    try {
      const info = await FileSystemLegacy.getInfoAsync(uri);
      return !!info.exists;
    } catch {
      return false;
    }
  };

  const pickVideoFromLibrary = async (): Promise<{ uri: string; name: string; mimeType?: string | null } | null> => {
    try {
      setLastPickerError(null);
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert("Permission needed", coachLanguage === "en" ? "Please allow Photos access." : "请先允许访问相册。");
        return null;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["videos"],
        allowsEditing: false,
        quality: 1,
        shouldDownloadFromNetwork: true,
        preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Current,
        videoExportPreset: ImagePicker.VideoExportPreset.Passthrough,
      });

      if (result.canceled || !result.assets?.length) return null;
      const file = result.assets[0];
      const mime = file.mimeType || "";
      const isVideo =
        file.type === "video" ||
        mime.startsWith("video/") ||
        /\.(mp4|mov|m4v|avi|mkv|webm)$/i.test(file.fileName || file.uri || "");
      if (!isVideo) {
        Alert.alert(
          coachLanguage === "en" ? "Video only" : "仅支持视频",
          coachLanguage === "en" ? "Please choose a video file from Photos." : "请在相册中选择视频文件。",
        );
        return null;
      }

      let localUri = file.uri;
      if (!localUri.startsWith("file://")) {
        const ext = getVideoFileExtension(file.fileName || file.uri);
        const destination = `${FileSystemLegacy.cacheDirectory}picked-video-${Date.now()}.${ext}`;
        try {
          await FileSystemLegacy.copyAsync({ from: localUri, to: destination });
          localUri = destination;
        } catch {
          const fallback = await pickVideoFromFiles().catch(() => null);
          if (fallback) {
            Alert.alert(
              coachLanguage === "en" ? "Using Files source" : "已切换文件来源",
              coachLanguage === "en"
                ? "This iOS album video format is not directly uploadable. Switched to Files picker."
                : "该相册视频格式暂不支持直接上传，已切换到文件选择。",
            );
            return fallback;
          }
          throw new Error(`Unsupported media URI: ${file.uri}`);
        }
      }

      return {
        uri: localUri,
        name: file.fileName ?? `video-${Date.now()}.mov`,
        mimeType: file.mimeType,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      setLastPickerError(message);
      Alert.alert(
        coachLanguage === "en" ? "Photos unavailable" : "相册不可用",
        coachLanguage === "en"
          ? `Unable to open Photos (${message}). Try the Files button or download the video locally first.`
          : `无法打开相册（${message}）。请尝试“文件”按钮，或先把视频下载到本地。`,
      );
      return null;
    }
  };

  const analyzeBeat = async (uri: string, name?: string, mimeType?: string | null): Promise<BeatAnalysis> => {
    const body = new FormData();
    body.append("file", {
      uri,
      name: name ?? "dance-upload.mp4",
      type: buildFileType(mimeType, name),
    } as never);

    const response = await fetch(`${API_BASE_URL}/beat-analysis`, {
      method: "POST",
      body,
    });

    if (!response.ok) throw new Error(`beat-analysis failed with status ${response.status}`);
    return response.json();
  };

  const alignMusicByWaveform = async (
    reference: { uri: string; name?: string },
    practice: { uri: string; name?: string },
  ): Promise<MusicAlignPayload> => {
    const body = new FormData();
    body.append("reference", {
      uri: reference.uri,
      name: reference.name ?? "reference.mp4",
      type: buildFileType(null, reference.name),
    } as never);
    body.append("practice", {
      uri: practice.uri,
      name: practice.name ?? "practice.mp4",
      type: buildFileType(null, practice.name),
    } as never);

    const response = await fetch(`${API_BASE_URL}/music-align`, {
      method: "POST",
      body,
    });

    if (!response.ok) throw new Error(`music-align failed with status ${response.status}`);
    return response.json();
  };

  const loadReferenceVideo = async (file: { uri: string; name: string; mimeType?: string | null }) => {
    const canAccess = await validatePickedVideoAccess(file.uri);
    if (!canAccess) {
      const message =
        coachLanguage === "en"
          ? "Selected video content is unavailable. Open the video in Photos/Files first so iOS downloads it locally."
          : "所选视频内容当前不可用。请先在相册/文件中打开该视频，确保 iOS 已下载到本地。";
      setLastPickerError("content unavailable");
      Alert.alert(coachLanguage === "en" ? "Video unavailable" : "视频不可用", message);
      return;
    }

    const pickedName = file.name ?? "Uploaded file";
    setVideoName(pickedName);
    setReferenceInputMode("upload");
    setManualLinkedScrub(false);
    setFeedbackVisible(false);
    const ok = await requestBeatAnalysis(file.uri, pickedName, file.mimeType);
    if (ok) {
      setVideoUri(file.uri);
      setReferenceCrop(DEFAULT_CROP_ROI);
      setReferenceCropDraft(DEFAULT_CROP_ROI);
      setReferencePeople([]);
      setSelectedReferencePersonId(null);
      void detectPeopleCandidatesFromVideo("reference", file.uri);
    }
  };

  const pickDanceVideo = async () => {
    const file = await pickVideoFromLibrary();
    if (!file) return;
    await loadReferenceVideo(file);
  };

  const pickDanceVideoFromFiles = async () => {
    try {
      const file = await pickVideoFromFiles();
      if (!file) return;
      await loadReferenceVideo(file);
    } catch (error) {
      Alert.alert("Upload failed", error instanceof Error ? error.message : "Unknown error");
    }
  };

  const loadPracticeVideo = async (file: { uri: string; name: string; mimeType?: string | null }) => {
    const canAccess = await validatePickedVideoAccess(file.uri);
    if (!canAccess) {
      const message =
        coachLanguage === "en"
          ? "Selected video content is unavailable. Open the video in Photos/Files first so iOS downloads it locally."
          : "所选视频内容当前不可用。请先在相册/文件中打开该视频，确保 iOS 已下载到本地。";
      setLastPickerError("content unavailable");
      Alert.alert(coachLanguage === "en" ? "Video unavailable" : "视频不可用", message);
      return;
    }

    const pickedName = file.name ?? "Practice upload";
    setPracticeVideoUri(file.uri);
    setPracticeVideoName(pickedName);
    setFollowInputMode("upload");
    setCaptureMode("mock");
    setManualLinkedScrub(false);
    setFeedbackVisible(false);
    setCapturedLiveFrames(null);
    setPracticeCrop(DEFAULT_CROP_ROI);
    setPracticeCropDraft(DEFAULT_CROP_ROI);
    setPracticePeople([]);
    setSelectedPracticePersonId(null);
    void detectPeopleCandidatesFromVideo("practice", file.uri);
    try {
      const payload = await analyzeBeat(file.uri, pickedName, file.mimeType);
      setPracticeBeatData(payload);
      const overlap = computeOverlapAlignmentByBeats(beatData, payload);
      if (overlap) {
        const fine = computeFineOffsetMs(beatData, payload, overlap.offsetMs);
        const finalOffset = fine ?? overlap.offsetMs;
        setCompareOffsetMs(finalOffset);
        setUseOverlapAnchor(true);
        setOverlapRefStartMs(overlap.overlapRefStartMs);
        setOverlapPracticeStartMs(overlap.overlapPracticeStartMs);
        referencePlayer.currentTime = overlap.overlapRefStartMs / 1000;
        practicePlayer.currentTime = overlap.overlapPracticeStartMs / 1000;
        setReferencePositionSec(referencePlayer.currentTime || overlap.overlapRefStartMs / 1000);
        setPracticePositionSec(practicePlayer.currentTime || overlap.overlapPracticeStartMs / 1000);
      } else {
        const beatOffsetMs = computeRobustBeatOffsetMs(beatData, payload);
        if (beatOffsetMs !== null) {
          setCompareOffsetMs(Math.max(-20000, Math.min(20000, beatOffsetMs)));
          setUseOverlapAnchor(false);
        }
      }
    } catch {
      setPracticeBeatData(null);
    }
    setLiveHint(coachLanguage === "en" ? "Practice video loaded (for comparison display)." : "练习视频已载入（用于对比展示）。");
  };

  const pickPracticeVideo = async () => {
    const file = await pickVideoFromLibrary();
    if (!file) return;
    await loadPracticeVideo(file);
  };

  const pickPracticeVideoFromFiles = async () => {
    try {
      const file = await pickVideoFromFiles();
      if (!file) return;
      await loadPracticeVideo(file);
    } catch (error) {
      Alert.alert("Upload failed", error instanceof Error ? error.message : "Unknown error");
    }
  };

  const openUploadSourcePicker = (target: UploadPickerTarget) => {
    setUploadSourcePickerTarget(target);
    setUploadSourcePickerVisible(true);
  };

  const closeUploadSourcePicker = () => {
    setUploadSourcePickerVisible(false);
  };

  const chooseUploadFromAlbum = async () => {
    closeUploadSourcePicker();
    if (uploadSourcePickerTarget === "reference") await pickDanceVideo();
    else await pickPracticeVideo();
  };

  const chooseUploadFromFiles = async () => {
    closeUploadSourcePicker();
    if (uploadSourcePickerTarget === "reference") await pickDanceVideoFromFiles();
    else await pickPracticeVideoFromFiles();
  };

  const requestBeatAnalysis = async (uri: string, name?: string, mimeType?: string | null): Promise<boolean> => {
    setIsLoadingBeat(true);
    setBeatData(null);
    setMovementResult(null);
    setRealtimeInsights(null);
    setTrainingPlan([]);
    setTrainingActive(false);
    setTrainingPhase("done");
    setPhaseSecondsLeft(0);
    setCurrentBeatIndex(0);
    setSelectedSegment(0);

    try {
      const payload = await analyzeBeat(uri, name, mimeType);
      setBeatData(payload);
      setPracticeBeatData(null);
      setCompareOffsetMs(0);
      setUseOverlapAnchor(false);
      setOverlapRefStartMs(0);
      setOverlapPracticeStartMs(0);
      return true;
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : "Unknown error";
      const message =
        rawMessage === "Network request failed"
          ? `Cannot reach API at ${API_BASE_URL}. Start the backend on your Mac and keep iPad on the same Wi-Fi.`
          : rawMessage;
      Alert.alert("Beat analysis failed", message);
      return false;
    } finally {
      setIsLoadingBeat(false);
    }
  };

  const captureLiveUserFrames = async (beatsInSegment: number): Promise<PoseFrame[]> => {
    if (!cameraPermission?.granted) {
      await requestCameraPermission();
      return [];
    }

    const frameCountTarget = Math.max(8, beatsInSegment * 4);
    const captureIntervalMs = 220;
    const frames: PoseFrame[] = [];
    const startMs = Date.now();

    setCaptureProgress(0);
    setLiveHint("Capturing live frames...");

    for (let i = 0; i < frameCountTarget; i += 1) {
      if (!cameraRef.current) break;
      try {
        const photo = await (cameraRef.current as any).takePictureAsync({ quality: 0.3, skipProcessing: true });
        if (photo?.uri) {
          const t = (Date.now() - startMs) / 1000;
          const frame = await estimatePoseFrameFromImage(photo.uri, t);
          if (frame) {
            frames.push(frame);
            setLiveHint("Tracking pose quality...");
          }
        }
      } catch {
        break;
      }

      setCaptureProgress((i + 1) / frameCountTarget);

      await new Promise((resolve) => setTimeout(resolve, captureIntervalMs));
    }

    setLastLiveFrames(frames.length);
    setCaptureProgress(1);
    setLiveHint(frames.length > 5 ? "Live capture ready" : "Live capture too sparse");

    if (frames.length) {
      await fetch(`${API_BASE_URL}/pose-ingest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: "mobile-live",
          fps: Math.round(1000 / captureIntervalMs),
          frames,
        }),
      });
    }

    return frames;
  };

  const requestRealtimeInsights = async (
    referenceFrames: PoseFrame[],
    userFrames: PoseFrame[],
    beatTimes: number[],
  ): Promise<void> => {
    try {
      const response = await fetch(`${API_BASE_URL}/movement-realtime`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          referenceFrames,
          userFrames,
          beatTimes,
          style,
          windowSize: 12,
          step: 6,
        }),
      });

      if (!response.ok) return;
      const insights: RealtimeInsights = await response.json();
      setRealtimeInsights(insights);
    } catch {
      setRealtimeInsights(null);
    }
  };

  const recordLiveSegment = async () => {
    if (followInputMode !== "camera" || captureMode !== "live") {
      Alert.alert(
        coachLanguage === "en" ? "Live recording disabled" : "当前不可录制",
        coachLanguage === "en" ? "Switch to Live Camera + Live Pose first." : "请先切到 现场录制 + Live Pose 模式。",
      );
      return;
    }

    const currentSegment = segments[selectedSegment] || [0, 1, 2, 3, 4, 5, 6, 7];
    const currentSegmentBeats = currentSegment.length || 8;
    const captured = await captureLiveUserFrames(currentSegmentBeats);
    if (captured.length >= 6) {
      setCapturedLiveFrames(captured);
      setFeedbackVisible(false);
      setLiveHint(coachLanguage === "en" ? `Recording complete (${captured.length} frames)` : `录制完成（${captured.length}帧）`);
    } else {
      setCapturedLiveFrames(null);
      Alert.alert(
        coachLanguage === "en" ? "Recording too short" : "录制不足",
        coachLanguage === "en" ? "Keep full body in frame and record again." : "请保持全身入镜后重新录制。",
      );
    }
  };

  const submitSegmentForAnalysis = async () => {
    setIsEvaluating(true);
    setMovementResult(null);
    setRealtimeInsights(null);
    setFeedbackVisible(false);
    setShowResourcePanel(false);

    try {
      const personConfirmed = await confirmPersonTargetsForFeedback();
      if (!personConfirmed) {
        setIsEvaluating(false);
        return;
      }

      if (!canGenerateFeedback) {
        throw new Error(
          coachLanguage === "en"
            ? "Complete upload or live recording before generating feedback."
            : "请先完成上传或现场录制，再生成反馈。",
        );
      }

      const currentSegment = segments[selectedSegment] || [0, 1, 2, 3, 4, 5, 6, 7];
      const currentSegmentBeats = currentSegment.length || 8;
      const mockPayload = buildMockEvaluationPayload(currentSegmentBeats, beatBpm, scenario);

      let userFrames = mockPayload.userFrames;
      if (followInputMode === "camera" && captureMode === "live") {
        if (!capturedLiveFrames || capturedLiveFrames.length < 6) {
          throw new Error(coachLanguage === "en" ? "Finish live recording first, then generate feedback." : "请先完成现场录制，再生成反馈。");
        }
        userFrames = capturedLiveFrames;
      } else if (followInputMode === "upload") {
        setLiveHint(
          coachLanguage === "en"
            ? "Upload analysis mode: using selected student + crop target for scoring context."
            : "上传分析模式：已使用所选学生和裁剪区域作为评分目标。",
        );
      } else {
        setLiveHint(coachLanguage === "en" ? "Mock mode enabled: scores are simulated." : "当前为Mock模式：分数为模拟结果。");
      }

      const response = await fetch(`${API_BASE_URL}/movement-evaluate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          referenceFrames: mockPayload.referenceFrames,
          userFrames,
          beatTimes: mockPayload.beatTimes,
          style,
          language: coachLanguage,
          segment: {
            index: selectedSegment,
            beats: currentSegment,
            mode: segmentMode ? "eight-count" : "free",
            source: captureMode,
            selectedPeople:
              followInputMode === "upload"
                ? {
                    referenceTeacherId: selectedReferencePersonId,
                    practiceStudentId: selectedPracticePersonId,
                    referenceCrop,
                    practiceCrop,
                  }
                : null,
          },
        }),
      });

      if (!response.ok) throw new Error(`movement-evaluate failed with status ${response.status}`);
      const result: MovementResult = await response.json();
      setMovementResult(result);
      setShowResourcePanel(false);
      setLiveHint(coachLanguage === "en" ? "Feedback generated. Tap View Feedback." : "反馈已生成，点击查看反馈。");
      await requestRealtimeInsights(mockPayload.referenceFrames, userFrames, mockPayload.beatTimes);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      Alert.alert("Segment analysis failed", message);
    } finally {
      setIsEvaluating(false);
    }
  };

  const buildTrainingPlan = (result: MovementResult): TrainingDrill[] => {
    const range = segmentRangeMs(beatData, selectedSegment, beatBpm);
    const fallbackCue = coachLanguage === "en" ? "Maintain line and timing." : "保持线条和节奏稳定。";
    const plan = (result.professional?.correctionPlan || []).slice(0, 3).map((block, index) => {
      const dosage = parseDosage(block.dosage);
      const offsetStart = range.startMs + index * 500;
      const offsetEnd = Math.max(offsetStart + 1200, range.endMs - index * 300);

      return {
        id: `${block.focusArea}-${index}`,
        title: block.focusArea,
        cue: block.intervention || fallbackCue,
        startMs: offsetStart,
        endMs: offsetEnd,
        sets: dosage.sets,
        workSec: dosage.workSec,
        restSec: dosage.restSec,
      };
    });

    if (plan.length) return plan;

    return [
      {
        id: "default-1",
        title: coachLanguage === "en" ? "Segment Repeat" : "分段复练",
        cue: fallbackCue,
        startMs: range.startMs,
        endMs: range.endMs,
        sets: 2,
        workSec: 40,
        restSec: 20,
      },
    ];
  };

  const startTrainingSession = () => {
    if (!movementResult || !videoUri) {
      Alert.alert("Training unavailable", coachLanguage === "en" ? "Complete one analysis first." : "请先完成一次动作分析。");
      return;
    }

    const plan = buildTrainingPlan(movementResult);
    setTrainingPlan(plan);
    setTrainingDrillIndex(0);
    setTrainingSetIndex(1);
    setTrainingPhase("work");
    setPhaseSecondsLeft(plan[0].workSec);
    setTrainingActive(true);
    setLiveHint(coachLanguage === "en" ? "Training session started" : "训练课次开始");
    referencePlayer.currentTime = plan[0].startMs / 1000;
    referencePlayer.play();
    if (practiceVideoUri) {
      practicePlayer.currentTime = getPracticeAlignedMs(plan[0].startMs) / 1000;
      practicePlayer.play();
    }
  };

  const stopTrainingSession = () => {
    setTrainingActive(false);
    setTrainingPhase("done");
    setPhaseSecondsLeft(0);
    setAbLoop({ active: false, startMs: 0, endMs: 0, repeatsLeft: 0 });
    setLiveHint(coachLanguage === "en" ? "Training session stopped" : "训练已停止");
  };

  const replayCurrentSegment = () => {
    if (!videoUri) return;
    const range = segmentRangeMs(beatData, selectedSegment, beatBpm);
    setTrainingActive(false);
    setTrainingPhase("done");
    setAbLoop({ active: false, startMs: 0, endMs: 0, repeatsLeft: 0 });
    referencePlayer.currentTime = range.startMs / 1000;
    referencePlayer.play();
    if (practiceVideoUri) {
      practicePlayer.currentTime = getPracticeAlignedMs(range.startMs) / 1000;
      practicePlayer.play();
    }
    setLiveHint(
      coachLanguage === "en"
        ? `Replaying segment ${selectedSegment + 1} in synced split-view`
        : `已同步回放第 ${selectedSegment + 1} 段（左右对比）`,
    );
  };

  const jumpToBeat = (beatTimeSec: number) => {
    if (!videoUri) return;
    const beatDurSec = 60 / Math.max(1, beatBpm);
    const windowSec = beatDurSec * Math.max(0.5, abWindowBeats);
    const startMs = Math.max(0, Math.round((beatTimeSec - windowSec) * 1000));
    const endMs = Math.max(startMs + 600, Math.round((beatTimeSec + windowSec) * 1000));
    setTrainingActive(false);
    setTrainingPhase("done");
    setAbLoop({ active: true, startMs, endMs, repeatsLeft: abLoopRepeats });
    referencePlayer.currentTime = startMs / 1000;
    referencePlayer.play();
    if (practiceVideoUri) {
      practicePlayer.currentTime = getPracticeAlignedMs(startMs) / 1000;
      practicePlayer.play();
    }
    setLiveHint(
      coachLanguage === "en"
        ? `AB loop around beat ${beatTimeSec.toFixed(2)}s (${abWindowBeats} beat window, x${abLoopRepeats})`
        : `已进入该拍前后${abWindowBeats}拍AB循环（${abLoopRepeats}次）`,
    );
  };

  const applyAutoAlign = () => {
    if (beatData?.beats?.length && practiceBeatData?.beats?.length) {
      const overlap = computeOverlapAlignmentByBeats(beatData, practiceBeatData);
      if (overlap) {
        const fine = computeFineOffsetMs(beatData, practiceBeatData, overlap.offsetMs);
        const finalOffset = fine ?? overlap.offsetMs;
        setCompareOffsetMs(finalOffset);
        setUseOverlapAnchor(true);
        setOverlapRefStartMs(overlap.overlapRefStartMs);
        setOverlapPracticeStartMs(overlap.overlapPracticeStartMs);
        referencePlayer.currentTime = overlap.overlapRefStartMs / 1000;
        practicePlayer.currentTime = overlap.overlapPracticeStartMs / 1000;
        setReferencePositionSec(referencePlayer.currentTime || overlap.overlapRefStartMs / 1000);
        setPracticePositionSec(practicePlayer.currentTime || overlap.overlapPracticeStartMs / 1000);
        setLiveHint(
          coachLanguage === "en"
            ? `Auto aligned to overlap start (${finalOffset}ms, ${overlap.matchCount} beat matches).`
            : `已对齐到重叠起点（${finalOffset}ms，匹配${overlap.matchCount}个节拍）。`,
        );
        return;
      }

      const robustOffset = computeRobustBeatOffsetMs(beatData, practiceBeatData) ?? 0;
      const beatOffsetMs = Math.max(-20000, Math.min(20000, robustOffset));
      setCompareOffsetMs(beatOffsetMs);
      setUseOverlapAnchor(false);
      setLiveHint(
        coachLanguage === "en"
          ? `Auto aligned by multi-beat tracks: ${beatOffsetMs}ms`
          : `按多拍轨道自动对齐：${beatOffsetMs}ms`,
      );
      return;
    }

    const markers = movementResult?.timingAnalysis?.markers || [];
    const deltas = markers
      .filter((m) => m.deltaSec !== null && m.status !== "unknown")
      .map((m) => Number(m.deltaSec));

    if (!deltas.length) {
      setLiveHint(coachLanguage === "en" ? "No timing data yet for auto align." : "暂无可用节拍数据，无法自动对齐。");
      return;
    }

    const avgDeltaSec = deltas.reduce((sum, value) => sum + value, 0) / deltas.length;
    const offset = Math.max(-20000, Math.min(20000, Math.round(avgDeltaSec * 1000)));
    setCompareOffsetMs(offset);
    setLiveHint(
      coachLanguage === "en"
        ? `Auto alignment set to ${offset}ms`
        : `已自动对齐，偏移 ${offset}ms`,
    );
  };

  const applyRecommendedAb = () => {
    setAbWindowBeats(recommendedAb.windowBeats);
    setAbLoopRepeats(recommendedAb.repeats);
    setLiveHint(coachLanguage === "en" ? recommendedAb.reasonEn : recommendedAb.reasonZh);
  };

  const openResource = async (url: string) => {
    const canOpen = await Linking.canOpenURL(url);
    if (!canOpen) {
      Alert.alert("Link unavailable", url);
      return;
    }
    await Linking.openURL(url);
  };

  const saveVideoToTemplate = (video: CuratedVideo) => {
    setSavedTemplateVideos((prev) => {
      if (prev.some((v) => v.url === video.url)) return prev;
      return [...prev, video].slice(-12);
    });
  };

  const setAsSessionDemo = (video: CuratedVideo) => {
    setSessionDemoVideo(video);
    setLiveHint(coachLanguage === "en" ? `Session demo set: ${video.title}` : `本节示范已设定：${video.title}`);
  };

  const toggleReferencePlayback = () => {
    if (!videoUri) return;
    if (referencePlayer.playing) {
      referencePlayer.pause();
    } else {
      referencePlayer.play();
    }
  };

  const togglePracticePlayback = () => {
    if (!practiceVideoUri || followInputMode !== "upload") return;
    if (practicePlayer.playing) {
      practicePlayer.pause();
    } else {
      practicePlayer.play();
    }
  };

  const seekReference = (sec: number) => {
    referencePlayer.currentTime = Math.max(0, Math.min(referenceDurationSec || sec, sec));
    setReferencePositionSec(referencePlayer.currentTime || 0);
    if (manualLinkedScrub && practiceVideoUri) {
      const targetPracticeSec = getPracticeAlignedMs(sec * 1000) / 1000;
      practicePlayer.currentTime = targetPracticeSec;
      setPracticePositionSec(practicePlayer.currentTime || targetPracticeSec);
    }
  };

  const seekPractice = (sec: number) => {
    practicePlayer.currentTime = Math.max(0, Math.min(practiceDurationSec || sec, sec));
    setPracticePositionSec(practicePlayer.currentTime || 0);
    if (manualLinkedScrub && videoUri) {
      const inverseRefSec = getReferenceFromPracticeMs(sec * 1000) / 1000;
      referencePlayer.currentTime = inverseRefSec;
      setReferencePositionSec(referencePlayer.currentTime || inverseRefSec);
    }
  };

  const confirmManualVideoLink = () => {
    if (!videoUri || !practiceVideoUri) {
      Alert.alert(
        coachLanguage === "en" ? "Need two videos" : "需要两个视频",
        coachLanguage === "en" ? "Upload both reference and practice videos first." : "请先上传参考视频和练习视频。",
      );
      return;
    }

    Alert.alert(
      coachLanguage === "en" ? "Enable Linked Scrub" : "启用联动拖拽",
      coachLanguage === "en"
        ? `You selected practice music speed ${practiceMusicRate.toFixed(2)}x vs original. Confirm to link both timelines while scrubbing.`
        : `你设置了练习视频音乐速度为原曲 ${practiceMusicRate.toFixed(2)}x。确认后左右拖拽将联动。`,
      [
        { text: coachLanguage === "en" ? "Cancel" : "取消", style: "cancel" },
        {
          text: coachLanguage === "en" ? "Confirm" : "确认",
          onPress: () => {
            setManualLinkedScrub(true);
            setLiveHint(
              coachLanguage === "en"
                ? `Linked scrub enabled at ${practiceMusicRate.toFixed(2)}x`
                : `已启用联动拖拽，速度 ${practiceMusicRate.toFixed(2)}x`,
            );
          },
        },
      ],
    );
  };

  const beginCropEdit = (target: "reference" | "practice") => {
    const entering = editingCropTarget !== target;
    if (!entering) {
      if (target === "reference") setReferenceCrop(clampRoi(referenceCropDraft));
      else setPracticeCrop(clampRoi(practiceCropDraft));
      setEditingCropTarget(null);
      return;
    }

    if (entering) {
      referencePlayer.pause();
      practicePlayer.pause();
      setReferencePlaying(false);
      setPracticePlaying(false);
    }

    if (target === "reference") setReferenceCropDraft(withCropInsetIfFull(referenceCrop));
    else setPracticeCropDraft(withCropInsetIfFull(practiceCrop));

    setEditingCropTarget(target);
  };

  const closePersonPicker = (value: string | null) => {
    setPersonPickerVisible(false);
    const resolver = personPickerResolverRef.current;
    personPickerResolverRef.current = null;
    if (resolver) resolver(value);
  };

  const promptSelectPersonCandidate = (
    role: PickerRole,
    candidates: PersonCandidate[],
    currentId: string | null,
  ): Promise<string | null> =>
    new Promise((resolve) => {
      personPickerResolverRef.current = resolve;
      setPersonPickerRole(role);
      setPersonPickerCandidates(candidates.slice(0, 8));
      setPersonPickerSelectedId(currentId || candidates[0]?.id || null);
      setPersonPickerVisible(true);
    });

  const confirmPersonTargetsForFeedback = async (): Promise<boolean> => {
    if (followInputMode !== "upload") return Promise.resolve(true);

    let nextReferencePeople = referencePeople;
    let nextPracticePeople = practicePeople;

    if (videoUri && referencePeople.length <= 1) {
      nextReferencePeople = await detectPeopleCandidatesFromVideo("reference", videoUri);
    }

    if (practiceVideoUri && practicePeople.length <= 1) {
      nextPracticePeople = await detectPeopleCandidatesFromVideo("practice", practiceVideoUri);
    }

    let refSelected = nextReferencePeople.find((p) => p.id === selectedReferencePersonId) || nextReferencePeople[0] || null;
    let pracSelected = nextPracticePeople.find((p) => p.id === selectedPracticePersonId) || nextPracticePeople[0] || null;

    if (refSelected && !selectedReferencePersonId) setSelectedReferencePersonId(refSelected.id);
    if (pracSelected && !selectedPracticePersonId) setSelectedPracticePersonId(pracSelected.id);

    let finalReferenceId = refSelected?.id || null;
    let finalPracticeId = pracSelected?.id || null;

    if (nextReferencePeople.length > 1) {
      finalReferenceId = await promptSelectPersonCandidate("reference", nextReferencePeople, finalReferenceId);
      if (!finalReferenceId) return false;
      setSelectedReferencePersonId(finalReferenceId);
      const selected = nextReferencePeople.find((p) => p.id === finalReferenceId);
      if (selected) {
        const next = roiFromCandidate(selected.box);
        setReferenceCrop(next);
        setReferenceCropDraft(next);
      }
    }

    if (nextPracticePeople.length > 1) {
      finalPracticeId = await promptSelectPersonCandidate("practice", nextPracticePeople, finalPracticeId);
      if (!finalPracticeId) return false;
      setSelectedPracticePersonId(finalPracticeId);
      const selected = nextPracticePeople.find((p) => p.id === finalPracticeId);
      if (selected) {
        const next = roiFromCandidate(selected.box);
        setPracticeCrop(next);
        setPracticeCropDraft(next);
      }
    }

    refSelected = nextReferencePeople.find((p) => p.id === (finalReferenceId || selectedReferencePersonId)) || nextReferencePeople[0] || null;
    pracSelected = nextPracticePeople.find((p) => p.id === (finalPracticeId || selectedPracticePersonId)) || nextPracticePeople[0] || null;

    if (!refSelected || !pracSelected) {
      Alert.alert(
        coachLanguage === "en" ? "Select targets first" : "请先选择分析对象",
        coachLanguage === "en"
          ? "Multiple people detected, but teacher/student target is not locked yet. Choose target person first."
          : "检测到多人，但老师/学生目标尚未锁定。请先选择分析对象。",
      );
      return Promise.resolve(false);
    }

    return true;
  };

  const autoAlignByBackgroundMusic = async () => {
    if (isLoadingBeat) return;
    if (!videoUri || !practiceVideoUri) {
      Alert.alert(
        coachLanguage === "en" ? "Need two videos" : "需要两个视频",
        coachLanguage === "en" ? "Upload both reference and practice videos first." : "请先上传参考视频和跟练视频。",
      );
      return;
    }
    let refBeat = beatData;
    let pracBeat = practiceBeatData;
    setIsLoadingBeat(true);

    try {
      setLiveHint(coachLanguage === "en" ? "Aligning by waveform correlation..." : "正在进行波形相关对齐...");
      const waveAligned = await alignMusicByWaveform(
        { uri: videoUri, name: videoName ?? "reference.mp4" },
        { uri: practiceVideoUri, name: practiceVideoName ?? "practice.mp4" },
      );

      setCompareOffsetMs(Math.max(-60000, Math.min(60000, waveAligned.offsetMs)));
      setManualLinkedScrub(true);
      setUseOverlapAnchor(true);
      setOverlapRefStartMs(Math.max(0, waveAligned.overlapRefStartMs));
      setOverlapPracticeStartMs(Math.max(0, waveAligned.overlapPracticeStartMs));

      referencePlayer.currentTime = Math.max(0, waveAligned.overlapRefStartMs) / 1000;
      practicePlayer.currentTime = Math.max(0, waveAligned.overlapPracticeStartMs) / 1000;
      setReferencePositionSec(referencePlayer.currentTime || Math.max(0, waveAligned.overlapRefStartMs) / 1000);
      setPracticePositionSec(practicePlayer.currentTime || Math.max(0, waveAligned.overlapPracticeStartMs) / 1000);
      setTrainingActive(false);
      setTrainingPhase("done");
      setAbLoop({ active: false, startMs: 0, endMs: 0, repeatsLeft: 0 });
      referencePlayer.play();
      practicePlayer.play();
      setReferencePlaying(true);
      setPracticePlaying(true);

      setLiveHint(
        coachLanguage === "en"
          ? `Waveform-aligned at overlap start (${waveAligned.offsetMs}ms, confidence ${(waveAligned.confidence ?? 0).toFixed(3)}).`
          : `已按波形对齐到重叠起点（${waveAligned.offsetMs}ms，置信度 ${(waveAligned.confidence ?? 0).toFixed(3)}）。`,
      );
      setIsLoadingBeat(false);
      return;
    } catch {
      // Fallback to beat-track alignment below when waveform route is unavailable.
    }

    try {
      if (!refBeat?.beats?.length) {
        setLiveHint(coachLanguage === "en" ? "Analyzing reference beat..." : "正在分析参考视频节拍...");
        refBeat = await analyzeBeat(videoUri, videoName ?? "reference.mp4", null);
        setBeatData(refBeat);
      }
      if (!pracBeat?.beats?.length) {
        setLiveHint(coachLanguage === "en" ? "Analyzing practice beat..." : "正在分析跟练视频节拍...");
        pracBeat = await analyzeBeat(practiceVideoUri, practiceVideoName ?? "practice.mp4", null);
        setPracticeBeatData(pracBeat);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      Alert.alert(
        coachLanguage === "en" ? "Auto align failed" : "自动对齐失败",
        coachLanguage === "en" ? `Beat analysis failed: ${message}` : `节拍分析失败：${message}`,
      );
      setIsLoadingBeat(false);
      return;
    }

    if (!refBeat?.beats?.length || !pracBeat?.beats?.length) {
      Alert.alert(
        coachLanguage === "en" ? "Beat data unavailable" : "缺少节拍数据",
        coachLanguage === "en" ? "Could not extract beat tracks from one or both videos." : "一个或两个视频未能提取到节拍轨。",
      );
      setIsLoadingBeat(false);
      return;
    }

    const overlap = computeOverlapAlignmentByBeats(refBeat, pracBeat);
    if (!overlap) {
      Alert.alert(
        coachLanguage === "en" ? "Auto align failed" : "自动对齐失败",
        coachLanguage === "en" ? "Could not find stable beat overlap." : "未找到稳定的重叠节拍。",
      );
      setIsLoadingBeat(false);
      return;
    }

    const fine = computeFineOffsetMs(refBeat, pracBeat, overlap.offsetMs);
    const finalOffset = fine ?? overlap.offsetMs;
    setCompareOffsetMs(finalOffset);
    setManualLinkedScrub(true);
    setUseOverlapAnchor(true);
    setOverlapRefStartMs(overlap.overlapRefStartMs);
    setOverlapPracticeStartMs(overlap.overlapPracticeStartMs);

    referencePlayer.currentTime = overlap.overlapRefStartMs / 1000;
    practicePlayer.currentTime = overlap.overlapPracticeStartMs / 1000;
    setReferencePositionSec(referencePlayer.currentTime || overlap.overlapRefStartMs / 1000);
    setPracticePositionSec(practicePlayer.currentTime || overlap.overlapPracticeStartMs / 1000);
    setTrainingActive(false);
    setTrainingPhase("done");
    setAbLoop({ active: false, startMs: 0, endMs: 0, repeatsLeft: 0 });
    referencePlayer.play();
    practicePlayer.play();
    setReferencePlaying(true);
    setPracticePlaying(true);

    setLiveHint(
      coachLanguage === "en"
        ? `Music overlap aligned at start (${finalOffset}ms, ${overlap.matchCount} beat matches). Linked scrub enabled.`
        : `已对齐到音乐重叠起点（${finalOffset}ms，匹配${overlap.matchCount}个节拍），已开启联动拖拽。`,
    );
    setIsLoadingBeat(false);
  };

  const queueReferencePreview = (sec: number) => {
    if (!videoUri) return;
    if (referencePreviewTimerRef.current) clearTimeout(referencePreviewTimerRef.current);
    referencePreviewTimerRef.current = setTimeout(() => {
      VideoThumbnails.getThumbnailAsync(videoUri, { time: Math.max(0, Math.round(sec * 1000)) })
        .then((thumb) => setReferencePreviewUri(thumb.uri))
        .catch(() => setReferencePreviewUri(null));
    }, 100);
  };

  const queuePracticePreview = (sec: number) => {
    if (!practiceVideoUri) return;
    if (practicePreviewTimerRef.current) clearTimeout(practicePreviewTimerRef.current);
    practicePreviewTimerRef.current = setTimeout(() => {
      VideoThumbnails.getThumbnailAsync(practiceVideoUri, { time: Math.max(0, Math.round(sec * 1000)) })
        .then((thumb) => setPracticePreviewUri(thumb.uri))
        .catch(() => setPracticePreviewUri(null));
    }, 100);
  };

  useEffect(() => {
    return () => {
      if (referencePreviewTimerRef.current) clearTimeout(referencePreviewTimerRef.current);
      if (practicePreviewTimerRef.current) clearTimeout(practicePreviewTimerRef.current);
    };
  }, []);

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />

      <View style={styles.headerRow}>
        <Text style={styles.title}>AIDance Lab</Text>
      </View>

      <Text style={styles.sectionLabel}>{coachLanguage === "en" ? "Style Selection" : "舞种选择"}</Text>
      <View style={styles.styleGrid}>
        {STYLE_OPTIONS.map((opt) => (
          <Pressable
            key={opt}
            style={[styles.langPill, style === opt && styles.langPillActive]}
            onPress={() => setStyle(opt)}
          >
            <Text style={styles.langPillText}>{styleLabel(opt, coachLanguage)}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.sectionLabel}>{coachLanguage === "en" ? "Language Selection" : "语言选择"}</Text>
      <View style={styles.langRow}>
        {([
          ["zh", "中文教练"],
          ["en", coachLanguage === "en" ? "English Coach" : "英文教练"],
        ] as const).map(([lang, label]) => (
          <Pressable
            key={lang}
            style={[styles.langPill, coachLanguage === lang && styles.langPillActive]}
            onPress={() => setCoachLanguage(lang)}
          >
            <Text style={styles.langPillText}>{label}</Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.workspace}>
        <View style={styles.panel}>
          <View style={styles.panelHeaderRow}>
            <Text style={styles.panelLabel}>{coachLanguage === "en" ? "Reference Dance" : "参考视频"}</Text>
          </View>
          <View style={styles.captureModeRow}>
            {([
              ["upload", coachLanguage === "en" ? "Upload" : "上传视频"],
              ["camera", coachLanguage === "en" ? "Live Camera" : "现场录制"],
            ] as const).map(([mode, label]) => (
              <Pressable
                key={`ref-${mode}`}
                style={[styles.modePill, referenceInputMode === mode && styles.modePillActive]}
                onPress={() => {
                  setReferenceInputMode(mode);
                  setEditingCropTarget(null);
                  setFeedbackVisible(false);
                  setCapturedLiveFrames(null);
                  if (mode === "camera") {
                    setFollowInputMode("upload");
                    setCaptureMode("live");
                  }
                }}
              >
                <Text style={styles.modePillText}>{label}</Text>
              </Pressable>
            ))}
            <View style={styles.speedInlineWrap}>
              <Pressable style={styles.speedButton} onPress={() => setSpeed((prev) => clampSpeed(prev - 0.1))}>
                <Text style={styles.speedButtonText}>-</Text>
              </Pressable>
              <Text style={styles.speedText}>{speed.toFixed(1)}x</Text>
              <Pressable style={styles.speedButton} onPress={() => setSpeed((prev) => clampSpeed(prev + 0.1))}>
                <Text style={styles.speedButtonText}>+</Text>
              </Pressable>
            </View>
          </View>
          <View style={styles.segmentRow}>
            <Pressable style={styles.segmentButton} onPress={() => openUploadSourcePicker("reference")}>
              <Text style={styles.segmentButtonText}>{coachLanguage === "en" ? "Upload" : "上传"}</Text>
            </Pressable>
            <Pressable
              style={styles.segmentButton}
              onPress={() => {
                setVideoUri(null);
                setVideoName(null);
                setBeatData(null);
                setReferenceCrop(DEFAULT_CROP_ROI);
                setReferenceCropDraft(DEFAULT_CROP_ROI);
                setReferencePeople([]);
                setSelectedReferencePersonId(null);
                setEditingCropTarget(null);
                setFeedbackVisible(false);
              }}
            >
              <Text style={styles.segmentButtonText}>{coachLanguage === "en" ? "Clear" : "清除"}</Text>
            </Pressable>
          </View>
          <View style={styles.segmentRow}>
            <Pressable
              style={[styles.segmentButton, (!videoUri || referenceInputMode !== "upload") && styles.segmentButtonDisabled]}
              onPress={() => {
                if (!videoUri || referenceInputMode !== "upload") return;
                beginCropEdit("reference");
              }}
            >
              <Text style={styles.segmentButtonText}>
                {editingCropTarget === "reference"
                  ? coachLanguage === "en"
                    ? "Finish Crop"
                    : "完成裁剪"
                  : coachLanguage === "en"
                    ? "Crop"
                    : "裁剪"}
              </Text>
            </Pressable>
            <Pressable
              style={[styles.segmentButton, (!videoUri || referenceInputMode !== "upload") && styles.segmentButtonDisabled]}
              onPress={() => {
                setReferenceCrop(DEFAULT_CROP_ROI);
                setReferenceCropDraft(DEFAULT_CROP_ROI);
                setSelectedReferencePersonId(referencePeople[0]?.id ?? null);
              }}
            >
              <Text style={styles.segmentButtonText}>{coachLanguage === "en" ? "Reset Crop" : "重置裁剪"}</Text>
            </Pressable>
            <Pressable
              style={[styles.segmentButton, !videoUri && styles.segmentButtonDisabled]}
              onPress={() => {
                if (!videoUri) return;
                void detectPeopleCandidatesFromVideo("reference", videoUri);
              }}
            >
              <Text style={styles.segmentButtonText}>{coachLanguage === "en" ? "Re-detect People" : "重新检测人物"}</Text>
            </Pressable>
          </View>
          <View style={styles.videoContainer}>
            {referenceInputMode === "camera" ? (
              cameraPermission?.granted ? (
                <CameraView ref={cameraRef} style={styles.video} facing="front" />
              ) : (
                <View style={styles.permissionBox}>
                  <Text style={styles.placeholderText}>{coachLanguage === "en" ? "Camera permission required." : "需要相机权限。"}</Text>
                  <Pressable style={styles.permissionButton} onPress={requestCameraPermission}>
                    <Text style={styles.permissionButtonText}>{coachLanguage === "en" ? "Enable Camera" : "开启相机"}</Text>
                  </Pressable>
                </View>
              )
            ) : videoUri ? (
              editingCropTarget === "reference" ? (
                <View style={styles.videoTapArea}>
                  <View
                    style={styles.cropViewport}
                    onLayout={(event) => {
                      const { width, height } = event.nativeEvent.layout;
                      setReferenceViewport({ width, height });
                    }}
                  >
                    <VideoView player={referencePlayer} style={styles.video} nativeControls={false} contentFit="fill" />
                    <View style={styles.cropEditMask} pointerEvents="box-none">
                      <View style={[styles.cropRect, referenceCropRectStyle]}>
                        <View style={styles.cropMoveSurface} {...referenceCropPanResponder.panHandlers} />
                        <View style={styles.cropHintBadge}>
                          <Text style={styles.cropHintText}>{coachLanguage === "en" ? "Drag / Pinch" : "拖动 / 双指缩放"}</Text>
                        </View>
                        <View style={[styles.cropHandle, styles.cropHandleTL]} />
                        <View style={[styles.cropHandle, styles.cropHandleTR]} />
                        <View style={[styles.cropHandle, styles.cropHandleBL]} />
                        <View style={[styles.cropHandle, styles.cropHandleBR]} />
                        <View style={[styles.cropEdgeHandle, styles.cropEdgeTop]} {...referenceTopEdgePanResponder.panHandlers} />
                        <View style={[styles.cropEdgeHandle, styles.cropEdgeBottom]} {...referenceBottomEdgePanResponder.panHandlers} />
                        <View style={[styles.cropEdgeHandle, styles.cropEdgeLeft]} {...referenceLeftEdgePanResponder.panHandlers} />
                        <View style={[styles.cropEdgeHandle, styles.cropEdgeRight]} {...referenceRightEdgePanResponder.panHandlers} />
                      </View>
                    </View>
                  </View>
                </View>
              ) : (
              <Pressable style={styles.videoTapArea} onPress={toggleReferencePlayback}>
                <View
                  style={styles.cropViewport}
                  onLayout={(event) => {
                    const { width, height } = event.nativeEvent.layout;
                    setReferenceViewport({ width, height });
                  }}
                >
                  <VideoView player={referencePlayer} style={[styles.video, referenceVideoFrameStyle]} nativeControls={false} contentFit="fill" />
                  {referenceCrop.w >= 0.98 && referenceCrop.h >= 0.98
                    ? referencePeople.map((candidate) => (
                        <Pressable
                          key={candidate.id}
                          style={[
                            styles.personBox,
                            {
                              left: `${candidate.box.x * 100}%`,
                              top: `${candidate.box.y * 100}%`,
                              width: `${candidate.box.w * 100}%`,
                              height: `${candidate.box.h * 100}%`,
                            },
                            selectedReferencePersonId === candidate.id && styles.personBoxSelected,
                          ]}
                          onPress={() => selectPersonCandidate("reference", candidate)}
                        >
                          {selectedReferencePersonId === candidate.id ? (
                            <View style={styles.personTag}>
                              <Text style={styles.personTagText}>{coachLanguage === "en" ? "Teacher" : "老师"}</Text>
                            </View>
                          ) : null}
                        </Pressable>
                      ))
                    : null}
                </View>
                {!referencePlaying ? (
                  <View style={styles.playOverlay}>
                    <Text style={styles.playOverlayText}>▶</Text>
                  </View>
                ) : null}
              </Pressable>
              )
            ) : (
              <Text style={styles.placeholderText}>{coachLanguage === "en" ? "Upload a dance video to start." : "请先上传参考视频。"}</Text>
            )}
            {referenceInputMode === "upload" && videoUri ? (
              <View style={styles.volumeAnchor}>
                <Pressable
                  style={styles.volumeBtn}
                  onPress={() => {
                    setShowReferenceVolume((prev) => !prev);
                    setShowPracticeVolume(false);
                  }}
                >
                  <Text style={styles.volumeBtnText}>{referenceVolume <= 0.01 ? "🔇" : "🔊"}</Text>
                </Pressable>
                {showReferenceVolume ? (
                  <View style={styles.volumePanel}>
                    <Text style={styles.volumeLabel}>{coachLanguage === "en" ? "Volume" : "音量"}</Text>
                    <Slider
                      minimumValue={0}
                      maximumValue={1}
                      step={0.05}
                      value={referenceVolume}
                      minimumTrackTintColor="#D9714C"
                      maximumTrackTintColor="#3B4B67"
                      thumbTintColor="#F4EBDC"
                      onValueChange={setReferenceVolume}
                    />
                  </View>
                ) : null}
              </View>
            ) : null}
          </View>
          {referenceInputMode === "upload" && videoUri ? (
            <View style={styles.timelineWrap}>
              <Slider
                minimumValue={0}
                maximumValue={Math.max(0.1, referenceDurationSec || 0.1)}
                value={referencePositionSec}
                minimumTrackTintColor="#D9714C"
                maximumTrackTintColor="#3B4B67"
                thumbTintColor="#F4EBDC"
                onSlidingStart={() => {
                  setReferenceScrubbing(true);
                  queueReferencePreview(referencePositionSec);
                }}
                onValueChange={(value) => {
                  setReferencePositionSec(value);
                  queueReferencePreview(value);
                }}
                onSlidingComplete={(value) => {
                  seekReference(value);
                  setReferenceScrubbing(false);
                }}
              />
              <View style={styles.timeRow}>
                <Text style={styles.timeText}>{formatTimeLabel(referencePositionSec)}</Text>
                <Text style={styles.timeText}>{formatTimeLabel(referenceDurationSec)}</Text>
              </View>
              {referenceScrubbing && referencePreviewUri ? (
                <View style={styles.scrubPreviewCard}>
                  <Image source={{ uri: referencePreviewUri }} style={styles.scrubPreviewImage} resizeMode="cover" />
                  <Text style={styles.scrubPreviewText}>{formatTimeLabel(referencePositionSec)}</Text>
                </View>
              ) : null}
            </View>
          ) : null}
          <Text style={styles.fileNameText}>
            {referenceInputMode === "camera"
              ? coachLanguage === "en"
                ? "Using live camera"
                : "当前使用实时摄像头"
              : videoName ?? (coachLanguage === "en" ? "No reference selected" : "未选择参考视频")}
          </Text>
          {referencePeople.length > 0 ? (
            <Text style={styles.liveMetaText}>
              {coachLanguage === "en"
                ? `Detected teachers: ${referencePeople.length}. Pick below or in Crop mode.`
                : `检测到老师候选 ${referencePeople.length} 人，可在下方或裁剪模式里选择。`}
            </Text>
          ) : referenceInputMode === "upload" && videoUri ? (
            <Text style={styles.liveMetaText}>
              {coachLanguage === "en"
                ? "No stable teacher detection yet. Tap Re-detect People."
                : "暂未稳定检测到老师，请点“重新检测人物”。"}
            </Text>
          ) : null}
          {referencePeople.length > 0 ? (
            <View style={styles.captureModeRow}>
              {referencePeople.map((candidate, index) => (
                <Pressable
                  key={candidate.id}
                  style={[styles.modePill, selectedReferencePersonId === candidate.id && styles.modePillActive]}
                  onPress={() => selectPersonCandidate("reference", candidate)}
                >
                  <Text style={styles.modePillText}>{coachLanguage === "en" ? `Teacher ${index + 1}` : `老师 ${index + 1}`}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
          <View style={styles.beatHudInline}>
            {isLoadingBeat ? (
              <View style={styles.hudRow}>
                <ActivityIndicator color="#F4EBDC" />
                <Text style={styles.hudText}>{coachLanguage === "en" ? "Analyzing beat..." : "节拍分析中..."}</Text>
              </View>
            ) : beatData?.beats?.length && referencePlaying ? (
              <>
                <Text style={styles.hudText}>Beat {eightCount}/8</Text>
                <Text style={styles.hudSubText}>{beatBpm.toFixed(1)} BPM</Text>
                <Text style={styles.hudSubText}>{coachLanguage === "en" ? "Playing sync active" : "播放中节拍同步"}</Text>
              </>
            ) : (
              <Text style={styles.hudSubText}>{coachLanguage === "en" ? "Beat meter appears while reference is playing." : "参考视频播放时显示节拍器。"}</Text>
            )}
          </View>
          <View style={styles.segmentRow}>
            <Pressable
              style={[
                styles.segmentButton,
                (!videoUri || !practiceVideoUri || isLoadingBeat) && styles.segmentButtonDisabled,
              ]}
              onPress={autoAlignByBackgroundMusic}
            >
              <Text style={styles.segmentButtonText}>{coachLanguage === "en" ? "Auto Align Music" : "背景音乐自动对齐"}</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.panel}>
          <View style={styles.panelHeaderRow}>
            <Text style={styles.panelLabel}>{coachLanguage === "en" ? "Follow Practice" : "跟练视频"}</Text>
          </View>
          <View style={styles.captureModeRow}>
            {([
              ["upload", coachLanguage === "en" ? "Upload" : "上传视频"],
              ["camera", coachLanguage === "en" ? "Live Camera" : "现场录制"],
            ] as const).map(([mode, label]) => (
              <Pressable
                key={mode}
                style={[styles.modePill, followInputMode === mode && styles.modePillActive]}
                onPress={() => {
                  setFollowInputMode(mode);
                  setCaptureMode(mode === "camera" ? "live" : "mock");
                  setEditingCropTarget(null);
                  setFeedbackVisible(false);
                  setCapturedLiveFrames(null);
                  if (mode === "camera") {
                    setPracticeVideoUri(null);
                    setPracticeVideoName(null);
                    setPracticeCrop(DEFAULT_CROP_ROI);
                    setPracticeCropDraft(DEFAULT_CROP_ROI);
                    setPracticePeople([]);
                    setSelectedPracticePersonId(null);
                    setReferenceInputMode("upload");
                  }
                }}
              >
                <Text style={styles.modePillText}>{label}</Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.segmentRow}>
            <Pressable style={styles.segmentButton} onPress={() => openUploadSourcePicker("practice")}>
              <Text style={styles.segmentButtonText}>{coachLanguage === "en" ? "Upload" : "上传"}</Text>
            </Pressable>
            <Pressable
              style={styles.segmentButton}
              onPress={() => {
                setPracticeVideoUri(null);
                setPracticeVideoName(null);
                setPracticeBeatData(null);
                setPracticeCrop(DEFAULT_CROP_ROI);
                setPracticeCropDraft(DEFAULT_CROP_ROI);
                setPracticePeople([]);
                setSelectedPracticePersonId(null);
                setEditingCropTarget(null);
                setCapturedLiveFrames(null);
                setFeedbackVisible(false);
              }}
            >
              <Text style={styles.segmentButtonText}>{coachLanguage === "en" ? "Clear" : "清除"}</Text>
            </Pressable>
          </View>
          <View style={styles.segmentRow}>
            <Pressable
              style={[styles.segmentButton, (!practiceVideoUri || followInputMode !== "upload") && styles.segmentButtonDisabled]}
              onPress={() => {
                if (!practiceVideoUri || followInputMode !== "upload") return;
                beginCropEdit("practice");
              }}
            >
              <Text style={styles.segmentButtonText}>
                {editingCropTarget === "practice"
                  ? coachLanguage === "en"
                    ? "Finish Crop"
                    : "完成裁剪"
                  : coachLanguage === "en"
                    ? "Crop"
                    : "裁剪"}
              </Text>
            </Pressable>
            <Pressable
              style={[styles.segmentButton, (!practiceVideoUri || followInputMode !== "upload") && styles.segmentButtonDisabled]}
              onPress={() => {
                setPracticeCrop(DEFAULT_CROP_ROI);
                setPracticeCropDraft(DEFAULT_CROP_ROI);
                setSelectedPracticePersonId(practicePeople[0]?.id ?? null);
              }}
            >
              <Text style={styles.segmentButtonText}>{coachLanguage === "en" ? "Reset Crop" : "重置裁剪"}</Text>
            </Pressable>
            <Pressable
              style={[styles.segmentButton, !practiceVideoUri && styles.segmentButtonDisabled]}
              onPress={() => {
                if (!practiceVideoUri) return;
                void detectPeopleCandidatesFromVideo("practice", practiceVideoUri);
              }}
            >
              <Text style={styles.segmentButtonText}>{coachLanguage === "en" ? "Re-detect People" : "重新检测人物"}</Text>
            </Pressable>
          </View>
          <View style={styles.videoContainer}>
            {followInputMode === "upload" ? (
              practiceVideoUri ? (
                editingCropTarget === "practice" ? (
                  <View style={styles.videoTapArea}>
                    <View
                      style={styles.cropViewport}
                      onLayout={(event) => {
                        const { width, height } = event.nativeEvent.layout;
                        setPracticeViewport({ width, height });
                      }}
                    >
                      <VideoView player={practicePlayer} style={styles.video} nativeControls={false} contentFit="fill" />
                      <View style={styles.cropEditMask} pointerEvents="box-none">
                        <View style={[styles.cropRect, practiceCropRectStyle]}>
                          <View style={styles.cropMoveSurface} {...practiceCropPanResponder.panHandlers} />
                          <View style={styles.cropHintBadge}>
                            <Text style={styles.cropHintText}>{coachLanguage === "en" ? "Drag / Pinch" : "拖动 / 双指缩放"}</Text>
                          </View>
                          <View style={[styles.cropHandle, styles.cropHandleTL]} />
                          <View style={[styles.cropHandle, styles.cropHandleTR]} />
                          <View style={[styles.cropHandle, styles.cropHandleBL]} />
                          <View style={[styles.cropHandle, styles.cropHandleBR]} />
                          <View style={[styles.cropEdgeHandle, styles.cropEdgeTop]} {...practiceTopEdgePanResponder.panHandlers} />
                          <View style={[styles.cropEdgeHandle, styles.cropEdgeBottom]} {...practiceBottomEdgePanResponder.panHandlers} />
                          <View style={[styles.cropEdgeHandle, styles.cropEdgeLeft]} {...practiceLeftEdgePanResponder.panHandlers} />
                          <View style={[styles.cropEdgeHandle, styles.cropEdgeRight]} {...practiceRightEdgePanResponder.panHandlers} />
                        </View>
                      </View>
                    </View>
                  </View>
                ) : (
                <Pressable style={styles.videoTapArea} onPress={togglePracticePlayback}>
                  <View
                    style={styles.cropViewport}
                    onLayout={(event) => {
                      const { width, height } = event.nativeEvent.layout;
                      setPracticeViewport({ width, height });
                    }}
                  >
                    <VideoView player={practicePlayer} style={[styles.video, practiceVideoFrameStyle]} nativeControls={false} contentFit="fill" />
                    {practiceCrop.w >= 0.98 && practiceCrop.h >= 0.98
                      ? practicePeople.map((candidate) => (
                          <Pressable
                            key={candidate.id}
                            style={[
                              styles.personBox,
                              {
                                left: `${candidate.box.x * 100}%`,
                                top: `${candidate.box.y * 100}%`,
                                width: `${candidate.box.w * 100}%`,
                                height: `${candidate.box.h * 100}%`,
                              },
                              selectedPracticePersonId === candidate.id && styles.personBoxSelected,
                            ]}
                            onPress={() => selectPersonCandidate("practice", candidate)}
                          >
                            {selectedPracticePersonId === candidate.id ? (
                              <View style={styles.personTag}>
                                <Text style={styles.personTagText}>{coachLanguage === "en" ? "Student" : "学生"}</Text>
                              </View>
                            ) : null}
                          </Pressable>
                        ))
                      : null}
                  </View>
                  {!practicePlaying ? (
                    <View style={styles.playOverlay}>
                      <Text style={styles.playOverlayText}>▶</Text>
                    </View>
                  ) : null}
                </Pressable>
                )
              ) : (
                <Text style={styles.placeholderText}>{coachLanguage === "en" ? "Upload your practice video." : "请上传你的练习视频。"}</Text>
              )
            ) : cameraPermission?.granted ? (
              <CameraView ref={cameraRef} style={styles.video} facing="front" />
            ) : (
              <View style={styles.permissionBox}>
                <Text style={styles.placeholderText}>{coachLanguage === "en" ? "Camera permission required." : "需要相机权限。"}</Text>
                <Pressable style={styles.permissionButton} onPress={requestCameraPermission}>
                  <Text style={styles.permissionButtonText}>{coachLanguage === "en" ? "Enable Camera" : "开启相机"}</Text>
                </Pressable>
              </View>
            )}
            {followInputMode === "upload" && practiceVideoUri ? (
              <View style={styles.volumeAnchor}>
                <Pressable
                  style={styles.volumeBtn}
                  onPress={() => {
                    setShowPracticeVolume((prev) => !prev);
                    setShowReferenceVolume(false);
                  }}
                >
                  <Text style={styles.volumeBtnText}>{practiceVolume <= 0.01 ? "🔇" : "🔊"}</Text>
                </Pressable>
                {showPracticeVolume ? (
                  <View style={styles.volumePanel}>
                    <Text style={styles.volumeLabel}>{coachLanguage === "en" ? "Volume" : "音量"}</Text>
                    <Slider
                      minimumValue={0}
                      maximumValue={1}
                      step={0.05}
                      value={practiceVolume}
                      minimumTrackTintColor="#D9714C"
                      maximumTrackTintColor="#3B4B67"
                      thumbTintColor="#F4EBDC"
                      onValueChange={setPracticeVolume}
                    />
                  </View>
                ) : null}
              </View>
            ) : null}
          </View>
          {followInputMode === "upload" && practiceVideoUri ? (
            <View style={styles.timelineWrap}>
              <Slider
                minimumValue={0}
                maximumValue={Math.max(0.1, practiceDurationSec || 0.1)}
                value={practicePositionSec}
                minimumTrackTintColor="#D9714C"
                maximumTrackTintColor="#3B4B67"
                thumbTintColor="#F4EBDC"
                onSlidingStart={() => {
                  setPracticeScrubbing(true);
                  queuePracticePreview(practicePositionSec);
                }}
                onValueChange={(value) => {
                  setPracticePositionSec(value);
                  queuePracticePreview(value);
                }}
                onSlidingComplete={(value) => {
                  seekPractice(value);
                  setPracticeScrubbing(false);
                }}
              />
              <View style={styles.timeRow}>
                <Text style={styles.timeText}>{formatTimeLabel(practicePositionSec)}</Text>
                <Text style={styles.timeText}>{formatTimeLabel(practiceDurationSec)}</Text>
              </View>
              {practiceScrubbing && practicePreviewUri ? (
                <View style={styles.scrubPreviewCard}>
                  <Image source={{ uri: practicePreviewUri }} style={styles.scrubPreviewImage} resizeMode="cover" />
                  <Text style={styles.scrubPreviewText}>{formatTimeLabel(practicePositionSec)}</Text>
                </View>
              ) : null}
            </View>
          ) : null}
          <Text style={styles.fileNameText}>
            {followInputMode === "upload"
              ? practiceVideoName ?? (coachLanguage === "en" ? "No practice video selected" : "未选择练习视频")
              : coachLanguage === "en"
                ? "Using live camera"
                : "当前使用实时摄像头"}
          </Text>
          {practicePeople.length > 0 ? (
            <Text style={styles.liveMetaText}>
              {coachLanguage === "en"
                ? `Detected students: ${practicePeople.length}. Pick below or in Crop mode.`
                : `检测到学生候选 ${practicePeople.length} 人，可在下方或裁剪模式里选择。`}
            </Text>
          ) : followInputMode === "upload" && practiceVideoUri ? (
            <Text style={styles.liveMetaText}>
              {coachLanguage === "en"
                ? "No stable student detection yet. Tap Re-detect People."
                : "暂未稳定检测到学生，请点“重新检测人物”。"}
            </Text>
          ) : null}
          {practicePeople.length > 0 ? (
            <View style={styles.captureModeRow}>
              {practicePeople.map((candidate, index) => (
                <Pressable
                  key={candidate.id}
                  style={[styles.modePill, selectedPracticePersonId === candidate.id && styles.modePillActive]}
                  onPress={() => selectPersonCandidate("practice", candidate)}
                >
                  <Text style={styles.modePillText}>{coachLanguage === "en" ? `Student ${index + 1}` : `学生 ${index + 1}`}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
          <Text style={styles.liveMetaText}>
            {coachLanguage === "en" ? "Playback sync" : "同步速度"}: {speed.toFixed(1)}x
            {coachLanguage === "en" ? " (matched to reference)" : "（跟随参考）"}
          </Text>
          <View style={styles.rateRow}>
            <Text style={styles.liveMetaText}>{coachLanguage === "en" ? "Practice music rate" : "练习音乐倍速"}</Text>
            <TextInput
              style={styles.rateInput}
              value={practiceMusicRateInput}
              keyboardType="decimal-pad"
              onChangeText={(text) => {
                const normalized = text.replace(/[^0-9.]/g, "");
                setPracticeMusicRateInput(normalized);
                setManualLinkedScrub(false);
              }}
              onBlur={() => setPracticeMusicRateInput(parseMusicRate(practiceMusicRateInput).toFixed(2))}
              placeholder="1.00"
              placeholderTextColor="#7E8BA3"
            />
            <Text style={styles.liveMetaText}>x</Text>
            <Pressable style={styles.trainGhostButton} onPress={confirmManualVideoLink}>
              <Text style={styles.trainGhostText}>{coachLanguage === "en" ? "Enable Link" : "开启联动"}</Text>
            </Pressable>
            <Pressable
              style={styles.trainGhostButton}
              onPress={() => {
                setManualLinkedScrub(false);
                setLiveHint(coachLanguage === "en" ? "Linked scrub disabled" : "已关闭联动拖拽");
              }}
            >
              <Text style={styles.trainGhostText}>{coachLanguage === "en" ? "Unlink" : "取消联动"}</Text>
            </Pressable>
          </View>
          <Text style={styles.legalText}>
            {manualLinkedScrub
              ? coachLanguage === "en"
                ? "Linked scrub is ON: dragging either timeline moves the other."
                : "联动拖拽已开启：拖动任一时间轴会同步另一侧。"
              : coachLanguage === "en"
                ? "Linked scrub is OFF: timelines stay independent until you tap Enable Link."
                : "联动拖拽未开启：点击“开启联动”前，两侧时间轴互不联动。"}
          </Text>

          <View style={styles.segmentRow}>
            <Pressable
              style={[styles.segmentButton, segmentMode && styles.segmentButtonActive]}
              onPress={() => setSegmentMode((prev) => !prev)}
            >
              <Text style={styles.segmentButtonText}>
                {segmentMode
                  ? coachLanguage === "en"
                    ? "Eight-Count ON"
                    : "八拍分段：开"
                  : coachLanguage === "en"
                    ? "Eight-Count OFF"
                    : "八拍分段：关"}
              </Text>
            </Pressable>
            <Pressable
              style={[
                styles.segmentButton,
                (followInputMode !== "camera" || captureMode !== "live") && styles.segmentButtonDisabled,
              ]}
              onPress={recordLiveSegment}
            >
              <Text style={styles.segmentButtonText}>{coachLanguage === "en" ? "Record Segment" : "录制片段"}</Text>
            </Pressable>
          </View>

        </View>
      </View>

      <View style={styles.feedbackCard}>
        <View style={styles.workflowCard}>
          <Text style={styles.liveMetaText}>{coachLanguage === "en" ? "Analysis setup" : "分析设置"}</Text>
          <View style={styles.captureModeRow}>
            {([
              ["mock", coachLanguage === "en" ? "Mock Pose" : "模拟姿态"],
              ["live", coachLanguage === "en" ? "Live Pose (beta)" : "实时姿态（测试）"],
            ] as const).map(([mode, label]) => (
              <Pressable
                key={mode}
                style={[styles.modePill, captureMode === mode && styles.modePillActive]}
                onPress={() => {
                  setCaptureMode(mode);
                  setCapturedLiveFrames(null);
                  setFeedbackVisible(false);
                }}
              >
                <Text style={styles.modePillText}>{label}</Text>
              </Pressable>
            ))}
            <Text style={styles.liveMetaText}>{coachLanguage === "en" ? "Live frames" : "实时帧数"}: {lastLiveFrames}</Text>
          </View>
          <View style={styles.liveProgressTrack}>
            <View style={[styles.liveProgressFill, { width: `${Math.round(captureProgress * 100)}%` }]} />
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.segmentList}>
            {(segments.length ? segments : [[0, 1, 2, 3, 4, 5, 6, 7]]).map((segment, index) => (
              <Pressable
                key={`segment-${index}`}
                style={[styles.langPill, selectedSegment === index && styles.langPillActive]}
                onPress={() => setSelectedSegment(index)}
              >
                <Text style={styles.langPillText}>{coachLanguage === "en" ? `Seg ${index + 1}` : `第${index + 1}段`}</Text>
              </Pressable>
            ))}
          </ScrollView>
          {captureMode === "mock" ? (
            <>
              <Text style={styles.liveMetaText}>{coachLanguage === "en" ? "Mock scenario" : "模拟场景"}</Text>
              <View style={styles.scenarioRow}>
                {([
                  ["balanced", coachLanguage === "en" ? "Balanced" : "均衡"],
                  ["knee_in", coachLanguage === "en" ? "Knee Inward" : "膝内扣"],
                  ["wave_break", coachLanguage === "en" ? "Wave Break" : "波浪断点"],
                ] as const).map(([key, label]) => (
                  <Pressable
                    key={key}
                    style={[styles.modePill, scenario === key && styles.modePillActive]}
                    onPress={() => setScenario(key)}
                  >
                    <Text style={styles.modePillText}>{label}</Text>
                  </Pressable>
                ))}
              </View>
            </>
          ) : null}
        </View>

        <View style={styles.trainRow}>
          <Pressable style={[styles.trainButton, !canGenerateFeedback && styles.segmentButtonDisabled]} onPress={submitSegmentForAnalysis}>
            <Text style={styles.trainButtonText}>{coachLanguage === "en" ? "Generate Feedback" : "生成反馈"}</Text>
          </Pressable>
          <Pressable
            style={[styles.trainGhostButton, !movementResult && styles.segmentButtonDisabled]}
            onPress={() => {
              if (movementResult) {
                setFeedbackVisible(true);
                setShowResourcePanel(false);
              }
            }}
          >
            <Text style={styles.trainGhostText}>{coachLanguage === "en" ? "View Feedback" : "查看反馈"}</Text>
          </Pressable>
        </View>

        <View style={styles.workflowCard}>
          <Text style={styles.liveMetaText}>
            {coachLanguage === "en"
              ? `Status: ${
                  movementResult
                    ? "Feedback ready"
                    : followInputMode === "upload"
                      ? practiceVideoUri
                        ? "Ready to generate"
                        : "Upload practice video"
                      : captureMode === "live"
                        ? liveCaptureReady
                          ? "Recording complete"
                          : "Record segment first"
                        : "Ready to generate (mock mode)"
                }`
              : `状态：${
                  movementResult
                    ? "反馈已生成"
                    : followInputMode === "upload"
                      ? practiceVideoUri
                        ? "可生成反馈"
                        : "请先上传跟练视频"
                      : captureMode === "live"
                        ? liveCaptureReady
                          ? "录制完成，可生成"
                          : "请先录制片段"
                        : "可生成反馈（Mock模式）"
                }`}
          </Text>
          {!!liveHint && <Text style={styles.legalText}>{liveHint}</Text>}
          {!!lastPickerError && <Text style={styles.legalText}>Picker error: {lastPickerError}</Text>}
        </View>

        {isEvaluating ? (
          <View style={styles.hudRow}>
            <ActivityIndicator color="#F4EBDC" />
            <Text style={styles.hudText}>Evaluating motion...</Text>
          </View>
        ) : movementResult && feedbackVisible ? (
          <>
            <View style={styles.trainRow}>
              <Text style={styles.feedbackTitle}>
                {coachLanguage === "en" ? `Current 8-count: ${currentEightIndex + 1}` : `当前八拍：第 ${currentEightIndex + 1} 组`}
              </Text>
              <Pressable style={styles.trainGhostButton} onPress={replayCurrentSegment}>
                <Text style={styles.trainGhostText}>{coachLanguage === "en" ? "Sync Replay" : "同步回放"}</Text>
              </Pressable>
            </View>
            <Text style={styles.feedbackSummary}>
              {coachLanguage === "en"
                ? `Playing beat ${(currentBeatIndex % 8) + 1}/8 · Score ${movementResult.overallScore}`
                : `当前播放第 ${(currentBeatIndex % 8) + 1}/8 拍 · 总分 ${movementResult.overallScore}`}
            </Text>
            {followInputMode === "upload" ? (
              <Text style={styles.liveMetaText}>
                {coachLanguage === "en"
                  ? `Analysis target · teacher: ${selectedReferencePersonId ?? "auto"}, student: ${selectedPracticePersonId ?? "auto"}`
                  : `分析目标 · 老师: ${selectedReferencePersonId ?? "自动"}，学生: ${selectedPracticePersonId ?? "自动"}`}
              </Text>
            ) : null}

            <View style={styles.resourceCard}>
              <Text style={styles.proTitle}>{coachLanguage === "en" ? "What to fix now" : "当前八拍问题"}</Text>
              {currentEightCoachNotes.length ? (
                currentEightCoachNotes.map((line) => (
                  <Text key={line} style={styles.proText}>• {line}</Text>
                ))
              ) : (
                <Text style={styles.proText}>
                  {coachLanguage === "en"
                    ? "This 8-count looks stable. Keep shoulder-hip rhythm and maintain groove." 
                    : "当前八拍较稳定，继续保持肩胯节奏与律动。"}
                </Text>
              )}
            </View>

            <View style={styles.trainRow}>
              <Pressable style={styles.trainGhostButton} onPress={applyAutoAlign}>
                <Text style={styles.trainGhostText}>{coachLanguage === "en" ? "Auto Align" : "自动对齐"}</Text>
              </Pressable>
              <Pressable style={styles.trainGhostButton} onPress={() => setShowResourcePanel((prev) => !prev)}>
                <Text style={styles.trainGhostText}>{coachLanguage === "en" ? "Recommended Videos" : "推荐提升视频"}</Text>
              </Pressable>
            </View>

            {showResourcePanel ? (
              <View style={styles.resourceCard}>
                <Text style={styles.proTitle}>{coachLanguage === "en" ? "Practice Resources" : "练习资源"}</Text>
                {courseTemplate?.template?.resources?.slice(0, 4).map((resource) => (
                  <Pressable key={`${resource.url}-${resource.title}`} style={styles.resourceLink} onPress={() => openResource(resource.url)}>
                    <Text style={styles.resourceLinkText}>▶ {resource.title}</Text>
                  </Pressable>
                ))}
                {curatedVideos?.videos?.slice(0, 5).map((video) => (
                  <Pressable key={`${video.url}-${video.title}`} style={styles.resourceLink} onPress={() => openResource(video.url)}>
                    <Text style={styles.resourceLinkText}>▶ {video.title}</Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
          </>
        ) : (
          <Text style={styles.hudText}>
            {movementResult
              ? coachLanguage === "en"
                ? "Feedback is ready. Tap View Feedback when you want to review it."
                : "反馈已生成，点击“查看反馈”再展开。"
              : coachLanguage === "en"
                ? "Finish upload/recording, then tap Generate Feedback."
                : "请先完成上传或录制，再点击“生成反馈”。"}
          </Text>
        )}
      </View>
      <Modal
        transparent
        visible={personPickerVisible}
        animationType="fade"
        onRequestClose={() => closePersonPicker(null)}
      >
        <View style={styles.personPickerBackdrop}>
          <View style={styles.personPickerCard}>
            <Text style={styles.personPickerTitle}>
              {coachLanguage === "en"
                ? personPickerRole === "reference"
                  ? "Who is the teacher?"
                  : "Who is the student?"
                : personPickerRole === "reference"
                  ? "请选择老师"
                  : "请选择学生"}
            </Text>
            <Text style={styles.personPickerSubtitle}>
              {coachLanguage === "en"
                ? `Detected ${personPickerCandidates.length} people. Select analysis target.`
                : `检测到 ${personPickerCandidates.length} 人，请选择分析对象。`}
            </Text>
            <ScrollView style={styles.personPickerList}>
              {personPickerCandidates.map((candidate, index) => (
                <Pressable
                  key={candidate.id}
                  style={[styles.personPickerItem, personPickerSelectedId === candidate.id && styles.personPickerItemActive]}
                  onPress={() => setPersonPickerSelectedId(candidate.id)}
                >
                  <Text style={styles.personPickerItemText}>
                    {coachLanguage === "en"
                      ? `${personPickerRole === "reference" ? "Teacher" : "Student"} ${index + 1}`
                      : `${personPickerRole === "reference" ? "老师" : "学生"}${index + 1}`}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
            <View style={styles.personPickerActions}>
              <Pressable style={styles.trainGhostButton} onPress={() => closePersonPicker(null)}>
                <Text style={styles.trainGhostText}>{coachLanguage === "en" ? "Cancel" : "取消"}</Text>
              </Pressable>
              <Pressable
                style={styles.trainButton}
                onPress={() => closePersonPicker(personPickerSelectedId || personPickerCandidates[0]?.id || null)}
              >
                <Text style={styles.trainButtonText}>{coachLanguage === "en" ? "Confirm" : "确认"}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
      <Modal
        transparent
        visible={uploadSourcePickerVisible}
        animationType="fade"
        onRequestClose={closeUploadSourcePicker}
      >
        <View style={styles.personPickerBackdrop}>
          <View style={styles.uploadSourceCard}>
            <View style={styles.uploadSourceHeaderRow}>
              <View style={styles.uploadSourceBadge}>
                <Text style={styles.uploadSourceBadgeText}>{coachLanguage === "en" ? "Source" : "来源"}</Text>
              </View>
            </View>
            <Text style={styles.personPickerTitle}>
              {coachLanguage === "en" ? "Upload video from" : "选择上传来源"}
            </Text>
            <Text style={styles.personPickerSubtitle}>
              {coachLanguage === "en"
                ? `Choose source for ${uploadSourcePickerTarget === "reference" ? "reference" : "practice"} video.`
                : `请选择${uploadSourcePickerTarget === "reference" ? "参考" : "跟练"}视频来源。`}
            </Text>
            <View style={styles.uploadSourceList}>
              <Pressable style={styles.uploadSourceOption} onPress={chooseUploadFromAlbum}>
                <View style={styles.uploadSourceIconWrap}>
                  <Text style={styles.uploadSourceIcon}>◎</Text>
                </View>
                <View style={styles.uploadSourceCopy}>
                  <Text style={styles.personPickerItemText}>{coachLanguage === "en" ? "Album" : "相册"}</Text>
                  <Text style={styles.uploadSourceMeta}>
                    {coachLanguage === "en" ? "Recent videos and iPhone Photos" : "从系统相册选择最近视频"}
                  </Text>
                </View>
                <Text style={styles.uploadSourceChevron}>›</Text>
              </Pressable>
              <Pressable style={styles.uploadSourceOption} onPress={chooseUploadFromFiles}>
                <View style={styles.uploadSourceIconWrap}>
                  <Text style={styles.uploadSourceIcon}>▣</Text>
                </View>
                <View style={styles.uploadSourceCopy}>
                  <Text style={styles.personPickerItemText}>{coachLanguage === "en" ? "Files" : "文件"}</Text>
                  <Text style={styles.uploadSourceMeta}>
                    {coachLanguage === "en" ? "Local files, folders, and providers" : "从文件、本地文件夹或提供器选择"}
                  </Text>
                </View>
                <Text style={styles.uploadSourceChevron}>›</Text>
              </Pressable>
            </View>
            <View style={styles.uploadSourceFooter}>
              <Pressable style={styles.trainGhostButton} onPress={closeUploadSourcePicker}>
                <Text style={styles.trainGhostText}>{coachLanguage === "en" ? "Cancel" : "取消"}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#10141C", paddingHorizontal: 14, paddingTop: 12 },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  title: { color: "#F4EBDC", fontSize: 22, fontWeight: "700" },
  sectionLabel: { color: "#AEB8CB", fontSize: 11, fontWeight: "700", marginBottom: 4 },
  uploadButton: {
    backgroundColor: "#D9714C",
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  uploadButtonText: { color: "#0F1115", fontWeight: "700", fontSize: 13 },
  styleGrid: { flexDirection: "row", gap: 8, marginBottom: 8, flexWrap: "wrap" },
  langRow: { flexDirection: "row", gap: 8, marginBottom: 8 },
  langPill: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#4D5D7D",
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: "#22314A",
  },
  langPillActive: { borderColor: "#D9714C", backgroundColor: "#3C4C69" },
  langPillText: { color: "#E1D8C9", fontSize: 11, fontWeight: "700" },
  workspace: { flex: 1, flexDirection: "row", gap: 10 },
  panel: { flex: 1, borderRadius: 16, backgroundColor: "#1B2230", padding: 10 },
  panelHeaderRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  panelLabel: { color: "#F4EBDC", fontSize: 14, fontWeight: "700", marginBottom: 8 },
  speedControl: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "#283244",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginBottom: 8,
  },
  speedInlineWrap: {
    marginLeft: "auto",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#283244",
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  speedButton: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "#D9714C",
    alignItems: "center",
    justifyContent: "center",
  },
  speedButtonText: { color: "#0F1115", fontSize: 15, fontWeight: "700" },
  speedText: { color: "#F4EBDC", fontWeight: "700" },
  videoContainer: {
    flex: 1,
    borderRadius: 12,
    backgroundColor: "#111721",
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    minHeight: 220,
  },
  video: { width: "100%", height: "100%" },
  videoTapArea: { width: "100%", height: "100%" },
  cropViewport: { flex: 1, width: "100%", height: "100%", overflow: "hidden" },
  cropEditMask: { ...StyleSheet.absoluteFillObject },
  cropRect: {
    position: "absolute",
    borderWidth: 2,
    borderColor: "#FF4D4D",
    backgroundColor: "rgba(255, 77, 77, 0.08)",
  },
  cropMoveSurface: {
    ...StyleSheet.absoluteFillObject,
    left: 18,
    right: 18,
    top: 18,
    bottom: 18,
    zIndex: 2,
  },
  cropHandle: {
    position: "absolute",
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: "#FF4D4D",
    backgroundColor: "#FFF",
  },
  cropHandleTL: { left: -8, top: -8 },
  cropHandleTR: { right: -8, top: -8 },
  cropHandleBL: { left: -8, bottom: -8 },
  cropHandleBR: { right: -8, bottom: -8 },
  cropEdgeHandle: {
    position: "absolute",
    backgroundColor: "#FF4D4D",
    opacity: 0.5,
    zIndex: 4,
  },
  cropEdgeTop: { left: "24%", right: "24%", top: 0, height: 22, borderRadius: 10 },
  cropEdgeBottom: { left: "24%", right: "24%", bottom: 0, height: 22, borderRadius: 10 },
  cropEdgeLeft: { top: "24%", bottom: "24%", left: 0, width: 22, borderRadius: 10 },
  cropEdgeRight: { top: "24%", bottom: "24%", right: 0, width: 22, borderRadius: 10 },
  cropHintBadge: {
    position: "absolute",
    left: 4,
    top: 4,
    backgroundColor: "rgba(10, 12, 16, 0.7)",
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  cropHintText: { color: "#F4EBDC", fontSize: 10, fontWeight: "700" },
  personBox: {
    position: "absolute",
    borderWidth: 1,
    borderColor: "rgba(255, 77, 77, 0.55)",
    backgroundColor: "rgba(255, 77, 77, 0.08)",
  },
  personBoxSelected: { borderWidth: 2, borderColor: "#FF3B3B", backgroundColor: "rgba(255, 59, 59, 0.16)" },
  personTag: {
    position: "absolute",
    left: 2,
    top: 2,
    borderRadius: 6,
    backgroundColor: "#FF3B3B",
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  personTagText: { color: "#FFF", fontSize: 9, fontWeight: "700" },
  volumeAnchor: { position: "absolute", right: 8, bottom: 8, alignItems: "flex-end" },
  volumeBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: "rgba(16, 20, 28, 0.78)",
    borderWidth: 1,
    borderColor: "#48597A",
    alignItems: "center",
    justifyContent: "center",
  },
  volumeBtnText: { fontSize: 15 },
  volumePanel: {
    marginTop: 6,
    minWidth: 120,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#48597A",
    backgroundColor: "rgba(18, 24, 35, 0.96)",
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  volumeLabel: { color: "#E6DDCE", fontSize: 10, marginBottom: 2 },
  playOverlay: {
    position: "absolute",
    top: "50%",
    left: "50%",
    marginLeft: -22,
    marginTop: -22,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(16, 20, 28, 0.72)",
    alignItems: "center",
    justifyContent: "center",
  },
  playOverlayText: { color: "#F4EBDC", fontSize: 18, fontWeight: "700", marginLeft: 2 },
  timelineWrap: { marginTop: 4 },
  timeRow: { flexDirection: "row", justifyContent: "space-between", marginTop: -2 },
  timeText: { color: "#AEB8CB", fontSize: 10 },
  scrubPreviewCard: {
    marginTop: 6,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#445577",
    backgroundColor: "#1F2A3B",
    padding: 6,
  },
  scrubPreviewImage: { width: 72, height: 40, borderRadius: 6, backgroundColor: "#0F1115" },
  scrubPreviewText: { color: "#E6DDCE", fontSize: 11, fontWeight: "700" },
  placeholderText: { color: "#C1C7D6", textAlign: "center", fontSize: 13, paddingHorizontal: 12 },
  fileNameText: { color: "#8FA0BC", marginTop: 8, fontSize: 12 },
  cameraContainer: {
    flex: 1,
    borderRadius: 12,
    overflow: "hidden",
    backgroundColor: "#111721",
    minHeight: 220,
  },
  camera: { flex: 1 },
  permissionBox: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10, padding: 10 },
  permissionButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: "#D9714C",
  },
  permissionButtonText: { color: "#0F1115", fontWeight: "700" },
  segmentRow: { flexDirection: "row", gap: 8, marginTop: 8 },
  segmentButton: {
    flex: 1,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#3B4B67",
    paddingVertical: 8,
    alignItems: "center",
    backgroundColor: "#202A3A",
  },
  segmentButtonDisabled: { opacity: 0.45 },
  segmentButtonActive: { backgroundColor: "#2D3D59", borderColor: "#D9714C" },
  segmentButtonText: { color: "#E6DDCE", fontSize: 12, fontWeight: "600" },
  workflowCard: {
    marginTop: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#435879",
    backgroundColor: "#1C2536",
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  captureModeRow: { flexDirection: "row", gap: 8, marginTop: 8, alignItems: "center" },
  rateRow: { flexDirection: "row", gap: 8, marginTop: 8, alignItems: "center", flexWrap: "wrap" },
  rateInput: {
    minWidth: 62,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#536585",
    color: "#F4EBDC",
    backgroundColor: "#1B2435",
    fontSize: 12,
  },
  liveMetaText: { color: "#AEB8CB", fontSize: 11 },
  liveProgressTrack: {
    marginTop: 6,
    height: 6,
    borderRadius: 999,
    backgroundColor: "#2A3448",
    overflow: "hidden",
  },
  liveProgressFill: {
    height: "100%",
    backgroundColor: "#D9714C",
  },
  segmentList: { gap: 8, marginTop: 8 },
  scenarioRow: { flexDirection: "row", gap: 8, marginTop: 8 },
  modePill: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#48597A",
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: "#232E42",
  },
  modePillActive: { borderColor: "#D9714C" },
  modePillText: { color: "#E6DDCE", fontSize: 11 },
  personPickerBackdrop: {
    flex: 1,
    backgroundColor: "rgba(6, 8, 12, 0.68)",
    justifyContent: "center",
    paddingHorizontal: 22,
  },
  personPickerCard: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#435879",
    backgroundColor: "#1B2536",
    padding: 12,
    maxHeight: "72%",
  },
  personPickerTitle: { color: "#F4EBDC", fontSize: 16, fontWeight: "700" },
  personPickerSubtitle: { color: "#AEB8CB", fontSize: 12, marginTop: 4 },
  personPickerList: { marginTop: 10 },
  uploadSourceCard: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#4A5D7D",
    backgroundColor: "#192231",
    padding: 14,
    maxHeight: "72%",
    shadowColor: "#000",
    shadowOpacity: 0.22,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 12 },
  },
  uploadSourceHeaderRow: { flexDirection: "row", marginBottom: 8 },
  uploadSourceBadge: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#7D5A49",
    backgroundColor: "#352923",
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  uploadSourceBadgeText: { color: "#F1C8B6", fontSize: 10, fontWeight: "700", letterSpacing: 0.3 },
  uploadSourceList: { marginTop: 12, gap: 10 },
  uploadSourceOption: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#46597A",
    backgroundColor: "#223047",
    paddingVertical: 12,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  uploadSourceIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: "#31261F",
    borderWidth: 1,
    borderColor: "#7B5B4A",
    alignItems: "center",
    justifyContent: "center",
  },
  uploadSourceIcon: { color: "#F1C8B6", fontSize: 16, fontWeight: "700" },
  uploadSourceCopy: { flex: 1 },
  uploadSourceMeta: { color: "#9FB0CB", fontSize: 11, marginTop: 2 },
  uploadSourceChevron: { color: "#F1C8B6", fontSize: 24, lineHeight: 24 },
  uploadSourceFooter: { marginTop: 12, alignItems: "flex-end" },
  personPickerItem: {
    borderWidth: 1,
    borderColor: "#4D5F80",
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: "#202C40",
    marginBottom: 8,
  },
  personPickerItemActive: { borderColor: "#D9714C", backgroundColor: "#2D3D59" },
  personPickerItemText: { color: "#E6DDCE", fontSize: 13, fontWeight: "600" },
  personPickerActions: { marginTop: 6, flexDirection: "row", gap: 8 },
  beatHudInline: {
    marginTop: 8,
    backgroundColor: "rgba(12, 14, 20, 0.86)",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: "#3A465D",
    minHeight: 54,
  },
  hudRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  hudText: { color: "#F4EBDC", fontWeight: "700", fontSize: 13 },
  hudSubText: { color: "#B0BBD1", fontSize: 11, marginTop: 2 },
  feedbackCard: {
    marginTop: 10,
    borderRadius: 14,
    backgroundColor: "#151C28",
    borderWidth: 1,
    borderColor: "#39465D",
    padding: 10,
    marginBottom: 10,
  },
  feedbackTitle: { color: "#F4EBDC", fontSize: 14, fontWeight: "700" },
  feedbackSummary: { color: "#C7D1E4", fontSize: 12, marginTop: 4 },
  feedbackFocus: { color: "#9FB0CB", fontSize: 11, marginTop: 4 },
  trainRow: { marginTop: 8, flexDirection: "row", gap: 8 },
  abSettingsRow: {
    marginTop: 6,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flexWrap: "wrap",
  },
  miniPill: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#5D7092",
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: "#2A3853",
  },
  miniPillActive: {
    borderColor: "#D9714C",
    backgroundColor: "#3C4F70",
  },
  recoPill: {
    borderColor: "#D9714C",
    backgroundColor: "#3B2D27",
  },
  miniPillText: {
    color: "#E8F0FF",
    fontSize: 10,
    fontWeight: "700",
  },
  trainButton: {
    flex: 1,
    borderRadius: 10,
    backgroundColor: "#D9714C",
    paddingVertical: 8,
    alignItems: "center",
  },
  trainButtonText: { color: "#0F1115", fontWeight: "700", fontSize: 12 },
  trainGhostButton: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#536585",
    paddingHorizontal: 12,
    justifyContent: "center",
    alignItems: "center",
  },
  trainGhostText: { color: "#D7DFEE", fontWeight: "700", fontSize: 12 },
  trainStatusCard: {
    marginTop: 8,
    borderRadius: 10,
    padding: 8,
    borderWidth: 1,
    borderColor: "#4A5C7B",
    backgroundColor: "#24334D",
  },
  resourceCard: {
    marginTop: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#4F6284",
    backgroundColor: "#1E2A40",
    padding: 8,
  },
  resourceLink: {
    marginTop: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#5F7398",
    paddingHorizontal: 8,
    paddingVertical: 6,
    backgroundColor: "#2A3856",
  },
  resourceLinkText: {
    color: "#EAF1FF",
    fontSize: 11,
    fontWeight: "700",
  },
  curatedItem: {
    marginTop: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#5A6D8F",
    backgroundColor: "#273654",
    padding: 8,
  },
  curatedActions: {
    marginTop: 6,
    flexDirection: "row",
    gap: 6,
  },
  tinyBtn: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#6E83A9",
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: "#30415F",
  },
  tinyBtnText: {
    color: "#E6EEFF",
    fontSize: 10,
    fontWeight: "700",
  },
  legalText: {
    color: "#AEB9CC",
    fontSize: 10,
    marginTop: 6,
  },
  timingBarRow: {
    marginTop: 8,
    flexDirection: "row",
    gap: 4,
    alignItems: "center",
  },
  timingMarker: {
    flex: 1,
    height: 10,
    borderRadius: 3,
    alignItems: "center",
    justifyContent: "center",
  },
  timingBeatLabel: {
    color: "#F6FBFF",
    fontSize: 9,
    fontWeight: "700",
  },
  timingMarkerStable: {
    backgroundColor: "#6FC2E7",
  },
  timingMarkerAlert: {
    backgroundColor: "#E55252",
  },
  timingMarkerUnknown: {
    backgroundColor: "#6E7585",
  },
  timingMarkerHigh: {
    height: 14,
  },
  phaseRow: {
    marginTop: 6,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  phaseBeatLabel: {
    color: "#D8E1F0",
    fontSize: 11,
    width: 44,
  },
  phaseCell: {
    width: 32,
    height: 18,
    borderRadius: 4,
    alignItems: "center",
    justifyContent: "center",
  },
  phaseCellText: {
    color: "#0C1017",
    fontSize: 10,
    fontWeight: "700",
  },
  phaseDeltaText: {
    color: "#CFD8E8",
    fontSize: 10,
    marginLeft: 4,
  },
  metricGrid: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 },
  metricPill: {
    backgroundColor: "#26324A",
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 6,
    minWidth: 104,
  },
  metricName: { color: "#A8B5CC", fontSize: 10 },
  metricValue: { color: "#F4EBDC", fontWeight: "700", fontSize: 14 },
  issueHeaderRow: {
    marginTop: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  issueCard: {
    marginTop: 8,
    backgroundColor: "#202A3A",
    borderRadius: 10,
    padding: 8,
    borderWidth: 1,
    borderColor: "#3B4A63",
  },
  issueTitle: { color: "#F4EBDC", fontWeight: "700", fontSize: 12, marginBottom: 2 },
  issueText: { color: "#C4CEDF", fontSize: 11, marginTop: 2 },
  proCard: {
    marginTop: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#5D6F8E",
    backgroundColor: "#202B3F",
    padding: 8,
  },
  proTitle: { color: "#F8EEDB", fontSize: 12, fontWeight: "700" },
  proSection: { color: "#C9D8F2", fontSize: 11, fontWeight: "700", marginTop: 6 },
  proText: { color: "#D6DEEE", fontSize: 11, marginTop: 2 },
  proBlock: {
    marginTop: 4,
    padding: 6,
    borderRadius: 8,
    backgroundColor: "#2A3550",
  },
  realtimeTitle: { color: "#F4EBDC", fontWeight: "700", fontSize: 12, marginTop: 10 },
  trendRow: {
    marginTop: 6,
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 4,
    minHeight: 54,
  },
  trendBarWrap: {
    flex: 1,
    height: 54,
    justifyContent: "flex-end",
    backgroundColor: "#1F293B",
    borderRadius: 4,
    overflow: "hidden",
  },
  trendBar: {
    width: "100%",
    backgroundColor: "#6FC2E7",
  },
});
