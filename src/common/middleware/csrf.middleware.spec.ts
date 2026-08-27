import { ForbiddenException } from '@nestjs/common';
import { CsrfMiddleware } from './csrf.middleware';

describe('CsrfMiddleware', () => {
  let middleware: CsrfMiddleware;
  let req: any;
  let res: any;
  let next: jest.Mock;

  beforeEach(() => {
    middleware = new CsrfMiddleware();
    res = {
      cookie: jest.fn(),
    };
    next = jest.fn();
  });

  const buildReq = (overrides: Record<string, any> = {}) =>
    ({
      method: 'GET',
      cookies: {},
      headers: {},
      body: {},
      ...overrides,
    } as any);

  describe('safe methods', () => {
    it.each(['GET', 'HEAD', 'OPTIONS'])(
      '%s without a cookie sets a token cookie and calls next()',
      (method) => {
        req = buildReq({ method });
        middleware.use(req, res, next);

        expect(res.cookie).toHaveBeenCalledWith(
          'csrf-token',
          expect.any(String),
          expect.objectContaining({ httpOnly: false, sameSite: 'strict' })
        );
        expect(req.csrfToken).toBeDefined();
        expect(next).toHaveBeenCalledTimes(1);
      }
    );

    it('GET with an existing cookie reuses it and calls next()', () => {
      req = buildReq({ cookies: { 'csrf-token': 'existing-token' } });
      middleware.use(req, res, next);

      expect(req.csrfToken).toBe('existing-token');
      expect(res.cookie).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledTimes(1);
    });

    it('GET does not crash when req.cookies is undefined (no cookie-parser registered)', () => {
      req = buildReq({ cookies: undefined });
      expect(() => middleware.use(req, res, next)).not.toThrow();
      expect(req.csrfToken).toBeDefined();
      expect(next).toHaveBeenCalledTimes(1);
    });
  });

  describe('state-changing methods', () => {
    it('POST without cookies does not crash with a TypeError', () => {
      req = buildReq({ method: 'POST', cookies: undefined });
      expect(() => middleware.use(req, res, next)).toThrow(ForbiddenException);
      expect(() => middleware.use(req, res, next)).toThrow('CSRF token missing');
      expect(next).not.toHaveBeenCalled();
    });

    it('POST with a cookie but no token in header or body returns 403', () => {
      req = buildReq({ method: 'POST', cookies: { 'csrf-token': 'abc' } });
      expect(() => middleware.use(req, res, next)).toThrow(ForbiddenException);
      expect(() => middleware.use(req, res, next)).toThrow('CSRF token missing');
      expect(next).not.toHaveBeenCalled();
    });

    it('POST with a matching x-csrf-token header passes through', () => {
      req = buildReq({
        method: 'POST',
        cookies: { 'csrf-token': 'abc' },
        headers: { 'x-csrf-token': 'abc' },
      });
      middleware.use(req, res, next);
      expect(next).toHaveBeenCalledTimes(1);
    });

    it('POST with a mismatched x-csrf-token header returns 403', () => {
      req = buildReq({
        method: 'POST',
        cookies: { 'csrf-token': 'abc' },
        headers: { 'x-csrf-token': 'def' },
      });
      expect(() => middleware.use(req, res, next)).toThrow(ForbiddenException);
      expect(() => middleware.use(req, res, next)).toThrow('Invalid CSRF token');
      expect(next).not.toHaveBeenCalled();
    });

    it('POST with a matching csrfToken in the body passes through', () => {
      req = buildReq({
        method: 'POST',
        cookies: { 'csrf-token': 'abc' },
        body: { csrfToken: 'abc' },
      });
      middleware.use(req, res, next);
      expect(next).toHaveBeenCalledTimes(1);
    });
  });
});
