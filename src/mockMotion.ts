type Point = { x: number; y: number; c?: number };

export type PoseFrame = {
  t: number;
  keypoints: Record<string, Point>;
};

type Scenario = "balanced" | "knee_in" | "wave_break";

const basePose = {
  nose: { x: 0.5, y: 0.16 },
  left_shoulder: { x: 0.44, y: 0.24 },
  right_shoulder: { x: 0.56, y: 0.24 },
  left_elbow: { x: 0.4, y: 0.34 },
  right_elbow: { x: 0.6, y: 0.34 },
  left_wrist: { x: 0.37, y: 0.43 },
  right_wrist: { x: 0.63, y: 0.43 },
  left_hip: { x: 0.46, y: 0.46 },
  right_hip: { x: 0.54, y: 0.46 },
  left_knee: { x: 0.45, y: 0.62 },
  right_knee: { x: 0.55, y: 0.62 },
  left_ankle: { x: 0.44, y: 0.82 },
  right_ankle: { x: 0.56, y: 0.82 },
  left_heel: { x: 0.43, y: 0.86 },
  right_heel: { x: 0.57, y: 0.86 },
  left_foot_index: { x: 0.46, y: 0.86 },
  right_foot_index: { x: 0.54, y: 0.86 },
};

function clonePose() {
  return JSON.parse(JSON.stringify(basePose));
}

function makeFrame(time: number, beatPhase: number, scenario: Scenario, isReference: boolean): PoseFrame {
  const p = clonePose();
  const sway = Math.sin(beatPhase * Math.PI * 2) * 0.015;
  const lift = Math.max(0, Math.sin(beatPhase * Math.PI * 2)) * 0.03;

  p.left_wrist.x -= sway;
  p.right_wrist.x += sway;
  p.left_wrist.y -= lift;
  p.right_wrist.y -= lift;

  p.left_elbow.x -= sway * 0.7;
  p.right_elbow.x += sway * 0.7;

  if (!isReference) {
    if (scenario === "knee_in") {
      p.left_knee.x += 0.025;
      p.right_knee.x -= 0.025;
      p.left_foot_index.x -= 0.015;
      p.right_foot_index.x += 0.015;
    }

    if (scenario === "wave_break") {
      p.right_shoulder.x += sway * 0.2;
      p.right_elbow.x += sway * 0.1;
      p.right_wrist.x += sway * 0.05;
    }

    if (scenario === "balanced") {
      p.left_wrist.y += 0.004;
      p.right_wrist.y += 0.004;
    }
  }

  return {
    t: time,
    keypoints: p,
  };
}

export function buildMockEvaluationPayload(
  segmentBeats: number,
  tempo: number,
  scenario: Scenario,
): {
  referenceFrames: PoseFrame[];
  userFrames: PoseFrame[];
  beatTimes: number[];
} {
  const beatDuration = 60 / tempo;
  const framesPerBeat = 6;
  const totalFrames = Math.max(24, segmentBeats * framesPerBeat);
  const duration = segmentBeats * beatDuration;

  const beatTimes = Array.from({ length: segmentBeats }, (_, i) => Number((i * beatDuration).toFixed(3)));

  const referenceFrames: PoseFrame[] = [];
  const userFrames: PoseFrame[] = [];

  for (let i = 0; i < totalFrames; i += 1) {
    const t = (i / (totalFrames - 1)) * duration;
    const phase = (t / beatDuration) % 1;
    referenceFrames.push(makeFrame(Number(t.toFixed(3)), phase, scenario, true));
    userFrames.push(makeFrame(Number(t.toFixed(3)), phase, scenario, false));
  }

  return {
    referenceFrames,
    userFrames,
    beatTimes,
  };
}

export type EvaluationScenario = Scenario;
