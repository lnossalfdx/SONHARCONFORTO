import 'dotenv/config'

const requiredVars = ['DATABASE_URL', 'JWT_SECRET'] as const

for (const variable of requiredVars) {
  if (!process.env[variable]) {
    throw new Error(`Missing environment variable: ${variable}`)
  }
}

export const env = {
  port: Number(process.env.PORT ?? 3333),
  databaseUrl: process.env.DATABASE_URL!,
  jwtSecret: process.env.JWT_SECRET!,
}
