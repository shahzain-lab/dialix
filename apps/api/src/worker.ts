import "dotenv/config";
import { startWorker } from "./queue.js";

startWorker();
console.log("Dialix worker started");
