import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { ForbiddenException } from '@nestjs/common';
import { UsersService } from './users.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UserResponseDto } from './dto/user-response.dto';
import { UserStatsDto } from './dto/user-stats.dto';
import { ErrorResponseDto } from './dto/error-response.dto';
import { IsString, IsNotEmpty } from 'class-validator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

export class RegisterDeviceTokenDto {
  @IsString()
  @IsNotEmpty()
  token: string;
}

// The user object is populated by JwtStrategy.validate(), which returns
// { sub, email, role } for an authenticated bearer token.
interface AuthenticatedRequest extends Request {
  user?: {
    sub?: string;
    userId?: string;
    email?: string;
    role?: string;
  };
}

@ApiTags('Users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post('device-token')
  @HttpCode(HttpStatus.OK)
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    })
  )
  @ApiOperation({
    summary: 'Register FCM device token',
    description:
      'Registers or updates a device token for Firebase Cloud Messaging push notifications.',
  })
  @ApiResponse({
    status: 200,
    description: 'Device token registered successfully',
  })
  async registerDeviceToken(
    @Body() registerDeviceTokenDto: RegisterDeviceTokenDto,
    @Req() req: AuthenticatedRequest
  ) {
    await this.usersService.registerDeviceToken(
      this.extractUserId(req),
      registerDeviceTokenDto.token
    );
    return { success: true, message: 'Device token registered successfully' };
  }

  @Get('me')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get current user profile',
    description: 'Returns the profile of the currently authenticated user.',
  })
  @ApiResponse({
    status: 200,
    description: 'User profile retrieved successfully',
    type: UserResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Bad Request - Invalid request parameters',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - JWT token missing or invalid',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - User does not have required permissions',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'User not found',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 422,
    description: 'Unprocessable Entity - Validation failed',
    type: ErrorResponseDto,
  })
  async getProfile(@Req() req: AuthenticatedRequest): Promise<UserResponseDto> {
    return this.usersService.getProfile(this.extractUserId(req));
  }

  @Get('me/stats')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get current user stats',
    description:
      'Returns aggregated stats for the dashboard including tasks completed, XLM earned, streak, and active coupons. Results are cached for 5 minutes.',
  })
  @ApiResponse({
    status: 200,
    description: 'User stats retrieved successfully',
    type: UserStatsDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Bad Request - Invalid request parameters',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - JWT token missing or invalid',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - User does not have required permissions',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 422,
    description: 'Unprocessable Entity - Validation failed',
    type: ErrorResponseDto,
  })
  async getStats(@Req() req: AuthenticatedRequest): Promise<UserStatsDto> {
    return this.usersService.getStats(this.extractUserId(req));
  }

  @Patch('me')
  @HttpCode(HttpStatus.OK)
  @UsePipes(
    new ValidationPipe({
      whitelist: true, // Strip properties that don't have decorators
      forbidNonWhitelisted: true, // Reject requests with unknown fields
      transform: true,
    })
  )
  @ApiOperation({
    summary: 'Update current user profile',
    description:
      'Update the profile of the currently authenticated user. Only provided fields will be updated.',
  })
  @ApiResponse({
    status: 200,
    description: 'User profile updated successfully',
    type: UserResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Bad Request - Invalid input data',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - JWT token missing or invalid',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - User does not have required permissions',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'User not found',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 422,
    description: 'Unprocessable Entity - Validation failed',
    type: ErrorResponseDto,
  })
  async updateProfile(
    @Req() req: AuthenticatedRequest,
    @Body() updateProfileDto: UpdateProfileDto
  ): Promise<UserResponseDto> {
    return this.usersService.updateProfile(this.extractUserId(req), updateProfileDto);
  }

  @Patch('profile')
  @HttpCode(HttpStatus.OK)
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    })
  )
  @ApiOperation({
    summary: 'Update current user profile (alias)',
  })
  @ApiResponse({
    status: 200,
    description: 'User profile updated successfully',
    type: UserResponseDto,
  })
  async updateProfileAlias(
    @Req() req: AuthenticatedRequest,
    @Body() updateProfileDto: UpdateProfileDto
  ): Promise<UserResponseDto> {
    return this.usersService.updateProfile(this.extractUserId(req), updateProfileDto);
  }

  @Delete('me')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete current user account (soft delete)',
    description:
      'Soft deletes the currently authenticated user account. Sets isActive to false and anonymizes email.',
  })
  @ApiResponse({
    status: 204,
    description: 'User account deleted successfully',
  })
  @ApiResponse({
    status: 400,
    description: 'Bad Request - Invalid request parameters',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - JWT token missing or invalid',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - User does not have required permissions',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'User not found',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 422,
    description: 'Unprocessable Entity - Validation failed',
    type: ErrorResponseDto,
  })
  async deleteProfile(@Req() req: AuthenticatedRequest): Promise<void> {
    await this.usersService.softDelete(this.extractUserId(req));
  }

  private extractUserId(req: AuthenticatedRequest): string {
    const userId = req.user?.sub ?? req.user?.userId;
    if (!userId) {
      throw new ForbiddenException('Authenticated user context is missing');
    }
    return userId;
  }
}
