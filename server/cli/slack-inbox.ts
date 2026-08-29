import { getDb } from "../db";
import { getFailedSlackEvents } from "../slack/inbox";

const requestedLimit = Number(process.argv[2]);
const limit = Number.isInteger(requestedLimit) ? requestedLimit : 50;
const failedEvents = getFailedSlackEvents(getDb(), limit);

console.log(JSON.stringify({ failedEvents }, null, 2));
