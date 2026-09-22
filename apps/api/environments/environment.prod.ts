export function environment() {
  return {
    app: {
      hostUrl: process.env.FRONTEND_APP_URL,
      environment: 'production',
    },
    postgres: {
      type: 'postgres' as const,
      host: process.env.DB_HOST,
      port: process.env.DB_PORT,
      username: process.env.DB_USERNAME,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_DATABASE,
      autoLoadEntities: true,
      // Production never auto-synchronises the schema — migrations only.
      synchronize: false,
      logging: false,
      ssl: { rejectUnauthorized: false },
    },
    jwt: {
      secret: process.env.JWT_SECRET,
      expiresIn: '7d',
    },
    sendgrid: {
      apiKey: process.env.SENDGRID_API_KEY,
      fromEmail: process.env.SENDGRID_FROM_EMAIL,
    },
  };
}
