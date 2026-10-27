import {ensureDatabase,db} from "../lib/db";
async function migrate(){await ensureDatabase();await db.close();console.log("ODESVIA database schema is ready.")}migrate().catch(error=>{console.error(error);process.exit(1)});
