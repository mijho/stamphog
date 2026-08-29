import { getDb } from "../db";
import { seedTestData } from "../seed";

const result = seedTestData(getDb(), {
  resetExistingData: process.argv.includes("--reset"),
});
console.log(JSON.stringify(result, null, 2));
