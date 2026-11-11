import assert from "node:assert/strict";
import { addBusinessDays, businessDayRange, closedBusinessDate, dateDistanceInDays, dateKeyInTimezone, safeTimezone } from "../server/date-time.js";

const boundary = new Date("2026-11-10T17:30:00.000Z");
assert.equal(dateKeyInTimezone(boundary, "Asia/Shanghai"), "2026-11-11");
assert.equal(dateKeyInTimezone(boundary, "Europe/Moscow"), "2026-11-10");
assert.equal(dateKeyInTimezone(boundary, "Asia/Jakarta"), "2026-11-11");
assert.equal(closedBusinessDate(boundary, "Asia/Shanghai"), "2026-11-10");
assert.equal(addBusinessDays("2026-03-01", -1), "2026-02-28");
assert.deepEqual(businessDayRange("2026-11-11"), { from: "2026-11-11 00:00:00", to: "2026-11-11 23:59:59" });
assert.equal(dateDistanceInDays("2026-10-10", "2026-10-31"), 21);
assert.equal(safeTimezone("Not/A_Timezone", "Asia/Shanghai"), "Asia/Shanghai");

console.log("business date tests passed");
