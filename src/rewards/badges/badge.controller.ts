import { Controller, Get, Param, UseGuards, Request, HttpStatus, HttpCode } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { BadgeService } from './badge.service';
import { BadgeListResponseDto, UserBadgesResponseDto } from './dto/badge.dto';

@ApiTags('badges')
@Controller('badges')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class BadgeController {
  constructor(private readonly badgeService: BadgeService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get all available badges',
    description: 'Retrieve a list of all available badges in the system',
  })
  @ApiResponse({
    status: 200,
    description: 'List of badges retrieved successfully',
    type: BadgeListResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getAllBadges(): Promise<BadgeListResponseDto> {
    const badges = await this.badgeService.getAllBadges();
    return { badges: badges as any, totalBadges: badges.length };
  }

  @Get('user/:userId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Get user's earned badges",
    description: 'Retrieve all badges earned by a specific user',
  })
  @ApiParam({
    name: 'userId',
    description: 'The UUID of the user',
    type: 'string',
  })
  @ApiResponse({
    status: 200,
    description: 'User badges retrieved successfully',
    type: UserBadgesResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async getUserBadges(@Param('userId') userId: string): Promise<UserBadgesResponseDto> {
    const badges = await this.badgeService.getUserBadges(userId);
    return { userId, badges: badges as any, totalBadges: badges.length };
  }

  @Get('me')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Get current user's earned badges",
    description: 'Retrieve all badges earned by the authenticated user',
  })
  @ApiResponse({
    status: 200,
    description: 'User badges retrieved successfully',
    type: UserBadgesResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getCurrentUserBadges(
    @Request() req: { user: { sub: string; id?: string } }
  ): Promise<UserBadgesResponseDto> {
    const userId = req.user.sub ?? req.user.id;
    const badges = await this.badgeService.getUserBadges(userId);
    return { userId, badges: badges as any, totalBadges: badges.length };
  }
}
