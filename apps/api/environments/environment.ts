export function environment() {
  return {
    app: {
      hostUrl: process.env.FRONTEND_APP_URL || 'http://localhost:4200',
      environment: 'development',
    },
    postgres: {
      type: 'postgres' as const,
      host: process.env.DB_HOST,
      port: process.env.DB_PORT,
      username: process.env.DB_USERNAME,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_DATABASE,
      autoLoadEntities: true,
      // Dev convenience only — schema is generated from entities. Switch to
      // migrations before this ever points at a staging/production database.
      synchronize: true,
      logging: true,
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
