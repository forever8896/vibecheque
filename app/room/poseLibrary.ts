// Pose-matching library. A target pose is defined by a unit vector per
// "bone" (parent→child MediaPipe landmark pair). Scoring compares the
// player's current bone vectors to the target via cosine similarity.

// MediaPipe pose landmark indices:
//   11 left shoulder   12 right shoulder
//   13 left elbow      14 right elbow
//   15 left wrist      16 right wrist
//   23 left hip        24 right hip
//   25 left knee       26 right knee
//   27 left ankle      28 right ankle
// Note: "left/right" follows MediaPipe's person-perspective labels. In a
// front-facing camera, the *person's* left appears on the *right* side of
// the frame.

export type Bone = { from: number; to: number };

export const BONES: Bone[] = [
  { from: 11, to: 13 }, // person's left upper arm
  { from: 13, to: 15 }, // person's left forearm
  { from: 12, to: 14 }, // person's right upper arm
  { from: 14, to: 16 }, // person's right forearm
  { from: 23, to: 25 }, // left thigh
  { from: 25, to: 27 }, // left shin
  { from: 24, to: 26 }, // right thigh
  { from: 26, to: 28 }, // right shin
];

// Unit vectors in camera / MediaPipe coords (+y = down, +x = right).
const UP = [0, -1] as const;
const DOWN = [0, 1] as const;
const RIGHT = [1, 0] as const;
const LEFT = [-1, 0] as const;
const UP_RIGHT = [0.7071, -0.7071] as const;
const UP_LEFT = [-0.7071, -0.7071] as const;
const DOWN_RIGHT = [0.7071, 0.7071] as const;
const DOWN_LEFT = [-0.7071, 0.7071] as const;

export type BoneVec = readonly [number, number];

export type PoseTarget = {
  name: string;
  label: string; // shown to the player above the ghost
  vectors: readonly BoneVec[]; // indexed by BONES[i]
};

// Remember: "left arm bones" (0, 1) are the *person's* left arm which
// lives on camera-right in the raw video. They look mirrored-correctly to
// the player because the tile is CSS-mirrored.
export const POSE_LIBRARY: PoseTarget[] = [
  {
    name: "T_POSE",
    label: "T-POSE",
    vectors: [RIGHT, RIGHT, LEFT, LEFT, DOWN, DOWN, DOWN, DOWN],
  },
  {
    name: "ARMS_UP",
    label: "TOUCH THE SKY",
    vectors: [UP, UP, UP, UP, DOWN, DOWN, DOWN, DOWN],
  },
  {
    name: "STAR",
    label: "BE A STAR",
    vectors: [
      UP_RIGHT,
      UP_RIGHT,
      UP_LEFT,
      UP_LEFT,
      DOWN_LEFT,
      DOWN_LEFT,
      DOWN_RIGHT,
      DOWN_RIGHT,
    ],
  },
  {
    name: "PERSON_LEFT_UP",
    label: "RAISE YOUR LEFT",
    vectors: [UP, UP, DOWN, DOWN, DOWN, DOWN, DOWN, DOWN],
  },
  {
    name: "PERSON_RIGHT_UP",
    label: "RAISE YOUR RIGHT",
    vectors: [DOWN, DOWN, UP, UP, DOWN, DOWN, DOWN, DOWN],
  },
  {
    name: "DISCO",
    label: "DISCO POINT",
    vectors: [
      UP_RIGHT,
      UP_RIGHT,
      DOWN_LEFT,
      DOWN_LEFT,
      DOWN,
      DOWN,
      DOWN,
      DOWN,
    ],
  },
  {
    name: "REVERSE_DISCO",
    label: "DISCO POINT",
    vectors: [
      DOWN_LEFT,
      DOWN_LEFT,
      UP_RIGHT,
      UP_RIGHT,
      DOWN,
      DOWN,
      DOWN,
      DOWN,
    ],
  },
  {
    name: "MUSCLEMAN",
    label: "FLEX",
    vectors: [RIGHT, UP_RIGHT, LEFT, UP_LEFT, DOWN, DOWN, DOWN, DOWN],
  },
];
