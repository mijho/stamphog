import { getDb } from "../db";
import { resetDatabase } from "../seed";

resetDatabase(getDb());
console.log("database emptied");
