// Copies the three face-api models the app uses into public/models.
// They are large binaries, so they are copied from node_modules instead
// of being committed.
import { mkdirSync, copyFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const from = "node_modules/@vladmandic/face-api/model";
const to = "public/models";
const models = ["tiny_face_detector_model", "face_landmark_68_model", "face_recognition_model"];

mkdirSync(to, { recursive: true });
for (const model of models) {
  for (const file of [`${model}-weights_manifest.json`, `${model}.bin`]) {
    if (!existsSync(join(to, file))) copyFileSync(join(from, file), join(to, file));
  }
}
console.log("face-api models ready in public/models");
