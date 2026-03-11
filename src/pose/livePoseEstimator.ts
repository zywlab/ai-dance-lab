import * as FileSystem from "expo-file-system";
import type { PoseFrame } from "../mockMotion";

type DetectorHandle = {
  estimatePoses: (input: unknown, config?: unknown) => Promise<Array<{ keypoints?: Array<{ x: number; y: number; name?: string; score?: number }> }>>;
};

export type DetectedPersonBox = { x: number; y: number; w: number; h: number; score: number };

let tfModule: typeof import("@tensorflow/tfjs") | null = null;
let tfReactNative: typeof import("@tensorflow/tfjs-react-native") | null = null;
let poseDetection: typeof import("@tensorflow-models/pose-detection") | null = null;
let detector: DetectorHandle | null = null;
let multiDetector: DetectorHandle | null = null;

const MOVENET_KEYPOINTS = [
  "nose",
  "left_eye",
  "right_eye",
  "left_ear",
  "right_ear",
  "left_shoulder",
  "right_shoulder",
  "left_elbow",
  "right_elbow",
  "left_wrist",
  "right_wrist",
  "left_hip",
  "right_hip",
  "left_knee",
  "right_knee",
  "left_ankle",
  "right_ankle",
];

function inferName(index: number, explicit?: string): string {
  return explicit || MOVENET_KEYPOINTS[index] || `kp_${index}`;
}

async function getDetector(): Promise<DetectorHandle> {
  if (detector) return detector;

  tfModule = await import("@tensorflow/tfjs");
  tfReactNative = await import("@tensorflow/tfjs-react-native");
  poseDetection = await import("@tensorflow-models/pose-detection");

  await tfModule.ready();

  if (tfModule.getBackend() !== "rn-webgl") {
    await tfModule.setBackend("rn-webgl");
  }

  detector = (await poseDetection.createDetector(
    poseDetection.SupportedModels.MoveNet,
    {
      modelType: poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING,
      enableSmoothing: true,
    },
  )) as DetectorHandle;

  return detector;
}

async function getMultiDetector(): Promise<DetectorHandle> {
  if (multiDetector) return multiDetector;

  tfModule = await import("@tensorflow/tfjs");
  tfReactNative = await import("@tensorflow/tfjs-react-native");
  poseDetection = await import("@tensorflow-models/pose-detection");

  await tfModule.ready();

  if (tfModule.getBackend() !== "rn-webgl") {
    await tfModule.setBackend("rn-webgl");
  }

  multiDetector = (await poseDetection.createDetector(
    poseDetection.SupportedModels.MoveNet,
    {
      modelType: poseDetection.movenet.modelType.MULTIPOSE_LIGHTNING,
      enableSmoothing: true,
    },
  )) as DetectorHandle;

  return multiDetector;
}

export async function detectPeopleBoxesFromImage(imageUri: string): Promise<DetectedPersonBox[]> {
  try {
    const det = await getMultiDetector();
    if (!tfModule || !tfReactNative) return [];

    const base64 = await FileSystem.readAsStringAsync(imageUri, {
      encoding: "base64" as any,
    });
    const imageBuffer = tfModule.util.encodeString(base64, "base64").buffer;
    const raw = new Uint8Array(imageBuffer);
    const tensor = tfReactNative.decodeJpeg(raw);

    const imageHeight = Number(tensor.shape?.[0] || 1);
    const imageWidth = Number(tensor.shape?.[1] || 1);

    let poses = await det.estimatePoses(tensor, { maxPoses: 6 });
    if (!poses.length) {
      poses = await det.estimatePoses(tensor, { maxPoses: 6 });
    }

    if (!poses.length) {
      const single = await getDetector();
      poses = await single.estimatePoses(tensor);
    }
    tensor.dispose();

    const boxes: DetectedPersonBox[] = [];
    poses.forEach((pose) => {
      const keypoints = (pose.keypoints || []).filter((kp) => (kp.score || 0) > 0.12);
      if (keypoints.length < 3) return;

      const xs = keypoints.map((kp) => kp.x);
      const ys = keypoints.map((kp) => kp.y);

      const minX = Math.max(0, Math.min(...xs) / imageWidth);
      const minY = Math.max(0, Math.min(...ys) / imageHeight);
      const maxX = Math.min(1, Math.max(...xs) / imageWidth);
      const maxY = Math.min(1, Math.max(...ys) / imageHeight);
      const boxW = Math.max(0, maxX - minX);
      const boxH = Math.max(0, maxY - minY);

      if (boxW < 0.05 || boxH < 0.08) return;

      const avgScore = keypoints.reduce((sum, kp) => sum + (kp.score || 0), 0) / keypoints.length;
      boxes.push({ x: Number(minX.toFixed(4)), y: Number(minY.toFixed(4)), w: Number(boxW.toFixed(4)), h: Number(boxH.toFixed(4)), score: Number(avgScore.toFixed(4)) });
    });

    boxes.sort((a, b) => b.score - a.score);
    return boxes.slice(0, 4);
  } catch {
    return [];
  }
}

export async function estimatePoseFrameFromImage(imageUri: string, timestampSec: number): Promise<PoseFrame | null> {
  try {
    const det = await getDetector();
    if (!tfModule || !tfReactNative) return null;

    const base64 = await FileSystem.readAsStringAsync(imageUri, {
      encoding: "base64" as any,
    });
    const imageBuffer = tfModule.util.encodeString(base64, "base64").buffer;
    const raw = new Uint8Array(imageBuffer);
    const tensor = tfReactNative.decodeJpeg(raw);

    const poses = await det.estimatePoses(tensor);
    tensor.dispose();

    if (!poses.length || !poses[0].keypoints?.length) return null;

    const keypoints: Record<string, { x: number; y: number; c: number }> = {};
    poses[0].keypoints.forEach((kp, index) => {
      const name = inferName(index, kp.name);
      keypoints[name] = {
        x: Number(kp.x.toFixed(4)),
        y: Number(kp.y.toFixed(4)),
        c: Number((kp.score || 0).toFixed(4)),
      };
    });

    return {
      t: Number(timestampSec.toFixed(3)),
      keypoints,
    };
  } catch {
    return null;
  }
}
