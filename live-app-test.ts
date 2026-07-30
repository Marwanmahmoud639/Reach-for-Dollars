import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config();

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY! // use service_role if available, else anon
);

async function runTest() {
  console.log("Testing live connection...");
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError) {
    console.log("Not logged in. Looking for a test team...");
    const { data: teams } = await supabase.from("teams").select("*").limit(1);
    console.log("Found teams:", teams?.length);
    if (!teams?.length) return console.log("No teams found. Cannot run live test without a team/user.");
    
    // Check if we can insert a dummy campaign using the service key (we don't have service key)
    // We only have ANON KEY! We cannot bypass RLS without service key or logging in.
    console.log("We only have ANON key. We cannot bypass RLS without user login credentials.");
  }
}
runTest();
