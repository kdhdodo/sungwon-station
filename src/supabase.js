import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(
  "https://djnsbwsguqirskimukxh.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRqbnNid3NndXFpcnNraW11a3hoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM1Njg3MzEsImV4cCI6MjA4OTE0NDczMX0.PkHZQsAUVzOj6c6NaEgvyfPcF6e1m7JbnNTta7ZaNjQ"
);
