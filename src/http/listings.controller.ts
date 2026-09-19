import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { ListingsService, type AttestBody, type RegisterBody, type UpdateBody } from '../listings/listings.service';
import { ChainHeaderGuard } from './chain.guard';
import { SigningEnvelopeGuard } from './envelope.guard';
import { Chain, ClientIp, Envelope } from './params';
import type { ChainId } from '../domain/constants';
import type { SigningEnvelope } from '../domain/types';

@Controller()
export class ListingsController {
  constructor(private readonly listings: ListingsService) {}

  @Get('listings')
  @UseGuards(ChainHeaderGuard)
  findActive(
    @Chain() chain: ChainId,
    @Query('q') q: string | undefined,
    @Query('cursor') cursor: string | undefined,
    @ClientIp() ip: string,
  ) {
    return this.listings.findActive(chain, q, cursor, ip);
  }

  @Get('listings/inactive')
  @UseGuards(ChainHeaderGuard)
  findInactive(
    @Chain() chain: ChainId,
    @Query('q') q: string | undefined,
    @Query('cursor') cursor: string | undefined,
    @ClientIp() ip: string,
  ) {
    return this.listings.findInactive(chain, q, cursor, ip);
  }

  @Get('listings/:poolId')
  @UseGuards(ChainHeaderGuard)
  getOne(@Chain() chain: ChainId, @Param('poolId') poolId: string, @ClientIp() ip: string) {
    return this.listings.getOne(chain, poolId, ip);
  }

  @Post('listings')
  @UseGuards(ChainHeaderGuard, SigningEnvelopeGuard)
  async register(
    @Chain() chain: ChainId,
    @Envelope() env: SigningEnvelope,
    @Body() body: RegisterBody,
    @ClientIp() ip: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const out = await this.listings.register(chain, env, body, ip);
    res.status(201);
    res.setHeader('Location', `/v1/listings/${out.poolId}`);
    return out;
  }

  @Patch('listings/:poolId')
  @UseGuards(ChainHeaderGuard, SigningEnvelopeGuard)
  update(
    @Chain() chain: ChainId,
    @Param('poolId') poolId: string,
    @Envelope() env: SigningEnvelope,
    @Body() body: UpdateBody,
    @ClientIp() ip: string,
  ) {
    return this.listings.update(chain, poolId, env, body, ip);
  }

  @Post('listings/:poolId/heartbeat')
  @UseGuards(ChainHeaderGuard, SigningEnvelopeGuard)
  async heartbeat(
    @Chain() chain: ChainId,
    @Param('poolId') poolId: string,
    @Envelope() env: SigningEnvelope,
    @Body() body: { commandKind: 'heartbeatListing'; poolId: string },
    @ClientIp() ip: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.listings.heartbeat(chain, poolId, env, body, ip);
    res.status(204);
  }

  @Delete('listings/:poolId')
  @UseGuards(ChainHeaderGuard, SigningEnvelopeGuard)
  async deregister(
    @Chain() chain: ChainId,
    @Param('poolId') poolId: string,
    @Envelope() env: SigningEnvelope,
    @Body() body: { commandKind: 'deregisterListing'; poolId: string },
    @ClientIp() ip: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.listings.deregister(chain, poolId, env, body, ip);
    res.status(204);
  }

  @Get('stake-preview')
  @UseGuards(ChainHeaderGuard)
  stakePreview(@Chain() chain: ChainId, @Query('wallet') wallet: string, @ClientIp() ip: string) {
    return this.listings.stakePreview(chain, wallet ?? '', ip);
  }

  @Post('listings/:poolId/reviews')
  @UseGuards(ChainHeaderGuard, SigningEnvelopeGuard)
  async review(
    @Chain() chain: ChainId,
    @Param('poolId') poolId: string,
    @Envelope() env: SigningEnvelope,
    @Body() body: { commandKind: 'postReview'; starRating: number; text: string },
    @ClientIp() ip: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.listings.postReview(chain, poolId, env, body, ip);
    res.status(201);
  }

  @Post('listings/:poolId/reviews/:reviewerWallet/rebuttal')
  @UseGuards(ChainHeaderGuard, SigningEnvelopeGuard)
  async rebuttal(
    @Chain() chain: ChainId,
    @Param('poolId') poolId: string,
    @Param('reviewerWallet') reviewerWallet: string,
    @Envelope() env: SigningEnvelope,
    @Body() body: { commandKind: 'postRebuttal'; text: string },
    @ClientIp() ip: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.listings.postRebuttal(chain, poolId, reviewerWallet, env, body, ip);
    res.status(201);
  }

  @Post('listings/:poolId/attestations')
  @UseGuards(ChainHeaderGuard, SigningEnvelopeGuard)
  async attest(
    @Chain() chain: ChainId,
    @Param('poolId') poolId: string,
    @Envelope() env: SigningEnvelope,
    @Body() body: AttestBody,
    @ClientIp() ip: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.listings.attestListing(chain, poolId, env, body, ip);
    res.status(201);
  }
}
