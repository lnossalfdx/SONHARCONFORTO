import 'dotenv/config'

const requiredVars = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_ANON_KEY'] as const

for (const variable of requiredVars) {
  if (!process.env[variable]) {
    throw new Error(`Missing environment variable: ${variable}`)
  }
}

export const env = {
  port: Number(process.env.PORT ?? 3333),
  supabaseUrl: process.env.SUPABASE_URL!,
  supabaseServiceKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY!,
}
