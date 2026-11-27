import { Body, Controller, Get, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthContext } from '../../core/auth/auth.types';
import { CurrentAuth, RequireModule, RequirePermission } from '../../core/auth/decorators';
import { AnnualQueryDto, PublishDto, ResultsQueryDto, TermQueryDto, UnpublishDto } from './dto/results.dto';
import { ResultsService } from './results.service';

const ip = (req: Request) => req.ip ?? null;

/**
 * /api/results — term results of a section, computed from the marks.
 *   GET  /results?termId=&sectionId=&provisional=     averages, ranks, statistics, publication state  (results.compute)
 *   GET  /results/report-cards?termId=&sectionId=      one report card per student (published copy if any)  (results.reportcard.generate)
 *   GET  /results/publications?termId=                 every section of the term with its publication state  (results.compute)
 *   GET  /results/annual?sectionId=&yearId=            year averages over the terms, ranks, promotion decisions  (results.compute)
 *   GET  /results/summary?termId=                      the school's figures for the term: classes, subjects, totals  (results.compute)
 *   POST /results/publish     { termId, sectionId }            publish or republish final results  (results.publish)
 *   POST /results/unpublish   { termId, sectionId, reason }    withdraw published results  (results.publish)
 *
 * Only locked assessments count; provisional=true previews with submitted
 * and validated ones too.
 */
@RequireModule('results')
@Controller('results')
export class ResultsController {
  constructor(private readonly results: ResultsService) {}

  @Get()
  @RequirePermission('results.compute')
  section(@Query() query: ResultsQueryDto) {
    return this.results.section(query.termId, query.sectionId, query.provisional === 'true');
  }

  @Get('report-cards')
  @RequirePermission('results.reportcard.generate')
  reportCards(@Query() query: ResultsQueryDto) {
    return this.results.reportCards(query.termId, query.sectionId, query.provisional === 'true');
  }

  @Get('publications')
  @RequirePermission('results.compute')
  publications(@Query() query: TermQueryDto) {
    return this.results.publications(query.termId);
  }

  @Get('annual')
  @RequirePermission('results.compute')
  annual(@Query() query: AnnualQueryDto) {
    return this.results.annual(query.sectionId, query.yearId);
  }

  @Get('summary')
  @RequirePermission('results.compute')
  summary(@Query() query: TermQueryDto) {
    return this.results.summary(query.termId);
  }

    @Post('publish')
  @RequirePermission('results.publish')
  publish(@CurrentAuth() auth: AuthContext, @Body() dto: PublishDto, @Req() req: Request) {
    return this.results.publish(auth, dto.termId, dto.sectionId, ip(req));
  }

  @Post('unpublish')
  @RequirePermission('results.publish')
  unpublish(@CurrentAuth() auth: AuthContext, @Body() dto: UnpublishDto, @Req() req: Request) {
    return this.results.unpublish(auth, dto.termId, dto.sectionId, dto.reason, ip(req));
  }
}
