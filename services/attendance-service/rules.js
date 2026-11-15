// The attendance rules. These are plain functions with no database access,
// so they are easy to test (see test/punch.test.js).

// Turns "09:30:00" (or "09:30:00.123456" from PostgreSQL) into seconds.
function timeToSeconds(value) {
  const [hours, minutes, seconds] = value.split(":").map(Number);
  return hours * 3600 + minutes * 60 + Math.floor(seconds);
}

// Decides what a punch means:
//   entry gate -> check in      exit gate -> check out
//   "both" gate -> check in if outside, check out if inside
// Returns null when it makes no sense (entering while already inside,
// or leaving while already outside).
function decideAction(direction, presence) {
  if (direction === "entry") {
    return presence === "outside" ? "check_in" : null;
  }
  if (direction === "exit") {
    return presence === "inside" ? "check_out" : null;
  }
  return presence === "inside" ? "check_out" : "check_in";
}

// Only the first check-in of a working day is judged.
// It is late when it comes more than grace_minutes after work_start, and the
// lateness is counted from work_start (09:25 with a 09:00 start = 25 min late).
// Coming back later in the day (after lunch) is "normal".
//
// ponytail: assumes work_start < work_end on the same day; overnight shifts
// are not supported for lateness or early-leave.
function checkInStatus({ localTime, workStart, graceMinutes, workingDay, firstToday }) {
  if (!firstToday) {
    return { status: "normal", late_by_minutes: 0 };
  }

  const secondsLate = timeToSeconds(localTime) - timeToSeconds(workStart);

  if (workingDay && secondsLate > graceMinutes * 60) {
    return { status: "late", late_by_minutes: Math.floor(secondsLate / 60) };
  }

  return { status: "on_time", late_by_minutes: 0 };
}

// Leaving before work_end on a working day is an early leave.
function checkOutStatus({ localTime, workEnd, workingDay }) {
  if (workingDay && timeToSeconds(localTime) < timeToSeconds(workEnd)) {
    return "early_leave";
  }
  return "normal";
}

module.exports = { decideAction, checkInStatus, checkOutStatus };
