import { Injectable, NestMiddleware, ForbiddenException } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import * as crypto from 'crypto';

@Injectable()
export class CsrfMiddleware implements NestMiddleware {
  private readonly tokenLength = 32;
  private readonly cookieName = 'csrf-token';
  private readonly headerName = 'x-csrf-token';

  use(req: Request, res: Response, next: NextFunction) {
    // req.cookies is only populated when a cookie-parsing middleware (cookie-parser)
    // has run before this middleware. Treat a missing/empty cookies object as a
    // new session so we never crash on an undefined read.
    const cookies = req.cookies ?? {};

    // Generate CSRF token for new sessions
    if (!cookies[this.cookieName]) {
      const token = this.generateToken();
      res.cookie(this.cookieName, token, {
        httpOnly: false, // Allow JavaScript access for SPAs
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 24 * 60 * 60 * 1000, // 24 hours
      });
      req.csrfToken = token;
    } else {
      req.csrfToken = cookies[this.cookieName];
    }

    // Skip CSRF validation for safe methods
    const safeMethods = ['GET', 'HEAD', 'OPTIONS'];
    if (safeMethods.includes(req.method)) {
      return next();
    }

    // Validate CSRF token for state-changing requests
    const tokenFromHeader = req.headers[this.headerName] as string;
    const tokenFromBody = req.body?.csrfToken;
    const tokenToValidate = tokenFromHeader || tokenFromBody;

    if (!tokenToValidate) {
      throw new ForbiddenException('CSRF token missing');
    }

    if (tokenToValidate !== req.csrfToken) {
      throw new ForbiddenException('Invalid CSRF token');
    }

    next();
  }

  private generateToken(): string {
    return crypto.randomBytes(this.tokenLength).toString('hex');
  }
}

// Extend Express Request interface to include csrfToken
declare global {
  namespace Express {
    interface Request {
      csrfToken?: string;
    }
  }
}
