import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { CsrfMiddleware } from './common/middleware/csrf.middleware';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { MonitoringInterceptor } from './common/interceptors/monitoring.interceptor';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { parseCorsOrigins } from './config/app.config';

// Security headers middleware
function addSecurityHeaders(req, res, next) {
  // HSTS (HTTP Strict Transport Security)
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');

  // X-Frame-Options to prevent clickjacking
  res.setHeader('X-Frame-Options', 'DENY');

  // X-Content-Type-Options to prevent MIME-type sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff');

  // Content Security Policy
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; " +
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://apis.google.com https://www.gstatic.com; " +
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
      "font-src 'self' https://fonts.gstatic.com; " +
      "img-src 'self' data: https:; " +
      "connect-src 'self' https://api.stellar.org https://horizon-testnet.stellar.org; " +
      "frame-ancestors 'none'; " +
      "base-uri 'self'; " +
      "form-action 'self';"
  );

  // Additional security headers
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');

  next();
}

/**
 * Applies the same global configuration used by the production bootstrap
 * (see `src/main.ts`): URL prefix + URI versioning, security headers,
 * cookie parsing (required by the CSRF middleware), the CSRF middleware itself,
 * validation pipes, exception filter, interceptors and CORS.
 *
 * Extracted so tests can boot the application exactly the way `main.ts` does.
 */
export function configureApp(app: INestApplication): void {
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI });

  // Apply security headers middleware
  app.use(addSecurityHeaders);

  // Parse cookies before the CSRF middleware reads them (Express 5 does not
  // populate req.cookies on its own — without this the CSRF middleware crashes
  // on every request with `Cannot read properties of undefined`).
  app.use(cookieParser());

  // Apply CSRF middleware
  const csrfMiddleware = new CsrfMiddleware();
  app.use((req, res, next) => csrfMiddleware.use(req, res, next));

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    })
  );

  // Global exception filter
  app.useGlobalFilters(new GlobalExceptionFilter());

  // Global logging interceptor
  const loggingInterceptor = app.get(LoggingInterceptor);
  app.useGlobalInterceptors(loggingInterceptor);

  // Global transform interceptor (response envelope)
  app.useGlobalInterceptors(new TransformInterceptor());

  // Global monitoring interceptor
  const monitoringInterceptor = app.get(MonitoringInterceptor);
  app.useGlobalInterceptors(monitoringInterceptor);

  const corsOrigins = parseCorsOrigins(process.env);
  app.enableCors({
    origin: (origin, callback) => {
      if (!origin || corsOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error(`CORS origin not allowed: ${origin}`), false);
    },
    credentials: true,
  });
}
