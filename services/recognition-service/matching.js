// Face descriptors and how a match is decided.
//
// The browser (face-api) turns a face into a descriptor: a list of 128
// numbers. Photos of the same person give descriptors that are close to
// each other; different people are far apart. "Distance" is the straight-line
// (Euclidean / L2) distance between two descriptors: 0 means identical.
const { fail } = require("./helpers");

const DESCRIPTOR_LENGTH = 128;

// Checks one descriptor. face-api values are small, so anything above 10 is
// clearly not a real descriptor.
function readDescriptor(value, name = "descriptor") {
  if (
    !Array.isArray(value) ||
    value.length !== DESCRIPTOR_LENGTH ||
    value.some((n) => typeof n !== "number" || !Number.isFinite(n) || Math.abs(n) > 10)
  ) {
    fail(400, `${name} must be an array of ${DESCRIPTOR_LENGTH} finite numbers.`);
  }
  return value;
}

// pgvector reads a vector written as text, e.g. "[0.1,-0.2,0.3]".
function toVector(descriptor) {
  return `[${descriptor.join(",")}]`;
}

// candidates: the two nearest employees, closest first: [{ employee_id, distance }].
//
// A face is a match only when:
//   1. the closest employee is within the threshold (default 0.5), and
//   2. they are clearly closer than the second closest employee (by the
//      margin, default 0.05). If two people are almost equally close we
//      cannot be sure, so it is "ambiguous" and nothing is recorded.
function decideMatch(candidates, threshold, margin) {
  const [best, second] = candidates;

  if (!best) {
    return { matched: false, reason: "no_enrolled_faces" };
  }
  if (best.distance > threshold) {
    return { matched: false, reason: "no_match", distance: best.distance };
  }
  if (second && second.distance - best.distance < margin) {
    return { matched: false, reason: "ambiguous", distance: best.distance };
  }
  return { matched: true, employee_id: best.employee_id, distance: best.distance };
}

module.exports = { readDescriptor, toVector, decideMatch };
