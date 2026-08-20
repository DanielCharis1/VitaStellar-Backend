// src/auth/strategies/jwt.strategy.ts
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, ExtractJwt } from 'passport-jwt';
import { TokenRevocationService } from '../services/token-revocation.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly tokenRevocationService: TokenRevocationService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: process.env.JWT_SECRET,
    });
  }

  async validate(payload: any) {
    if (payload.tokenId) {
      const revoked = await this.tokenRevocationService.isAccessTokenRevoked(payload.tokenId);
      if (revoked) {
        throw new UnauthorizedException('Access token has been revoked');
      }
    }
    return { sub: payload.sub, email: payload.email, role: payload.role };
  }
}
