import {loadEnvConfig} from "@next/env";
async function migrate(){loadEnvConfig(process.cwd());const {ensureDatabase,db}=await import("../lib/db");await ensureDatabase();await db.close();console.log("ODESVIA database schema is ready.")}migrate().catch(error=>{console.error(error instanceof Error?error.message:"Migration failed");process.exit(1)});
